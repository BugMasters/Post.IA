"use server";

import { ensureDevUser } from "@/infra/dev/devUser";
import { getLatestBriefingForUser } from "@/features/briefing/briefing.repository";
import { getLlmProvider } from "@/infra/llm";
import type { GenerateResult, GenerateVariant } from "@/infra/llm/types";
import type { LlmProvider } from "@/infra/llm/provider";
import type { BriefingInput } from "@/domain/briefing";
import { EXPECTED_VARIANT_LABELS, VARIANT_TEMPLATE } from "./constants";
import type { GeneratePostFormat } from "./types";
import { buildGeneratePrompt } from "./promptBuilder";
import { PLATFORM_GUIDE, type Platform, isPlatform } from "@/domain/platform";
import { ensureDefaultProfile } from "@/features/profile/profile.actions";

export type { GeneratePostFormat } from "./types";

type BriefingRecord = NonNullable<Awaited<ReturnType<typeof getLatestBriefingForUser>>>;

const GENERIC_PHRASES = [
  "transforme sua vida",
  "ninguém te conta",
  "no mercado acelerado",
  "sucesso garantido",
  "solução completa",
];

const DEFAULT_SERVER_ERROR_MESSAGE = "Não foi possível gerar variações no momento.";
const PARSE_RETRY_ERROR_MESSAGE = "Não foi possível gerar variações. Tente novamente.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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

const resolveCharRange = (platform: Platform) => PLATFORM_GUIDE[platform].charRange;

const hasMinimumBreaks = (content: string) =>
  (content.match(/\n/g) ?? []).length >= 2;

