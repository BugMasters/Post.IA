"use server";

import { ensureDevUser } from "@/infra/dev/devUser";
import { getLatestBriefingForUser } from "@/features/briefing/briefing.repository";
import { getLlmProvider } from "@/infra/llm";
import type { GenerateResult, GenerateVariant } from "@/infra/llm/types";
import type { LlmProvider } from "@/infra/llm/provider";

export type GeneratePostFormat = "TEXT" | "PHOTO_TEXT" | "PHOTO";

type BriefingRecord = NonNullable<Awaited<ReturnType<typeof getLatestBriefingForUser>>>;

const EXPECTED_VARIANT_LABELS = [
  "Direto",
  "Storytelling",
  "Engraçado",
  "Autoridade",
  "Técnico",
  "Empático",
] as const;

const FORMAT_DESCRIPTIONS: Record<GeneratePostFormat, string> = {
  TEXT: "texto enxuto pronto para publicação em feed ou thread",
  PHOTO_TEXT: "legenda que acompanha imagem marcante com contexto claro",
  PHOTO: "foco na imagem, frase curta e impacto visual",
};

const AUDIENCE_LEVEL_GUIDANCE: Record<string, string> = {
  Leigo: "use analogias do cotidiano, explique ideias simples e evite termos técnicos demais",
  Intermediário:
    "combina contexto estratégico com termos reconhecíveis para quem já vive as dores do profissional",
  Técnico:
    "apresente termos precisos, referências práticas e passos objetivos sem perder a clareza",
};

const BASE_AVOIDANCES = [
  "Jargão",
  "Textão",
  "Polêmica",
  "Coach vibes",
  "CTA agressivo",
];

const DEFAULT_SERVER_ERROR_MESSAGE = "Não foi possível gerar variações no momento.";
const PARSE_RETRY_ERROR_MESSAGE = "Não foi possível gerar variações. Tente novamente.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeLabel = (label: unknown) =>
  typeof label === "string" ? label.trim().toLowerCase() : "";

const safeField = (value: string | undefined | null, fallback: string) =>
  value?.trim() || fallback;

const cleanupResponseText = (raw: string) =>
  raw
    .replace(/```(?:json)?/gi, "")
    .trim()
    .replace(/^\u200B+|\u200B+$/g, "");

class VariantParseError extends Error {
  raw?: string;

  constructor(message: string, raw?: string) {
    super(message);
    this.name = "VariantParseError";
    this.raw = raw;
  }
}

const LOG_SNIPPET_LENGTH = 400;
const UI_SNIPPET_LENGTH = 180;

const isDev = process.env.NODE_ENV !== "production";

const tryParseJson = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const buildSnippet = (raw: string, limit: number) => {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit)}...`;
};

const parseJsonWithRecovery = (raw: string) => {
  const cleaned = cleanupResponseText(raw);

  if (!cleaned) {
    throw new VariantParseError("Resposta vazia da IA.", raw);
  }

  const direct = tryParseJson(cleaned);
  if (direct) {
    return direct;
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const sliced = cleaned.slice(start, end + 1);
    const recovered = tryParseJson(sliced);
    if (recovered) {
      return recovered;
    }
  }

  throw new VariantParseError("Não foi possível interpretar o JSON retornado.", raw);
};

const extractVariants = (payload: unknown) => {
  if (!isRecord(payload)) {
    throw new VariantParseError("Formato inválido: payload não é um objeto.");
  }

  const rawVariants = payload.variants;
  if (!Array.isArray(rawVariants)) {
    throw new VariantParseError("Formato inválido: variants ausente ou malformado.");
  }

  return rawVariants;
};

const validateVariantsStrict = (variants: unknown): GenerateVariant[] => {
  if (!Array.isArray(variants)) {
    throw new VariantParseError("Formato inválido: variants ausente ou malformado.");
  }

  const total = variants.length;
  const parsed: GenerateVariant[] = [];
  const foundLabels = new Set<string>();

  variants.forEach((item, index) => {
    if (!isRecord(item)) {
      throw new VariantParseError(`Formato inválido: variante ${index + 1} não é um objeto.`);
    }

    const rawLabel = typeof item.label === "string" ? item.label.trim() : "";
    if (!rawLabel) {
      throw new VariantParseError(
        `Formato inválido: variante ${index + 1} precisa de um label válido.`
      );
    }

    const rawContent = typeof item.content === "string" ? item.content.trim() : "";
    if (!rawContent) {
      throw new VariantParseError(
        `Formato inválido: o conteúdo da variação "${rawLabel}" não pode estar vazio.`
      );
    }

    if (EXPECTED_VARIANT_LABELS.includes(rawLabel as (typeof EXPECTED_VARIANT_LABELS)[number])) {
      foundLabels.add(rawLabel);
    }

    parsed.push({ label: rawLabel, content: rawContent });
  });

  const missing = EXPECTED_VARIANT_LABELS.filter((label) => !foundLabels.has(label));
  if (missing.length) {
    throw new VariantParseError(
      `Resposta incompleta: faltando labels: ${missing.join(", ")} (recebido ${Math.min(
        total,
        EXPECTED_VARIANT_LABELS.length
      )}/6).`
    );
  }

  if (total !== EXPECTED_VARIANT_LABELS.length) {
    throw new VariantParseError("Formato inválido: quantidade de variantes deve ser 6.");
  }

  EXPECTED_VARIANT_LABELS.forEach((expected, index) => {
    const entry = parsed[index];
    if (!entry || entry.label !== expected) {
      throw new VariantParseError(
        `Ordem de labels inválida: esperado "${expected}" na posição ${index + 1}.`
      );
    }
  });

  return parsed;
};

