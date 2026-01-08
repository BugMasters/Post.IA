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
  TEXT: "post completo em formato LinkedIn, com começo-meio-fim",
  PHOTO_TEXT: "legenda completa para LinkedIn, alinhada a imagem com contexto claro",
  PHOTO: "legenda para Instagram, coesa e com ritmo mais direto",
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

const BANNED_CLICHES = [
  "transforme sua vida",
  "ninguém te conta",
  "no mercado acelerado",
  "sucesso garantido",
  "melhor resultado",
  "solução completa",
  "em tempo recorde",
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

const resolveCharRange = (format: GeneratePostFormat) => {
  if (format === "PHOTO") {
    return { min: 600, max: 1200 };
  }
  return { min: 900, max: 1600 };
};

const normalizeCta = (cta: string) =>
  cta
    .trim()
    .replace(/[.!?…]+$/g, "")
    .toLowerCase();

const looksLikeCta = (line: string) =>
  /(comente|comenta|me chama|chame|fale comigo|clique|saiba mais|baixe|inscreva|envie|acesse|agende|marque|link|dm|mensagem)/i.test(
    line
  );

const hasApplicableSnippet = (content: string) =>
  /(passo|checklist|exemplo|roteiro|3 passos|1\)|2\)|3\)|^\s*[-•]\s+)/im.test(
    content
  );

const hasBannedCliche = (content: string) => {
  const lower = content.toLowerCase();
  return BANNED_CLICHES.some((cliche) => lower.includes(cliche));
};

