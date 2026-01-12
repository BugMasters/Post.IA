"use server";

import fs from "node:fs";
import path from "node:path";
import { ensureDevUser } from "@/infra/dev/devUser";
import { getLatestBriefingForUser } from "@/features/briefing/briefing.repository";
import { getLlmProvider } from "@/infra/llm";
import type { GenerateResult, GenerateVariant, GenerateWarning } from "@/infra/llm/types";
import type { LlmProvider, LlmRequestOptions } from "@/infra/llm/provider";
import type { BriefingInput } from "@/domain/briefing";
import { EXPECTED_VARIANT_LABELS } from "./constants";
import type { GeneratePostFormat } from "./types";
import { buildGeneratePrompt } from "./promptBuilder";
import { PLATFORM_GUIDE, type Platform, isPlatform } from "@/domain/platform";
import { getUserProfile } from "@/features/profile/profile.actions";
import { toUserMessage, type ActionError } from "@/lib/llm/actionError";
import { safeParseJson } from "@/lib/llm/jsonSanitize";
import { formatDbUserMessage, toDbUserMessage } from "@/lib/db/dbError";
import type { ProfileRecord } from "@/domain/profile";

export type { GeneratePostFormat } from "./types";

type BriefingRecord = NonNullable<Awaited<ReturnType<typeof getLatestBriefingForUser>>>;

const QUALITY_GATE_MIN_CHARS = 900;

const EXPAND_LINE_REQUIREMENTS: Record<Platform, { min: number; max: number }> = {
  LINKEDIN: { min: 10, max: 18 },
  INSTAGRAM: { min: 8, max: 14 },
};

const LLM_NUM_CTX_DEFAULT = 4096;
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