const extractThemeTokens = (theme: string) =>
  theme
    .toLowerCase()
    .split(/[\s,.;:!?/\\]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

const mentionsTheme = (content: string, theme: string) => {
  const lower = content.toLowerCase();
  if (theme && lower.includes(theme.toLowerCase())) {
    return true;
  }
  const tokens = extractThemeTokens(theme);
  return tokens.some((token) => lower.includes(token));
};

const hasGenericPhrase = (content: string) => {
  const lower = content.toLowerCase();
  return GENERIC_PHRASES.some((phrase) => lower.includes(phrase));
};

const scoreVariant = (content: string, platform: Platform, theme = "") => {
  const { min } = resolveCharRange(platform);
  let score = 0;

  if (content.length >= min) score += 1;
  if (hasMinimumBreaks(content)) score += 1;
  if (!hasGenericPhrase(content)) score += 1;
  if (theme && mentionsTheme(content, theme)) score += 1;

  return score;
};

const getQualityIssues = (content: string, theme: string, platform: Platform) => {
  const { min } = resolveCharRange(platform);
  const issues: string[] = [];

  if (content.length < min) {
    issues.push(`mínimo de ${min} caracteres`);
  }
  if (!hasMinimumBreaks(content)) {
    issues.push("poucas quebras de linha");
  }
  if (hasGenericPhrase(content)) {
    issues.push("frases genéricas");
  }
  if (!mentionsTheme(content, theme)) {
    issues.push("tema não citado");
  }

  return { score: scoreVariant(content, platform, theme), issues };
};

const logWeakVariants = (variants: GenerateVariant[], theme: string, platform: Platform) => {
  if (!isDev) return;
  variants.forEach((variant) => {
    const { issues } = getQualityIssues(variant.content, theme, platform);
    if (issues.length) {
      console.warn(
        `[generatePostsAction] variação "${variant.label}" fora do quality gate: ${issues.join(
          ", "
        )}`
      );
    }
  });
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

const extractPromptLine = (prompt: string, prefix: string) => {
  const line = prompt.split("\n").find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
};

const buildPromptSummary = (prompt: string) => {
  const theme = extractPromptLine(prompt, "Tema base:");
  const format = extractPromptLine(prompt, "Formato solicitado:");
  const platform = extractPromptLine(prompt, "Plataforma:");
  const briefing = extractPromptLine(prompt, "Resumo do briefing:");
  const cta = extractPromptLine(prompt, "CTA sugerido:");

  return [
    `Tema: ${theme || "não informado"}`,
    `Formato: ${format || "não informado"}`,
    `Plataforma: ${platform || "não informado"}`,
    `Briefing: ${briefing || "não informado"}`,
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

const toBriefingInput = (briefing: BriefingRecord): BriefingInput => ({
  goal: briefing.goal,
  audience: briefing.audience,
  audienceLevel: briefing.audienceLevel,
  offer: briefing.offer,
  differentiation: briefing.differentiation,
  tone: Array.isArray(briefing.tone) ? briefing.tone : [],
  avoid: Array.isArray(briefing.avoid) ? briefing.avoid : [],
  cta: briefing.cta,
});

const summarizeProfile = (profile?: Awaited<ReturnType<typeof ensureDefaultProfile>> | null) => {
  if (!profile) return "sem memória disponível";
  return [
    profile.roleTitle,
    profile.niche,
    profile.audience,
    profile.languageStyle,
    profile.goals,
  ]
    .filter(Boolean)
    .join(" | ");
};

const normalizeProfileForPrompt = (
  profile: Awaited<ReturnType<typeof ensureDefaultProfile>>
) => ({
  userId: profile.userId,
  roleTitle: profile.roleTitle ?? undefined,
  whatIDo: profile.whatIDo ?? undefined,
  howIWork: profile.howIWork ?? undefined,
  niche: profile.niche ?? undefined,
  audience: profile.audience ?? undefined,
  audienceLevel: (profile.audienceLevel as
    | "Iniciante"
    | "Intermediário"
    | "Avançado"
    | undefined) ?? undefined,
  languageStyle: (profile.languageStyle as
    | "Formal"
    | "Casual"
    | "Didático"
    | "Provocativo"
    | undefined) ?? undefined,
  goals: profile.goals ?? undefined,
  constraints: profile.constraints ?? undefined,
});

const summarizeBriefing = (briefing: BriefingRecord) =>
  [
    `objetivo: ${briefing.goal}`,
    `oferta: ${briefing.offer}`,
    `diferencial: ${briefing.differentiation}`,
    `público: ${briefing.audience} (${briefing.audienceLevel})`,
    `CTA: ${briefing.cta}`,
  ]
    .filter(Boolean)
    .join(" | ");

const buildRewritePrompt = ({
  theme,
  platform,
  briefing,
  profile,
  variants,
}: {
  theme: string;
  platform: Platform;
  briefing: BriefingRecord;
  profile?: Awaited<ReturnType<typeof ensureDefaultProfile>> | null;
  variants: GenerateVariant[];
}) => {
  const { min } = resolveCharRange(platform);
  const variantBlock = variants
    .map((variant) => `Label: ${variant.label}\nConteúdo atual:\n${variant.content}`)
    .join("\n\n");

  const template = buildSubsetTemplate(variants.map((variant) => variant.label));
  const profileLine = summarizeProfile(profile);
  const briefingLine = summarizeBriefing(briefing);

  return [
    "Reescreva SOMENTE as variantes abaixo.",
    `Reescreva esta variação mantendo o mesmo contexto, aumente para pelo menos ${min} caracteres,`,
    "deixe mais específico e prático, sem inventar dados, preserve a label.",
    `Contexto resumido: tema "${theme}". Plataforma ${platform}.`,
    `Perfil: ${profileLine}.`,
    `Briefing: ${briefingLine}.`,
    "Retorne APENAS JSON válido com { \"variants\": [ { \"label\": \"...\", \"content\": \"...\" } ] }.",
    "Mantenha somente as labels enviadas, na mesma ordem.",
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
  platform?: Platform;
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
  const platformInput = input.platform ?? process.env.DEFAULT_PLATFORM;
  const platform = isPlatform(platformInput) ? platformInput : "LINKEDIN";
  const profile = await ensureDefaultProfile(briefing);
  const promptProfile = profile ? normalizeProfileForPrompt(profile) : null;
  const briefingInput = toBriefingInput(briefing);
  const { min, max } = resolveCharRange(platform);
  const tone = briefing.tone?.length ? briefing.tone.join(", ") : "neutro";
  const prompt = buildGeneratePrompt({
    profile: promptProfile,
    platform,
    briefing: briefingInput,
    theme: trimmedTheme,
    format: input.format,
    directives: {
      tone,
      structure: "começo/meio/fim com parágrafos coesos",
      size: `${min}-${max} caracteres`,
      cta: briefing.cta,
    },
  });

  try {
    const variants = await runPromptWithRepair(provider, prompt);
    const weakIndexes = variants
      .map((variant, index) => {
        const evaluation = getQualityIssues(variant.content, trimmedTheme, platform);
        return evaluation.score < 4 ? index : -1;
      })
      .filter((index) => index >= 0);

    if (weakIndexes.length > 0 && process.env.LLM_REWRITE_WEAK === "1") {
      const weakVariants = weakIndexes.map((index) => variants[index]);
      const rewritePrompt = buildRewritePrompt({
        theme: trimmedTheme,
        platform,
        briefing,
        profile,
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
    if (weakIndexes.length > 0) {
      logWeakVariants(variants, trimmedTheme, platform);
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