const parseStrictVariants = (raw: string) => {
  try {
    const payload = parseJsonWithRecovery(raw);
    const variants = extractVariants(payload);
    return validateVariantsStrict(variants);
  } catch (error) {
    if (error instanceof VariantParseError && !error.raw) {
      error.raw = raw;
    }
    throw error;
  }
};

const gatherResponseText = async (provider: LlmProvider, prompt: string) => {
  return provider.generateText(prompt);
};

const resolveErrorType = (error: unknown): "parse" | "timeout" | "http" => {
  if (error instanceof VariantParseError) {
    return "parse";
  }
  if (error instanceof Error) {
    if (
      error.name === "TimeoutError" ||
      error.name === "AbortError" ||
      /tempo limite|timeout/i.test(error.message)
    ) {
      return "timeout";
    }
    if (
      error.message.includes("Ollama respondeu com status") ||
      error.message.includes("Não foi possível conectar ao Ollama")
    ) {
      return "http";
    }
  }
  return "http";
};

const buildErrorMessage = (base: string, raw?: string, detail?: string) => {
  if (!isDev || !raw) {
    return base;
  }
  const safeDetail = detail ? detail.trim() : "";
  const snippet = buildSnippet(raw, UI_SNIPPET_LENGTH);
  if (!snippet && !safeDetail) {
    return base;
  }
  if (safeDetail && snippet) {
    return `${base} (${safeDetail}. detalhes: ${snippet})`;
  }
  if (safeDetail) {
    return `${base} (${safeDetail})`;
  }
  return `${base} (detalhes: ${snippet})`;
};

const logGenerateError = (errorType: string, error: unknown, raw?: string) => {
  if (isDev && raw) {
    const snippet = buildSnippet(raw, LOG_SNIPPET_LENGTH);
    console.error(`[generatePostsAction] erro ${errorType}:`, snippet);
    return;
  }
  console.error(`[generatePostsAction] erro ${errorType}:`, error);
};

const VARIANT_TEMPLATE = `{
  "variants": [
    {"label":"Direto","content":"..."},
    {"label":"Storytelling","content":"..."},
    {"label":"Engraçado","content":"..."},
    {"label":"Autoridade","content":"..."},
    {"label":"Técnico","content":"..."},
    {"label":"Empático","content":"..."}
  ]
}`;

const extractPromptLine = (prompt: string, prefix: string) => {
  const line = prompt.split("\n").find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
};

const buildPromptSummary = (prompt: string) => {
  const theme = extractPromptLine(prompt, "Tema base:");
  const format = extractPromptLine(prompt, "Formato solicitado:");
  const context = extractPromptLine(prompt, "Contexto:");
  const avoid = extractPromptLine(prompt, "Evite:");
  const cta = extractPromptLine(
    prompt,
    "A última linha deve repetir exatamente o CTA sugerido:"
  );

  return [
    `Tema: ${theme || "não informado"}`,
    `Formato: ${format || "não informado"}`,
    `Contexto: ${context || "não informado"}`,
    `Evitar: ${avoid || "não informado"}`,
    `CTA: ${cta || "não informado"}`,
  ].join("\n");
};

