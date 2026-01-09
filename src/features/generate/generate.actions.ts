"use server";

import fs from "node:fs";
import path from "node:path";
import { ensureDevUser } from "@/infra/dev/devUser";
import { getLatestBriefingForUser } from "@/features/briefing/briefing.repository";
import { getLlmProvider } from "@/infra/llm";
import type { GenerateResult, GenerateVariant } from "@/infra/llm/types";
import type { LlmProvider, LlmRequestOptions } from "@/infra/llm/provider";
import type { BriefingInput } from "@/domain/briefing";
import { EXPECTED_VARIANT_LABELS, VARIANT_TEMPLATE } from "./constants";
import type { GeneratePostFormat } from "./types";
import { buildGeneratePrompt } from "./promptBuilder";
import { PLATFORM_GUIDE, type Platform, isPlatform } from "@/domain/platform";
import { ensureDefaultProfile } from "@/features/profile/profile.actions";
import { toUserMessage, type ActionError } from "@/lib/llm/actionError";
import { safeParseJson } from "@/lib/llm/jsonSanitize";
import { formatDbUserMessage, toDbUserMessage } from "@/lib/db/dbError";

export type { GeneratePostFormat } from "./types";

type BriefingRecord = NonNullable<Awaited<ReturnType<typeof getLatestBriefingForUser>>>;

const GENERIC_PHRASES = [
  "transforme sua vida",
  "ninguém te conta",
  "no mercado acelerado",
  "sucesso garantido",
  "solução completa",
];

const EXPAND_CHAR_THRESHOLD: Record<Platform, number> = {
  LINKEDIN: 600,
  INSTAGRAM: 450,
};

const EXPAND_LINE_REQUIREMENTS: Record<Platform, { min: number; max: number }> = {
  LINKEDIN: { min: 10, max: 18 },
  INSTAGRAM: { min: 8, max: 14 },
};

const DEFAULT_LLM_NUM_PREDICT: Record<Platform, number> = {
  LINKEDIN: 1400,
  INSTAGRAM: 900,
};

const LLM_NUM_CTX_DEFAULT = 4096;
const MAX_PARALLEL_REQUESTS = 2;
const TRUNCATION_RETRY_FACTOR = 1.5;

const TRUNCATION_LINE_MIN: Record<Platform, number> = {
  LINKEDIN: 4,
  INSTAGRAM: 3,
};

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
  code: "LLM_BAD_RESPONSE_PARSE" | "LLM_BAD_RESPONSE_SCHEMA" | "LLM_TRUNCATED";
  reason?: string;
  snippet?: string;
  meta?: Record<string, unknown>;

  constructor(
    code: "LLM_BAD_RESPONSE_PARSE" | "LLM_BAD_RESPONSE_SCHEMA" | "LLM_TRUNCATED",
    message: string,
    raw?: string,
    reason?: string,
    snippet?: string,
    meta?: Record<string, unknown>
  ) {
    super(message);
    this.name = code;
    this.code = code;
    this.raw = raw;
    this.reason = reason;
    this.snippet = snippet;
    this.meta = meta;
  }
}

const LOG_SNIPPET_LENGTH = 400;
const PARSE_SNIPPET_LENGTH = 300;
const isDev = process.env.NODE_ENV !== "production";
const RAW_LOG_LIMIT = 400;

const buildSnippet = (raw: string, limit: number) => {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit)}...`;
};

const resolveNumberEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const persistBadJsonRaw = (raw: string) => {
  if (!isDev) return;
  try {
    const dir = path.join(process.cwd(), ".tmp");
    fs.mkdirSync(dir, { recursive: true });
    const filename = `ollama_raw_bad_json_${Date.now()}.txt`;
    fs.writeFileSync(path.join(dir, filename), raw, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[parse] falha ao salvar raw inválido: ${message}`);
  }
};