const isWeak = (
  content: string,
  cta: string,
  format: GeneratePostFormat
) => {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const paragraphCount = lines.length;

  if (paragraphCount < 3) {
    return true;
  }

  const totalLength = lines.reduce((sum, line) => sum + line.length, 0);
  const shortLines = lines.filter((line) => line.length < 50).length;
  const avgLength = totalLength / lines.length;
  const choppy = lines.length >= 6 && shortLines / lines.length > 0.6 && avgLength < 80;

  if (choppy) {
    return true;
  }

  if (!hasApplicableSnippet(content)) {
    return true;
  }

  const { min, max } = resolveCharRange(format);
  if (content.length < min || content.length > max) {
    return true;
  }

  if (hasBannedCliche(content)) {
    return true;
  }

  const lastLine = lines.at(-1) ?? "";
  const normalizedCta = normalizeCta(cta);
  const normalizedLastLine = normalizeCta(lastLine);

  if (normalizedCta === "sem cta") {
    if (looksLikeCta(lastLine)) {
      return true;
    }
    return false;
  }

  if (!normalizedLastLine || normalizedLastLine !== normalizedCta) {
    return true;
  }

  return false;
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

const buildSubsetTemplate = (labels: string[]) => {
  const items = labels.map((label) => `{"label":"${label}","content":"..."}`).join(",\n    ");
  return `{\n  "variants": [\n    ${items}\n  ]\n}`;
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
  const { min, max } = resolveCharRange(format);

  return [
    "Você é um redator experiente focado em posts coesos para LinkedIn e Instagram.",
    "O TEMA É SOBERANO. Não introduza tecnologias/assuntos que não apareçam no tema.",
    "O briefing só serve para adaptar tom, exemplos e CTA.",
    "Use apenas os dados abaixo como contexto e não repita os nomes dos campos do briefing nos textos finais.",
    `Tema base: ${theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[format]}`,
    `Contexto: ${contextSummary}`,
    toneInstruction,
    `Evite: ${avoidSummary}.`,
    `Labels exigidos: ${EXPECTED_VARIANT_LABELS.join(", ")}. Mantenha essa ordem.`,
    "Retorne APENAS JSON válido com estrutura { \"variants\": [ { \"label\": \"...\", \"content\": \"...\" }, ... ] }.",
    "Preencha todos os 6. Não deixe nenhum faltando.",
    `Cada conteúdo deve ter entre ${min} e ${max} caracteres.`,
    "Estrutura obrigatória (sem bullets obrigatórios):",
    "- Abertura: gancho específico (1–2 frases).",
    "- Desenvolvimento: 2–4 parágrafos curtos com lógica contínua.",
    "- Utilidade: inclua 1 trecho aplicável (framework 3 passos, checklist curto, exemplo ou roteiro).",
    "- Fechamento: CTA na última linha.",
    "Não escreva uma lista de frases soltas; os parágrafos devem se conectar.",
    `A última linha deve repetir exatamente o CTA sugerido: ${cta}.`,
    'Se o CTA sugerido for "Sem CTA", finalize com uma frase de fechamento sem chamada à ação.',
    "Cada variação deve conter EXATAMENTE 1 recurso criativo dentre:",
    "- metáfora/analogia curta original",
    "- mini-história (3–4 linhas) em primeira pessoa OU cenário realista",
    '- contraponto/virada ("o erro comum é..., o caminho melhor é...")',
    "Template de saída:",
    VARIANT_TEMPLATE,
    `Não use clichês e genéricos: ${BANNED_CLICHES.join(", ")}.`,
    "Evite superlativos sem prova e qualquer dado não fornecido.",
    "O conteúdo deve evitar mencionar diretamente os campos do briefing e não pode trazer claims não fornecidas.",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildRewritePrompt = ({
  theme,
  format,
  briefing,
  variants,
}: {
  theme: string;
  format: GeneratePostFormat;
  briefing: BriefingRecord;
  variants: GenerateVariant[];
}) => {
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
  const { min, max } = resolveCharRange(format);

  const variantBlock = variants
    .map((variant) => `Label: ${variant.label}\nConteúdo atual:\n${variant.content}`)
    .join("\n\n");

  const template = buildSubsetTemplate(variants.map((variant) => variant.label));

  return [
    "Reescreva SOMENTE as variantes fracas abaixo.",
    "O TEMA É SOBERANO. Não introduza tecnologias/assuntos que não apareçam no tema.",
    "O briefing só serve para adaptar tom, exemplos e CTA.",
    `Tema base: ${theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[format]}`,
    `Contexto: ${contextSummary}`,
    toneInstruction,
    `Evite: ${avoidSummary}.`,
    `Cada conteúdo deve ter entre ${min} e ${max} caracteres.`,
    "Estrutura obrigatória (sem bullets obrigatórios):",
    "- Abertura: gancho específico (1–2 frases).",
    "- Desenvolvimento: 2–4 parágrafos curtos com lógica contínua.",
    "- Utilidade: inclua 1 trecho aplicável (framework 3 passos, checklist curto, exemplo ou roteiro).",
    "- Fechamento: CTA na última linha.",
    "Não escreva uma lista de frases soltas; os parágrafos devem se conectar.",
    `A última linha deve repetir exatamente o CTA sugerido: ${cta}.`,
    'Se o CTA sugerido for "Sem CTA", finalize com uma frase de fechamento sem chamada à ação.',
    "Cada variação deve conter EXATAMENTE 1 recurso criativo dentre:",
    "- metáfora/analogia curta original",
    "- mini-história (3–4 linhas) em primeira pessoa OU cenário realista",
    '- contraponto/virada ("o erro comum é..., o caminho melhor é...")',
    `Não use clichês e genéricos: ${BANNED_CLICHES.join(", ")}.`,
    "Evite superlativos sem prova e qualquer dado não fornecido.",
    "Retorne APENAS JSON válido com estrutura { \"variants\": [ { \"label\": \"...\", \"content\": \"...\" }, ... ] }.",
    "Mantenha SOMENTE as labels enviadas, na mesma ordem.",
    "Variantes para reescrever:",
    variantBlock,
    "Template de saída obrigatório:",
    template,
  ]
    .filter(Boolean)
    .join("\n");
};

const parseSubsetVariants = (raw: string, expectedLabels: string[]) => {
  try {
    const payload = parseJsonWithRecovery(raw);
    const variants = extractVariants(payload);
    if (!Array.isArray(variants)) {
      throw new VariantParseError("Formato inválido: variants ausente ou malformado.");
    }
    if (variants.length !== expectedLabels.length) {
      throw new VariantParseError("Formato inválido: quantidade de variantes inesperada.");
    }

    const parsed: GenerateVariant[] = [];

    variants.forEach((item, index) => {
      if (!isRecord(item)) {
        throw new VariantParseError(
          `Formato inválido: variante ${index + 1} não é um objeto.`
        );
      }

      const rawLabel = typeof item.label === "string" ? item.label.trim() : "";
      const rawContent = typeof item.content === "string" ? item.content.trim() : "";
      const expectedLabel = expectedLabels[index];

      if (!rawLabel || rawLabel !== expectedLabel) {
        throw new VariantParseError(
          `Ordem de labels inválida: esperado "${expectedLabel}" na posição ${index + 1}.`
        );
      }
      if (!rawContent) {
        throw new VariantParseError(
          `Formato inválido: o conteúdo da variação "${rawLabel}" não pode estar vazio.`
        );
      }

      parsed.push({ label: rawLabel, content: rawContent });
    });

    return parsed;
  } catch (error) {
    if (error instanceof VariantParseError && !error.raw) {
      error.raw = raw;
    }
    throw error;
  }
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
  const cta = safeField(briefing.cta, "CTA respeitosa");

  try {
    const variants = await runPromptWithRepair(provider, prompt);
    const weakIndexes = variants
      .map((variant, index) =>
        isWeak(variant.content, cta, input.format) ? index : -1
      )
      .filter((index) => index >= 0);

    if (weakIndexes.length >= 2 && process.env.LLM_REWRITE_WEAK === "1") {
      const weakVariants = weakIndexes.map((index) => variants[index]);
      const rewritePrompt = buildRewritePrompt({
        theme: trimmedTheme,
        format: input.format,
        briefing,
        variants: weakVariants,
      });

      try {
        const rawRewrite = await gatherResponseText(provider, rewritePrompt);
        const rewritten = parseSubsetVariants(
          rawRewrite,
          weakVariants.map((variant) => variant.label)
        );
        const rewrittenMap = new Map(rewritten.map((variant) => [variant.label, variant]));
        const merged = variants.map((variant) => rewrittenMap.get(variant.label) ?? variant);
        return { ok: true, variants: merged };
      } catch (error) {
        const raw = error instanceof VariantParseError ? error.raw : undefined;
        logGenerateError("rewrite", error, raw);
        return { ok: true, variants };
      }
    }
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