const tryParseJson = (raw: string) => {
  const cleaned = cleanupResponseText(raw);
  if (!cleaned) {
    return { ok: false as const, reason: "empty_response", cleaned };
  }
  const parsed = safeParseJson<unknown>(cleaned);
  if (parsed.ok) {
    return { ok: true as const, value: parsed.value, cleaned, usedRepair: parsed.usedRepair };
  }
  return {
    ok: false as const,
    reason: parsed.reason,
    cleaned,
    usedRepair: parsed.usedRepair,
  };
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

const ensureNotTruncated = (
  label: string,
  lineCount: number,
  usedContentLines: boolean,
  platform: Platform,
  raw?: string
) => {
  if (!usedContentLines) return;
  const truncatedLineMin = TRUNCATION_LINE_MIN[platform];
  if (lineCount < truncatedLineMin) {
    throw new VariantParseError(
      "LLM_TRUNCATED",
      `Resposta incompleta: content_lines muito curto para "${label}".`,
      raw,
      undefined,
      undefined,
      { label }
    );
  }
};

const parseSingleVariant = (raw: string, expectedLabel: string, platform: Platform) => {
  const parsed = tryParseJson(raw);

  if (parsed.ok) {
    if (isDev) {
      console.info(`[parse] usedRepair=${parsed.usedRepair}`);
    }
    const payload = parsed.value;

    if (typeof payload === "string") {
      const content = payload.trim();
      if (!content) {
        throw new VariantParseError(
          "LLM_BAD_RESPONSE_PARSE",
          "Resposta vazia da IA.",
          raw,
          undefined,
          undefined,
          { label: expectedLabel }
        );
      }
      return { label: expectedLabel, content };
    }

    if (isRecord(payload) && Array.isArray(payload.variants)) {
      if (payload.variants.length !== 1) {
        throw new VariantParseError(
          "LLM_BAD_RESPONSE_SCHEMA",
          "Formato inválido: esperado apenas 1 variante.",
          raw,
          undefined,
          undefined,
          { label: expectedLabel }
        );
      }
      const item = payload.variants[0];
      if (!isRecord(item)) {
        throw new VariantParseError(
          "LLM_BAD_RESPONSE_SCHEMA",
          "Formato inválido: variante não é um objeto.",
          raw,
          undefined,
          undefined,
          { label: expectedLabel }
        );
      }
      const parsedLabel = typeof item.label === "string" ? item.label.trim() : "";
      if (parsedLabel && parsedLabel !== expectedLabel) {
        throw new VariantParseError(
          "LLM_BAD_RESPONSE_SCHEMA",
          `Label inválida: esperado "${expectedLabel}", recebido "${parsedLabel}".`,
          raw,
          undefined,
          undefined,
          { label: expectedLabel, receivedLabel: parsedLabel }
        );
      }
      const { content, lineCount, usedContentLines } = normalizeVariantContent(
        item,
        expectedLabel,
        raw
      );
      ensureNotTruncated(expectedLabel, lineCount, usedContentLines, platform, raw);
      return { label: expectedLabel, content };
    }

    if (isRecord(payload)) {
      const parsedLabel = typeof payload.label === "string" ? payload.label.trim() : "";
      if (parsedLabel && parsedLabel !== expectedLabel) {
        throw new VariantParseError(
          "LLM_BAD_RESPONSE_SCHEMA",
          `Label inválida: esperado "${expectedLabel}", recebido "${parsedLabel}".`,
          raw,
          undefined,
          undefined,
          { label: expectedLabel, receivedLabel: parsedLabel }
        );
      }
      const { content, lineCount, usedContentLines } = normalizeVariantContent(
        payload,
        expectedLabel,
        raw
      );
      ensureNotTruncated(expectedLabel, lineCount, usedContentLines, platform, raw);
      return { label: expectedLabel, content };
    }
  } else {
    if (isDev) {
      console.info(
        `[parse] fallback-to-text label=${expectedLabel} reason=${parsed.reason}`
      );
    }
  }

  const cleaned = cleanupResponseText(raw);
  if (!cleaned) {
    throw new VariantParseError(
      "LLM_BAD_RESPONSE_PARSE",
      "Resposta vazia da IA.",
      raw,
      undefined,
      undefined,
      { label: expectedLabel }
    );
  }
  return { label: expectedLabel, content: cleaned };
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
      raw,
      undefined,
      undefined,
      { labels: EXPECTED_VARIANT_LABELS.slice(0, total) }
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

    ensureNotTruncated(rawLabel, lineCount, usedContentLines, platform, raw);

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
      raw,
      undefined,
      undefined,
      { labels: missing }
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
const resolveLabelMin = (_label: string, platform: Platform) =>
  Math.max(QUALITY_GATE_MIN_CHARS, resolveCharRange(platform).min);

const gatherResponseText = async (
  provider: LlmProvider,
  prompt: string,
  options?: LlmRequestOptions
) => {
  return provider.generateText(prompt, options);
};

const resolveBaseRequestOptions = (platform: Platform): LlmRequestOptions => {
  const requestedCtx = LLM_NUM_CTX_DEFAULT;
  const ctxLimit = resolveNumberEnv("OLLAMA_NUM_CTX", LLM_NUM_CTX_DEFAULT);
  return {
    num_predict: resolveNumberEnv("OLLAMA_NUM_PREDICT", 900),
    num_ctx: Math.min(requestedCtx, ctxLimit),
  };
};

const resolveExpandRequestOptions = (platform: Platform): LlmRequestOptions => {
  const requestedCtx = LLM_NUM_CTX_DEFAULT;
  const ctxLimit = resolveNumberEnv("OLLAMA_NUM_CTX", LLM_NUM_CTX_DEFAULT);
  return {
    num_predict: resolveNumberEnv("OLLAMA_EXPAND_NUM_PREDICT", 600),
    num_ctx: Math.min(requestedCtx, ctxLimit),
    timeoutMs: resolveNumberEnv("OLLAMA_EXPAND_TIMEOUT_MS", 150000),
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

const logVariantTiming = ({
  label,
  elapsedMs,
  len,
  expand,
}: {
  label: string;
  elapsedMs: number;
  len: number;
  expand: boolean;
}) => {
  if (!isDev) return;
  console.info(
    `[generatePostsAction] label=${label} elapsedMs=${elapsedMs} len=${len} expand=${expand}`
  );
};

const buildSubsetTemplate = (labels: string[]) => {
  const items = labels
    .map((label) => `{"label":"${label}","content_lines":["..."]}`)
    .join(",\n    ");
  return `{\n  "variants": [\n    ${items}\n  ]\n}`;
};

const buildExpandBatchPrompt = ({
  theme,
  platform,
  briefing,
  profile,
  variants,
}: {
  theme: string;
  platform: Platform;
  briefing: BriefingRecord;
  profile?: Awaited<ReturnType<typeof getUserProfile>> | null;
  variants: GenerateVariant[];
}) => {
  const { min, max } = EXPAND_LINE_REQUIREMENTS[platform];
  const profileLine = summarizeProfile(profile);
  const briefingLine = summarizeBriefing(briefing);
  const template = buildSubsetTemplate(variants.map((variant) => variant.label));
  const variantBlock = variants
    .map((variant) => `Label: ${variant.label}\nConteúdo atual:\n${variant.content}`)
    .join("\n\n");
  const minPerLabel = variants
    .map((variant) => `${variant.label}: mínimo ${resolveLabelMin(variant.label, platform)} caracteres`)
    .join(" | ");

  return [
    "EXPAND_VARIANTS",
    "Expanda SOMENTE as variações abaixo.",
    "Preserve o conteúdo atual e apenas adicione novas linhas/parágrafos ao final.",
    `Aumente para pelo menos ${min} linhas (máximo ${max}) e respeite o mínimo de caracteres por label.`,
    `Mínimos por label: ${minPerLabel}.`,
    "LinkedIn: hook forte nas 2 primeiras linhas, corpo com 2-4 parágrafos curtos e CTA final.",
    "Instagram: frases diretas, ritmo rápido, CTA para comentar ou salvar.",
    `Contexto resumido: tema \"${theme}\". Plataforma ${platform}.`,
    `Perfil: ${profileLine}.`,
    `Briefing: ${briefingLine}.`,
    "Retorne APENAS JSON válido com { \"variants\": [ { \"label\": \"...\", \"content_lines\": [\"...\"] } ] }.",
    "Cada item de content_lines deve ser uma linha simples, sem \\n dentro.",
    "Mantenha somente as labels enviadas, na mesma ordem.",
    "Variações para expandir:",
    variantBlock,
    "Template de saída obrigatório:",
    template,
  ]
    .filter(Boolean)
    .join("\n");
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

const summarizeProfile = (profile?: Awaited<ReturnType<typeof getUserProfile>> | null) => {
  if (!profile) return "sem perfil salvo";
  return [
    profile.displayName,
    profile.headline,
    profile.role,
    profile.writingStyleNotes,
    profile.bannedClaims,
  ]
    .filter(Boolean)
    .join(" | ");
};

const normalizeProfileForPrompt = (
  profile: NonNullable<Awaited<ReturnType<typeof getUserProfile>>>
): ProfileRecord => ({
  userId: profile.userId,
  displayName: profile.displayName ?? undefined,
  headline: profile.headline ?? undefined,
  bio: profile.bio ?? undefined,
  role: profile.role ?? undefined,
  website: profile.website ?? undefined,
  linkedin: profile.linkedin ?? undefined,
  github: profile.github ?? undefined,
  writingStyleNotes: profile.writingStyleNotes ?? undefined,
  bannedClaims: profile.bannedClaims ?? undefined,
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

const parseSubsetVariants = (raw: string, expectedLabels: string[], platform: Platform) => {
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
          raw,
          undefined,
          undefined,
          { label: expectedLabel }
        );
      }

      const { content, lineCount, usedContentLines } = normalizeVariantContent(
        item,
        rawLabel,
        raw
      );
      ensureNotTruncated(rawLabel, lineCount, usedContentLines, platform, raw);
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

const getShortWarnings = (
  variants: GenerateVariant[],
  platform: Platform
): { warnings: GenerateWarning[]; shortLabels: string[] } => {
  const warnings: GenerateWarning[] = [];
  const shortLabels: string[] = [];

  variants.forEach((variant) => {
    const minChars = resolveLabelMin(variant.label, platform);
    if (variant.content.length >= minChars) return;
    warnings.push({
      label: variant.label,
      reason: "TOO_SHORT",
      minChars,
      gotChars: variant.content.length,
    });
    shortLabels.push(variant.label);
  });

  return { warnings, shortLabels };
};

const expandVariant = async ({
  provider,
  variant,
  theme,
  platform,
  briefing,
  profile,
  options,
}: {
  provider: LlmProvider;
  variant: GenerateVariant;
  theme: string;
  platform: Platform;
  briefing: BriefingRecord;
  profile?: Awaited<ReturnType<typeof getUserProfile>> | null;
  options?: LlmRequestOptions;
}): Promise<GenerateVariant> => {
  const expandPrompt = buildExpandBatchPrompt({
    theme,
    platform,
    briefing,
    profile,
    variants: [variant],
  });

  const expandStart = Date.now();
  const rawExpand = await gatherResponseText(provider, expandPrompt, options);
  const [expanded] = parseSubsetVariants(rawExpand, [variant.label], platform);
  logVariantTiming({
    label: variant.label,
    elapsedMs: Date.now() - expandStart,
    len: rawExpand.length,
    expand: true,
  });

  return expanded ?? variant;
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
  profile?: ProfileRecord | null;
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
}) =>
  buildGeneratePrompt({
    profile,
    platform,
    platformContext,
    briefing,
    theme,
    format,
    directives,
    labels: [label],
    template: buildSubsetTemplate([label]),
    focusLabel: label,
  });

const ensureVariantErrorLabel = (error: unknown, label: string) => {
  if (!(error instanceof VariantParseError)) return;
  if (error.meta && typeof error.meta.label === "string") return;
  error.meta = { ...(error.meta ?? {}), label };
};

const generateVariantOnce = async ({
  provider,
  label,
  theme,
  platform,
  platformContext,
  briefing,
  profile,
  format,
  directives,
  options,
}: {
  provider: LlmProvider;
  label: string;
  theme: string;
  platform: Platform;
  platformContext?: string;
  briefing: BriefingInput;
  profile?: ProfileRecord | null;
  format: GeneratePostFormat;
  directives: {
    tone?: string;
    structure?: string;
    size?: string;
    cta?: string;
  };
  options?: LlmRequestOptions;
}): Promise<GenerateVariant> => {
  const prompt = buildSingleVariantPrompt({
    profile,
    platform,
    platformContext,
    briefing,
    theme,
    format,
    directives,
    label,
  });
  const startedAt = Date.now();
  const rawResponse = await gatherResponseText(provider, prompt, options);
  const variant = parseSingleVariant(rawResponse, label, platform);
  logVariantTiming({
    label,
    elapsedMs: Date.now() - startedAt,
    len: rawResponse.length,
    expand: false,
  });
  return variant;
};

const generateVariantWithRetry = async (
  args: Parameters<typeof generateVariantOnce>[0],
  maxAttempts = 2
) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await generateVariantOnce(args);
    } catch (error) {
      ensureVariantErrorLabel(error, args.label);
      lastError = error;
      if (attempt >= maxAttempts) break;
      if (isDev) {
        console.warn(
          `[generatePostsAction] retry label=${args.label} attempt=${attempt + 1}`
        );
      }
    }
  }
  throw lastError;
};

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
  let profile: Awaited<ReturnType<typeof getUserProfile>> | null = null;

  try {
    profile = await getUserProfile();
  } catch (error) {
    const dbMessage = toDbUserMessage(error);
    if (dbMessage) {
      return { ok: false, error: formatDbUserMessage(dbMessage) };
    }
    if (process.env.NODE_ENV !== "production") {
      console.warn("getUserProfile falhou, seguindo sem perfil.", error);
    } else {
      console.error("getUserProfile falhou, seguindo sem perfil.", error);
    }
  }
  const promptProfile = profile ? normalizeProfileForPrompt(profile) : null;
  const briefingInput = toBriefingInput(briefing);
  const { max, min: platformMin } = resolveCharRange(platform);
  const tone = briefing.tone?.length ? briefing.tone.join(", ") : "neutro";
  const directives = {
    tone,
    structure: "começo/meio/fim com parágrafos coesos",
    size: `${platformMin}-${max} caracteres`,
    cta: briefing.cta,
  };
  const baseOptions = resolveBaseRequestOptions(platform);
  const expandOptions = resolveExpandRequestOptions(platform);

  try {
    const variants: GenerateVariant[] = [];

    for (const label of EXPECTED_VARIANT_LABELS) {
      const variant = await generateVariantWithRetry({
        provider,
        label,
        theme: trimmedTheme,
        platform,
        platformContext,
        briefing: briefingInput,
        profile: promptProfile,
        format: input.format,
        directives,
        options: baseOptions,
      });

      const minChars = resolveLabelMin(label, platform);
      if (variant.content.length < minChars) {
        try {
          const expanded = await expandVariant({
            provider,
            variant,
            theme: trimmedTheme,
            platform,
            briefing,
            profile,
            options: expandOptions,
          });
          variants.push(expanded);
          continue;
        } catch (error) {
          ensureVariantErrorLabel(error, label);
          const raw = error instanceof VariantParseError ? error.raw : undefined;
          logGenerateError("expand", error, raw);
        }
      }

      variants.push(variant);
    }

    const { warnings } = getShortWarnings(variants, platform);
    return {
      ok: true,
      variants,
      warnings: warnings.length ? warnings : undefined,
    };
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

const normalizeClientVariants = (value: unknown): GenerateVariant[] | null => {
  if (!Array.isArray(value)) return null;
  const variants = value
    .map((item) => {
      if (!isRecord(item)) return null;
      const label = typeof item.label === "string" ? item.label.trim() : "";
      const content = typeof item.content === "string" ? item.content.trim() : "";
      if (!label || !content) return null;
      return { label, content };
    })
    .filter((item): item is GenerateVariant => Boolean(item));
  return variants.length ? variants : null;
};

export async function expandShortVariantsAction(input: {
  theme: string;
  format: GeneratePostFormat;
  platform?: Platform;
  variants: GenerateVariant[];
  labels?: string[];
}): Promise<GenerateResult> {
  const trimmedTheme = input.theme?.trim() ?? "";

  if (trimmedTheme.length < 3) {
    return {
      ok: false,
      error: "Informe um tema com pelo menos 3 caracteres.",
    };
  }

  const baseVariants = normalizeClientVariants(input.variants);
  if (!baseVariants) {
    return {
      ok: false,
      error: "Não foi possível reprocessar as variações atuais.",
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

  const platformInput = input.platform ?? process.env.DEFAULT_PLATFORM;
  const platform = isPlatform(platformInput) ? platformInput : "LINKEDIN";
  let profile: Awaited<ReturnType<typeof getUserProfile>> | null = null;

  try {
    profile = await getUserProfile();
  } catch (error) {
    const dbMessage = toDbUserMessage(error);
    if (dbMessage) {
      return { ok: false, error: formatDbUserMessage(dbMessage) };
    }
    if (process.env.NODE_ENV !== "production") {
      console.warn("getUserProfile falhou, seguindo sem perfil.", error);
    } else {
      console.error("getUserProfile falhou, seguindo sem perfil.", error);
    }
  }

  const provider = getLlmProvider();
  const expandOptions = resolveExpandRequestOptions(platform);
  const requestedLabels =
    Array.isArray(input.labels) && input.labels.length
      ? input.labels.filter((label): label is string => typeof label === "string")
      : null;

  const { shortLabels } = getShortWarnings(baseVariants, platform);
  const labelSet = new Set(requestedLabels ?? shortLabels);
  const labelsToExpand = EXPECTED_VARIANT_LABELS.filter((label) => labelSet.has(label));
  const labelsToExpandSet = new Set<string>(labelsToExpand);

  if (!labelsToExpand.length) {
    const { warnings } = getShortWarnings(baseVariants, platform);
    return {
      ok: true,
      variants: baseVariants,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  try {
    const expandedVariants: GenerateVariant[] = [];
    for (const variant of baseVariants) {
      if (!labelsToExpandSet.has(variant.label)) {
        expandedVariants.push(variant);
        continue;
      }
      const expanded = await expandVariant({
        provider,
        variant,
        theme: trimmedTheme,
        platform,
        briefing,
        profile,
        options: expandOptions,
      });
      expandedVariants.push(expanded);
    }
    const { warnings } = getShortWarnings(expandedVariants, platform);
    return {
      ok: true,
      variants: expandedVariants,
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (error) {
    const raw = error instanceof VariantParseError ? error.raw : undefined;
    logGenerateError("expand", error, raw);
    return {
      ok: false,
      error: "Não foi possível expandir as variações curtas. Tente novamente.",
    };
  }
}