const logBadJson = (raw: string) => {
  if (!isDev) return;
  const rawLen = raw.length;
  const head = raw.slice(0, RAW_LOG_LIMIT);
  const tail = rawLen > RAW_LOG_LIMIT ? raw.slice(-RAW_LOG_LIMIT) : raw;
  console.error(`[parse] rawLen=${rawLen} head=${head} tail=${tail}`);
  persistBadJsonRaw(raw);
};

const formatActionErrorMessage = (value: ReturnType<typeof toUserMessage>) => {
  const hintSuffix = value.hint ? ` ${value.hint}` : "";
  const base = `${value.message}${hintSuffix}`;
  if (!isDev) {
    return base;
  }
  const devDetails = value.devDetails ? `; detalhes=${value.devDetails}` : "";
  return `${base} (code=${value.code}${devDetails})`;
};

const parseJsonSafely = (raw: string) => {
  const cleaned = cleanupResponseText(raw);

  if (!cleaned) {
    logBadJson(raw);
    throw new VariantParseError("LLM_BAD_RESPONSE_PARSE", "Resposta vazia da IA.", raw);
  }

  const parsed = safeParseJson<unknown>(cleaned);
  if (isDev) {
    console.info(`[parse] usedRepair=${parsed.usedRepair}`);
  }
  if (!parsed.ok) {
    logBadJson(raw);
    throw new VariantParseError(
      "LLM_BAD_RESPONSE_PARSE",
      "Não foi possível interpretar o JSON retornado.",
      raw,
      parsed.reason,
      buildSnippet(raw, PARSE_SNIPPET_LENGTH)
    );
  }

  return parsed.value;
};

const isLikelyTruncatedResponse = (raw?: string, reason?: string) => {
  if (!raw) return false;
  const cleaned = cleanupResponseText(raw);
  if (!cleaned) return false;
  const trimmed = cleaned.trim();
  if (!trimmed.endsWith("}")) return true;
  if (!reason) return false;
  return /unexpected end|end of json|unterminated|json_object_not_found/i.test(reason);
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      if (currentIndex >= items.length) return;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => runWorker()
  );
  await Promise.all(workers);
  return results;
};

const extractVariants = (payload: unknown, raw?: string) => {
  if (!isRecord(payload)) {
    throw new VariantParseError(
      "LLM_BAD_RESPONSE_SCHEMA",
      "Formato inválido: payload não é um objeto.",
      raw
    );
  }

  const rawVariants = payload.variants;
  if (!Array.isArray(rawVariants)) {
    throw new VariantParseError(
      "LLM_BAD_RESPONSE_SCHEMA",
      "Formato inválido: variants ausente ou malformado.",
      raw
    );
  }

  return rawVariants;
};

const normalizeContentLines = (value: unknown, raw?: string) => {
  if (!Array.isArray(value)) return null;
  const lines: string[] = [];
  value.forEach((line, index) => {
    if (typeof line !== "string") {
      throw new VariantParseError(
        "LLM_BAD_RESPONSE_SCHEMA",
        `Formato inválido: content_lines[${index}] precisa ser string.`,
        raw
      );
    }
    if (line.includes("\n") || line.includes("\r")) {
      throw new VariantParseError(
        "LLM_BAD_RESPONSE_SCHEMA",
        `Formato inválido: content_lines[${index}] não pode conter quebra de linha.`,
        raw
      );
    }
    lines.push(line.trim());
  });
  return lines;
};