const buildRepairPrompt = (prompt: string, raw: string) => {
  const rawSnippet = buildSnippet(raw, 1200);
  const summary = buildPromptSummary(prompt);

  return [
    "Você devolveu uma resposta incompleta/inválida.",
    "Retorne APENAS JSON válido contendo EXATAMENTE 6 variantes, com as labels na ordem fixa.",
    "Reescreva TODAS as 6 variantes do zero e garanta JSON bem formado.",
    "",
    "Resumo do prompt original:",
    summary,
    "",
    "Resposta recebida (trecho):",
    rawSnippet,
    "",
    "Template de saída obrigatório:",
    VARIANT_TEMPLATE,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildPrompt = (
  theme: string,
  format: GeneratePostFormat,
  briefing: BriefingRecord
) => {
  const goal = safeField(briefing.goal, "objetivo principal do briefing");
  const offer = safeField(briefing.offer, "oferta principal");
  const differentiation = safeField(
    briefing.differentiation,
    "diferencial principal"
  );
  const audience = safeField(briefing.audience, "público-alvo não informado");
  const audienceLevel = safeField(briefing.audienceLevel, "Intermediário");
  const tone = briefing.tone?.length ? briefing.tone.join(", ") : "neutro";
  const cta = safeField(briefing.cta, "CTA respeitosa");

  const audienceGuidance =
    AUDIENCE_LEVEL_GUIDANCE[audienceLevel] ??
    "Equilibre clareza e autoridade conforme o contexto.";

  const avoidList = Array.from(
    new Set([
      ...(Array.isArray(briefing.avoid) ? briefing.avoid : []),
      ...BASE_AVOIDANCES,
    ])
  );
  const avoidSummary = avoidList.length ? avoidList.join(", ") : "nenhum";

  const contextSummary = `Objetivo "${goal}", oferta "${offer}", diferencial "${differentiation}", público "${audience}" (${audienceLevel}).`;
  const toneInstruction = `Tons preferidos: ${tone}. ${audienceGuidance}.`;

  return [
    "Você é um redator experiente focado em redes sociais B2B/B2C.",
    "Use apenas os dados abaixo como contexto e não repita os nomes dos campos do briefing nos textos finais.",
    `Tema base: ${theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[format]}`,
    `Contexto: ${contextSummary}`,
    toneInstruction,
    `Evite: ${avoidSummary}.`,
    `Labels exigidos: ${EXPECTED_VARIANT_LABELS.join(", ")}. Mantenha essa ordem.`,
    "Retorne APENAS JSON válido com estrutura { \"variants\": [ { \"label\": \"...\", \"content\": \"...\" }, ... ] }.",
    "Preencha todos os 6. Não deixe nenhum faltando.",
    "Cada conteúdo deve ter entre 300 e 600 caracteres.",
    "Estrutura obrigatória: Linha 1 gancho, Linhas 2-4 com 3 bullets curtos (um por linha), última linha CTA.",
    `A última linha deve repetir exatamente o CTA sugerido: ${cta}.`,
    "Template de saída:",
    VARIANT_TEMPLATE,
    "Não invente dados, não use clichês como \"transforme sua vida\" ou \"ninguém te conta\", nem texto longo, jargões, coach vibes, polêmica ou CTA agressivo.",
    "O conteúdo deve evitar mencionar diretamente os campos do briefing e não pode trazer claims não fornecidas.",
    "O gancho, bullets e CTA não podem usar clichês, textão ou figuras de autoridade exageradas.",
  ]
    .filter(Boolean)
    .join("\n");
};

async function runPromptWithRepair(
  provider: LlmProvider,
  prompt: string
): Promise<GenerateVariant[]> {
  const runOnce = async (promptToSend: string) => {
    const rawResponse = await gatherResponseText(provider, promptToSend);
    return parseStrictVariants(rawResponse);
  };

  try {
    return await runOnce(prompt);
  } catch (error) {
    if (error instanceof VariantParseError) {
      const raw = error.raw ?? "";
      const repairPrompt = buildRepairPrompt(prompt, raw);
      return runOnce(repairPrompt);
    }
    throw error;
  }
}

export async function generatePostsAction(input: {
  theme: string;
  format: GeneratePostFormat;
}): Promise<GenerateResult> {
  const trimmedTheme = input.theme?.trim() ?? "";

  if (trimmedTheme.length < 3) {
    return {
      ok: false,
      error: "Informe um tema com pelo menos 3 caracteres.",
    };
  }

  const user = await ensureDevUser();
  const briefing = await getLatestBriefingForUser(user.id);

  if (!briefing) {
    return {
      ok: false,
      error: "Salve um briefing antes de gerar os posts.",
    };
  }

  const provider = getLlmProvider();
  const prompt = buildPrompt(trimmedTheme, input.format, briefing);

  try {
    const variants = await runPromptWithRepair(provider, prompt);
    return { ok: true, variants };
  } catch (error) {
    if (error instanceof VariantParseError) {
      const raw = error.raw;
      logGenerateError("parse", error, raw);
      return {
        ok: false,
        error: buildErrorMessage(PARSE_RETRY_ERROR_MESSAGE, raw, error.message),
      };
    }

    const message = error instanceof Error ? error.message : DEFAULT_SERVER_ERROR_MESSAGE;
    logGenerateError(resolveErrorType(error), error);
    return { ok: false, error: message || DEFAULT_SERVER_ERROR_MESSAGE };
  }
}
