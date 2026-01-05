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

class VariantParseError extends Error {}

const tryParseJson = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractPayload = (raw: string) => {
  const cleaned = cleanupResponseText(raw);

  if (!cleaned) {
    throw new VariantParseError("Resposta vazia da IA.");
  }

  const direct = tryParseJson(cleaned);
  if (direct) {
    return direct;
  }

  const firstObjectMatch = cleaned.match(/(\{[\s\S]*\})/);
  if (firstObjectMatch) {
    const fromBlock = tryParseJson(firstObjectMatch[1]);
    if (fromBlock) {
      return fromBlock;
    }
  }

  throw new VariantParseError("Não foi possível interpretar o JSON retornado.");
};

const buildVariantList = (payload: unknown): GenerateVariant[] => {
  if (!isRecord(payload)) {
    throw new VariantParseError("Formato inválido: payload não é um objeto.");
  }

  const rawVariants = payload.variants;
  if (!Array.isArray(rawVariants)) {
    throw new VariantParseError("Formato inválido: variants ausente ou malformado.");
  }

  if (rawVariants.length !== EXPECTED_VARIANT_LABELS.length) {
    throw new VariantParseError(
      "A resposta deve conter exatamente 6 variações dentro de variants."
    );
  }

  const normalizedMap = new Map<string, { label: string; content: string }>();

  rawVariants.forEach((item, index) => {
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

    const key = normalizeLabel(rawLabel);
    if (!key) {
      throw new VariantParseError(
        `Formato inválido: o label "${rawLabel}" não pôde ser normalizado.`
      );
    }

    if (normalizedMap.has(key)) {
      throw new VariantParseError(`Duplicata detectada para o label "${rawLabel}".`);
    }

    normalizedMap.set(key, { label: rawLabel, content: rawContent });
  });

  const missing = EXPECTED_VARIANT_LABELS.filter(
    (label) => !normalizedMap.has(label.toLowerCase())
  );

  if (missing.length) {
    throw new VariantParseError(`Faltam variações: ${missing.join(", ")}.`);
  }

  return EXPECTED_VARIANT_LABELS.map((label) => {
    const entry = normalizedMap.get(label.toLowerCase());
    if (!entry) {
      throw new VariantParseError(`Faltam variações: ${label}.`);
    }

    return {
      label,
      content: entry.content,
    };
  });
};

const parseStrictVariants = (raw: string) => {
  const payload = extractPayload(raw);
  return buildVariantList(payload);
};

const gatherResponseText = async (provider: LlmProvider, prompt: string) => {
  return provider.generateText(prompt);
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
    "Cada post deve ser em português, pronto para publicação, com no máximo 900 caracteres, primeira linha gancho forte, seguida de 3 bullets (um por linha) e CTA final.",
    `A última linha deve repetir exatamente o CTA sugerido: ${cta}.`,
    "Não invente dados, não use clichês como \"transforme sua vida\" ou \"ninguém te conta\", nem texto longo, jargões, coach vibes, polêmica ou CTA agressivo.",
    "O conteúdo deve evitar mencionar diretamente os campos do briefing e não pode trazer claims não fornecidas.",
    "O gancho, bullets e CTA não podem usar clichês, textão ou figuras de autoridade exageradas.",
  ]
    .filter(Boolean)
    .join("\n");
};

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

  const runPrompt = async (promptToSend: string) => {
    const rawResponse = await gatherResponseText(provider, promptToSend);
    return parseStrictVariants(rawResponse);
  };

  try {
    const variants = await runPrompt(prompt);
    return { ok: true, variants };
  } catch (error) {
    if (error instanceof VariantParseError) {
      const retryPrompt = `${prompt}\n\nRETORNE APENAS JSON.`;
      try {
        const variants = await runPrompt(retryPrompt);
        return { ok: true, variants };
      } catch (retryError) {
        if (retryError instanceof VariantParseError) {
          return { ok: false, error: PARSE_RETRY_ERROR_MESSAGE };
        }
        const message =
          retryError instanceof Error ? retryError.message : DEFAULT_SERVER_ERROR_MESSAGE;
        console.error(
          "[generatePostsAction] erro ao gerar variações no retry:",
          retryError
        );
        return { ok: false, error: message || DEFAULT_SERVER_ERROR_MESSAGE };
      }
    }

    const message = error instanceof Error ? error.message : DEFAULT_SERVER_ERROR_MESSAGE;
    console.error("[generatePostsAction] erro ao gerar variações:", error);
    return { ok: false, error: message || DEFAULT_SERVER_ERROR_MESSAGE };
  }
}