const normalizeVariantContent = (
  item: Record<string, unknown>,
  rawLabel: string,
  raw?: string
) => {
  const contentLines = normalizeContentLines(item.content_lines, raw);
  if (contentLines) {
    const content = contentLines.join("\n").trim();
    if (!content) {
      throw new VariantParseError(
        "LLM_BAD_RESPONSE_SCHEMA",
        `Formato inválido: o conteúdo da variação "${rawLabel}" não pode estar vazio.`,
        raw
      );
    }
    return {
      content,
      lineCount: contentLines.length,
      usedContentLines: true,
    };
  }

  const rawContent = typeof item.content === "string" ? item.content.trim() : "";
  if (!rawContent) {
    throw new VariantParseError(
      "LLM_BAD_RESPONSE_SCHEMA",
      `Formato inválido: o conteúdo da variação "${rawLabel}" não pode estar vazio.`,
      raw
    );
  }

  return {
    content: rawContent,
    lineCount: rawContent.split(/\r?\n/).length,
    usedContentLines: false,
  };
};

const validateVariantsStrict = (
  variants: unknown,
  platform: Platform,
  raw?: string
): GenerateVariant[] => {
  if (!Array.isArray(variants)) {
    throw new VariantParseError(
      "LLM_BAD_RESPONSE_SCHEMA",
      "Formato inválido: variants ausente ou malformado.",
      raw
    );
  }

  const total = variants.length;
  const parsed: GenerateVariant[] = [];
  const foundLabels = new Set<string>();
  const truncatedLineMin = TRUNCATION_LINE_MIN[platform];

  if (total < EXPECTED_VARIANT_LABELS.length) {
    throw new VariantParseError(
      "LLM_TRUNCATED",
      `Resposta incompleta: esperado ${EXPECTED_VARIANT_LABELS.length} variantes, recebido ${total}.`,
      raw
    );
  }

  variants.forEach((item, index) => {
    if (!isRecord(item)) {
      throw new VariantParseError(
        "LLM_BAD_RESPONSE_SCHEMA",
        `Formato inválido: variante ${index + 1} não é um objeto.`,
        raw
      );
    }

    const rawLabel = typeof item.label === "string" ? item.label.trim() : "";
    if (!rawLabel) {
      throw new VariantParseError(
        "LLM_BAD_RESPONSE_SCHEMA",
        `Formato inválido: variante ${index + 1} precisa de um label válido.`,
        raw
      );
    }

    const { content, lineCount, usedContentLines } = normalizeVariantContent(
      item,
      rawLabel,
      raw
    );

    if (usedContentLines && lineCount < truncatedLineMin) {
      throw new VariantParseError(
        "LLM_TRUNCATED",
        `Resposta incompleta: content_lines muito curto para "${rawLabel}".`,
        raw
      );
    }

    if (EXPECTED_VARIANT_LABELS.includes(rawLabel as (typeof EXPECTED_VARIANT_LABELS)[number])) {
      foundLabels.add(rawLabel);
    }

    parsed.push({ label: rawLabel, content });
  });

  if (total !== EXPECTED_VARIANT_LABELS.length) {
    throw new VariantParseError(
      "LLM_BAD_RESPONSE_SCHEMA",
      "Formato inválido: quantidade de variantes deve ser 6.",
      raw
    );
  }

  const missing = EXPECTED_VARIANT_LABELS.filter((label) => !foundLabels.has(label));
  if (missing.length) {
    throw new VariantParseError(
      "LLM_TRUNCATED",
      `Resposta incompleta: faltando labels: ${missing.join(", ")}.`,
      raw
    );
  }

  EXPECTED_VARIANT_LABELS.forEach((expected, index) => {
    const entry = parsed[index];
    if (!entry || entry.label !== expected) {
      throw new VariantParseError(
        "LLM_BAD_RESPONSE_SCHEMA",
        `Ordem de labels inválida: esperado "${expected}" na posição ${index + 1}.`,
        raw
      );
    }
  });

  return parsed;
};

const parseStrictVariants = (raw: string, platform: Platform) => {
  try {
    const payload = parseJsonSafely(raw);
    const variants = extractVariants(payload, raw);
    return validateVariantsStrict(variants, platform, raw);
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

const gatherResponseText = async (
  provider: LlmProvider,
  prompt: string,
  options?: LlmRequestOptions
) => {
  return provider.generateText(prompt, options);
};

const resolveLlmRequestOptions = (platform: Platform): LlmRequestOptions => {
  const requestedCtx = LLM_NUM_CTX_DEFAULT;
  const ctxLimit = resolveNumberEnv("OLLAMA_NUM_CTX", LLM_NUM_CTX_DEFAULT);
  return {
    num_predict: DEFAULT_LLM_NUM_PREDICT[platform] ?? DEFAULT_LLM_NUM_PREDICT.LINKEDIN,
    num_ctx: Math.min(requestedCtx, ctxLimit),
  };
};

const resolveErrorType = (
  error: unknown
): "parse" | "schema" | "truncated" | "timeout" | "http" => {
  if (error instanceof VariantParseError) {
    if (error.code === "LLM_BAD_RESPONSE_PARSE") return "parse";
    if (error.code === "LLM_TRUNCATED") return "truncated";
    return "schema";
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

const logGenerateError = (errorType: string, error: unknown, raw?: string) => {
  if (isDev) {
    const snippet =
      raw ??
      (error instanceof VariantParseError ? error.snippet ?? error.raw : undefined);
    if (snippet) {
      const normalized = buildSnippet(snippet, LOG_SNIPPET_LENGTH);
      console.error(`[generatePostsAction] erro ${errorType}:`, normalized);
      return;
    }
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
  const rawSnippet = buildSnippet(raw, 1800);
  const summary = buildPromptSummary(prompt);

  return [
    "Você devolveu uma resposta incompleta/inválida.",
    "Retorne APENAS JSON válido contendo EXATAMENTE 6 variantes, com as labels na ordem fixa.",
    "Reescreva TODAS as 6 variantes do zero e garanta JSON bem formado.",
    "Use content_lines como array de strings, sem \\n dentro de cada item.",
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
  const items = labels
    .map((label) => `{"label":"${label}","content_lines":["..."]}`)
    .join(",\n    ");
  return `{\n  "variants": [\n    ${items}\n  ]\n}`;
};

const buildSingleVariantPrompt = ({
  profile,
  platform,
  platformContext,
  briefing,
  theme,
  format,
  directives,
  label,
}: {
  profile?: ReturnType<typeof normalizeProfileForPrompt> | null;
  platform: Platform;
  platformContext?: string;
  briefing: BriefingInput;
  theme: string;
  format: GeneratePostFormat;
  directives: {
    tone?: string;
    structure?: string;
    size?: string;
    cta?: string;
  };
  label: string;
}) => {
  const template = buildSubsetTemplate([label]);
  return buildGeneratePrompt({
    profile,
    platform,
    platformContext,
    briefing,
    theme,
    format,
    directives,
    labels: [label],
    template,
    focusLabel: label,
    styleLabel: label,
  });
};

const buildTruncationMeta = (
  label: string,
  options: LlmRequestOptions | undefined,
  raw?: string
) => ({
  label,
  num_predict: options?.num_predict,
  num_ctx: options?.num_ctx,
  raw_len: raw?.length ?? 0,
});

const bumpPredict = (options: LlmRequestOptions) => ({
  ...options,
  num_predict: Math.ceil(
    (options.num_predict ?? DEFAULT_LLM_NUM_PREDICT.LINKEDIN) * TRUNCATION_RETRY_FACTOR
  ),
});

const runSingleVariantPrompt = async ({
  provider,
  prompt,
  label,
  options,
}: {
  provider: LlmProvider;
  prompt: string;
  label: string;
  options: LlmRequestOptions;
}) => {
  const runOnce = async (runOptions: LlmRequestOptions) => {
    const rawResponse = await gatherResponseText(provider, prompt, runOptions);
    try {
      const parsed = parseSubsetVariants(rawResponse, [label]);
      return { variant: parsed[0], raw: rawResponse, options: runOptions };
    } catch (error) {
      if (error instanceof VariantParseError && !error.raw) {
        error.raw = rawResponse;
      }
      throw error;
    }
  };

  try {
    return await runOnce(options);
  } catch (error) {
    if (!(error instanceof VariantParseError)) {
      throw error;
    }

    const raw = error.raw;
    const truncated =
      error.code === "LLM_TRUNCATED" || isLikelyTruncatedResponse(raw, error.reason);

    if (!truncated) {
      throw error;
    }

    const bumpedOptions = bumpPredict(options);
    try {
      return await runOnce(bumpedOptions);
    } catch (retryError) {
      const retryRaw =
        retryError instanceof VariantParseError ? retryError.raw : raw;
      throw new VariantParseError(
        "LLM_TRUNCATED",
        `Resposta incompleta ao gerar "${label}".`,
        retryRaw,
        retryError instanceof VariantParseError ? retryError.reason : error.reason,
        retryError instanceof VariantParseError ? retryError.snippet : error.snippet,
        buildTruncationMeta(label, bumpedOptions, retryRaw)
      );
    }
  }
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
  profile: NonNullable<Awaited<ReturnType<typeof ensureDefaultProfile>>>
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
    "Retorne APENAS JSON válido com { \"variants\": [ { \"label\": \"...\", \"content_lines\": [\"...\"] } ] }.",
    "Cada item de content_lines deve ser uma linha simples, sem \\n dentro.",
    "Mantenha somente as labels enviadas, na mesma ordem.",
    "Variantes para reescrever:",
    variantBlock,
    "Template de saída obrigatório:",
    template,
  ]
    .filter(Boolean)
    .join("\n");
};

const buildExpandPrompt = ({
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
  const { min, max } = EXPAND_LINE_REQUIREMENTS[platform];
  const variantBlock = variants
    .map((variant) => `Label: ${variant.label}\nConteúdo atual:\n${variant.content}`)
    .join("\n\n");
  const template = buildSubsetTemplate(variants.map((variant) => variant.label));
  const profileLine = summarizeProfile(profile);
  const briefingLine = summarizeBriefing(briefing);
  const expandCharMin = EXPAND_CHAR_THRESHOLD[platform];

  return [
    "Reescreva SOMENTE as variantes abaixo mantendo a ideia central.",
    `Aumente para pelo menos ${min} linhas (máximo ${max}) e no mínimo ${expandCharMin} caracteres.`,
    "LinkedIn: hook forte nas 2 primeiras linhas, corpo com 2-4 parágrafos curtos e CTA final.",
    "Instagram: frases diretas, ritmo rápido, CTA para comentar ou salvar.",
    `Contexto resumido: tema "${theme}". Plataforma ${platform}.`,
    `Perfil: ${profileLine}.`,
    `Briefing: ${briefingLine}.`,
    "Retorne APENAS JSON válido com { \"variants\": [ { \"label\": \"...\", \"content_lines\": [\"...\"] } ] }.",
    "Cada item de content_lines deve ser uma linha simples, sem \\n dentro.",
    "Mantenha somente as labels enviadas, na mesma ordem.",
    "Variantes para expandir:",
    variantBlock,
    "Template de saída obrigatório:",
    template,
  ]
    .filter(Boolean)
    .join("\n");
};

const parseSubsetVariants = (raw: string, expectedLabels: string[]) => {
  try {
    const payload = parseJsonSafely(raw);
    const variants = extractVariants(payload, raw);
    if (!Array.isArray(variants)) {
      throw new VariantParseError(
        "LLM_BAD_RESPONSE_SCHEMA",
        "Formato inválido: variants ausente ou malformado.",
        raw
      );
    }
    if (variants.length !== expectedLabels.length) {
      throw new VariantParseError(
        "LLM_BAD_RESPONSE_SCHEMA",
        "Formato inválido: quantidade de variantes inesperada.",
        raw
      );
    }

    const parsed: GenerateVariant[] = [];

    variants.forEach((item, index) => {
      if (!isRecord(item)) {
        throw new VariantParseError(
          "LLM_BAD_RESPONSE_SCHEMA",
          `Formato inválido: variante ${index + 1} não é um objeto.`,
          raw
        );
      }

      const rawLabel = typeof item.label === "string" ? item.label.trim() : "";
      const expectedLabel = expectedLabels[index];

      if (!rawLabel || rawLabel !== expectedLabel) {
        throw new VariantParseError(
          "LLM_BAD_RESPONSE_SCHEMA",
          `Ordem de labels inválida: esperado "${expectedLabel}" na posição ${index + 1}.`,
          raw
        );
      }

      const { content } = normalizeVariantContent(item, rawLabel, raw);
      parsed.push({ label: rawLabel, content });
    });

    return parsed;
  } catch (error) {
    if (error instanceof VariantParseError && !error.raw) {
      error.raw = raw;
    }
    throw error;
  }
};

async function expandShortVariantsIfNeeded({
  provider,
  variants,
  theme,
  platform,
  briefing,
  profile,
  options,
}: {
  provider: LlmProvider;
  variants: GenerateVariant[];
  theme: string;
  platform: Platform;
  briefing: BriefingRecord;
  profile?: Awaited<ReturnType<typeof ensureDefaultProfile>> | null;
  options?: LlmRequestOptions;
}): Promise<GenerateVariant[]> {
  const minChars = EXPAND_CHAR_THRESHOLD[platform];
  const shortVariants = variants.filter((variant) => variant.content.length < minChars);

  if (shortVariants.length === 0) {
    return variants;
  }

  const expandPrompt = buildExpandPrompt({
    theme,
    platform,
    briefing,
    profile,
    variants: shortVariants,
  });

  try {
    const rawExpand = await gatherResponseText(provider, expandPrompt, options);
    const expanded = parseSubsetVariants(
      rawExpand,
      shortVariants.map((variant) => variant.label)
    );
    const expandedMap = new Map(expanded.map((variant) => [variant.label, variant]));
    return variants.map((variant) => expandedMap.get(variant.label) ?? variant);
  } catch (error) {
    const raw = error instanceof VariantParseError ? error.raw : undefined;
    logGenerateError("expand", error, raw);
    return variants;
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

  let user: Awaited<ReturnType<typeof ensureDevUser>>;
  let briefing: BriefingRecord | null;

  try {
    user = await ensureDevUser();
    briefing = await getLatestBriefingForUser(user.id);
  } catch (error) {
    const dbMessage = toDbUserMessage(error);
    return {
      ok: false,
      error: formatDbUserMessage(
        dbMessage ?? { message: "Não foi possível acessar o banco de dados." }
      ),
    };
  }

  if (!briefing) {
    return {
      ok: false,
      error: "Salve um briefing antes de gerar os posts.",
    };
  }

  const provider = getLlmProvider();
  const platformInput = input.platform ?? process.env.DEFAULT_PLATFORM;
  const platform = isPlatform(platformInput) ? platformInput : "LINKEDIN";
  const platformContext = isPlatform(platformInput)
    ? platform
    : "LINKEDIN (default; TODO: enviar plataforma no form)";
  let profile: Awaited<ReturnType<typeof ensureDefaultProfile>> | null = null;

  try {
    profile = await ensureDefaultProfile(briefing);
  } catch (error) {
    const dbMessage = toDbUserMessage(error);
    if (dbMessage) {
      return { ok: false, error: formatDbUserMessage(dbMessage) };
    }
    if (process.env.NODE_ENV !== "production") {
      console.warn("ensureDefaultProfile falhou, seguindo sem perfil.", error);
    } else {
      console.error("ensureDefaultProfile falhou, seguindo sem perfil.", error);
    }
  }
  const promptProfile = profile ? normalizeProfileForPrompt(profile) : null;
  const briefingInput = toBriefingInput(briefing);
  const { min, max } = resolveCharRange(platform);
  const tone = briefing.tone?.length ? briefing.tone.join(", ") : "neutro";
  const directives = {
    tone,
    structure: "começo/meio/fim com parágrafos coesos",
    size: `${min}-${max} caracteres`,
    cta: briefing.cta,
  };
  const llmOptions = resolveLlmRequestOptions(platform);

  try {
    const variants = await mapWithConcurrency(
      [...EXPECTED_VARIANT_LABELS],
      MAX_PARALLEL_REQUESTS,
      async (label) => {
        const prompt = buildSingleVariantPrompt({
          profile: promptProfile,
          platform,
          platformContext,
          briefing: briefingInput,
          theme: trimmedTheme,
          format: input.format,
          directives,
          label,
        });
        const { variant } = await runSingleVariantPrompt({
          provider,
          prompt,
          label,
          options: llmOptions,
        });
        return variant;
      }
    );
    const expandedVariants = await expandShortVariantsIfNeeded({
      provider,
      variants,
      theme: trimmedTheme,
      platform,
      briefing,
      profile,
      options: llmOptions,
    });
    const weakIndexes = expandedVariants
      .map((variant, index) => {
        const evaluation = getQualityIssues(variant.content, trimmedTheme, platform);
        return evaluation.score < 4 ? index : -1;
      })
      .filter((index) => index >= 0);

    const evaluatedVariants = expandedVariants;
    if (weakIndexes.length > 0 && process.env.LLM_REWRITE_WEAK === "1") {
      const weakVariants = weakIndexes.map((index) => evaluatedVariants[index]);
      const rewritePrompt = buildRewritePrompt({
        theme: trimmedTheme,
        platform,
        briefing,
        profile,
        variants: weakVariants,
      });

      try {
        const rawRewrite = await gatherResponseText(provider, rewritePrompt, llmOptions);
        const rewritten = parseSubsetVariants(
          rawRewrite,
          weakVariants.map((variant) => variant.label)
        );
        const rewrittenMap = new Map(rewritten.map((variant) => [variant.label, variant]));
        const merged = evaluatedVariants.map(
          (variant) => rewrittenMap.get(variant.label) ?? variant
        );
        return { ok: true, variants: merged };
      } catch (error) {
        const raw = error instanceof VariantParseError ? error.raw : undefined;
        logGenerateError("rewrite", error, raw);
        return { ok: true, variants: evaluatedVariants };
      }
    }
    if (weakIndexes.length > 0) {
      logWeakVariants(evaluatedVariants, trimmedTheme, platform);
    }
    return { ok: true, variants: evaluatedVariants };
  } catch (error) {
    if (error instanceof VariantParseError) {
      const raw = error.raw;
      logGenerateError(resolveErrorType(error), error, raw);
      const devSnippet =
        error.snippet ??
        (raw ? buildSnippet(raw, LOG_SNIPPET_LENGTH) : undefined);
      const meta =
        error.meta || error.reason
          ? { ...(error.meta ?? {}), ...(error.reason ? { reason: error.reason } : {}) }
          : undefined;
      const actionError: ActionError = {
        code: error.code,
        message: PARSE_RETRY_ERROR_MESSAGE,
        dev: {
          kind:
            error.code === "LLM_BAD_RESPONSE_PARSE"
              ? "parse"
              : error.code === "LLM_TRUNCATED"
                ? "truncated"
                : "schema",
          meta,
          snippet: devSnippet,
        },
      };
      return {
        ok: false,
        error: formatActionErrorMessage(toUserMessage(actionError)),
      };
    }

    logGenerateError(resolveErrorType(error), error);
    const userMessage = toUserMessage(error);
    const resolved =
      userMessage.message || DEFAULT_SERVER_ERROR_MESSAGE;
    return { ok: false, error: formatActionErrorMessage({ ...userMessage, message: resolved }) };
  }
}
