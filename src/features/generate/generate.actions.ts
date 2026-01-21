"use server";

import fs from "node:fs";
import path from "node:path";
import { ensureDevUser } from "@/infra/dev/devUser";
import { getLatestBriefingForUser } from "@/features/briefing/briefing.repository";
import { getLlmProvider } from "@/infra/llm";
import type { GenerateResult, GenerateVariant, GenerateWarning } from "@/infra/llm/types";
import type { LlmProvider, LlmRequestOptions, LlmResponse } from "@/infra/llm/provider";
import type { BriefingInput } from "@/domain/briefing";
import { EXPECTED_VARIANT_LABELS } from "./constants";
import type { GeneratePostFormat } from "./types";
import { buildDraftPrompt, buildExpandPrompt, buildFixJsonPrompt } from "./promptBuilder";
import { PLATFORM_GUIDE, type Platform, isPlatform } from "@/domain/platform";
import { getUserProfile } from "@/features/profile/profile.actions";
import { toUserMessage, type ActionError } from "@/lib/llm/actionError";
import { safeParseJsonFromLlm } from "@/lib/llm/jsonSanitizer";
import { formatDbUserMessage, toDbUserMessage } from "@/lib/db/dbError";
import type { ProfileRecord } from "@/domain/profile";

export type { GeneratePostFormat } from "./types";

type BriefingRecord = NonNullable<Awaited<ReturnType<typeof getLatestBriefingForUser>>>;

const DRAFT_NUM_PREDICT_DEFAULT = 280;
const DRAFT_NUM_CTX_DEFAULT = 2048;
const DRAFT_TEMPERATURE_DEFAULT = 0.6;
const EXPAND_NUM_PREDICT_DEFAULT = 800;
const EXPAND_NUM_CTX_DEFAULT = 4096;
const EXPAND_TEMPERATURE_DEFAULT = 0.7;
const FIX_JSON_NUM_PREDICT_DEFAULT = 500;
const FIX_JSON_NUM_CTX_DEFAULT = 1024;
const FIX_JSON_TEMPERATURE_DEFAULT = 0.2;
const TRUNCATION_LINE_MIN: Record<Platform, number> = {
  LINKEDIN: 4,
  INSTAGRAM: 3,
};

const DEFAULT_SERVER_ERROR_MESSAGE = "Não foi possível gerar variações no momento.";
const PARSE_RETRY_ERROR_MESSAGE = "Não foi possível gerar variações. Tente novamente.";
const QUALITY_GATE_ERROR_MESSAGE =
  "A IA não atingiu o padrão de qualidade esperado. Tente novamente.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const cleanupResponseText = (raw: string) =>
  raw
    .replace(/```(?:json)?/gi, "")
    .trim()
    .replace(/^\u200B+|\u200B+$/g, "");

class VariantParseError extends Error {
  raw?: string;
  code:
    | "LLM_BAD_RESPONSE_PARSE"
    | "LLM_BAD_RESPONSE_SCHEMA"
    | "LLM_TRUNCATED"
    | "LLM_QUALITY_GATE";
  reason?: string;
  snippet?: string;
  meta?: Record<string, unknown>;

  constructor(
    code:
      | "LLM_BAD_RESPONSE_PARSE"
      | "LLM_BAD_RESPONSE_SCHEMA"
      | "LLM_TRUNCATED"
      | "LLM_QUALITY_GATE",
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


const normalizeLines = (content: string) =>
  content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

const normalizeForMatch = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const bulletRegex = /^[-•*–—]/;

const hasCtaLine = (line: string, cta?: string | null) => {
  if (!cta) return true;
  const normalizedLine = normalizeForMatch(line);
  const normalizedCta = normalizeForMatch(cta);
  return normalizedLine.includes(normalizedCta);
};

const hasExampleSignal = (content: string) => {
  const normalized = normalizeForMatch(content);
  const markers = [
    "exemplo",
    "por exemplo",
    "na pratica",
    "na prática",
    "ex:",
    "caso real",
    "na vida real",
  ];
  if (markers.some((marker) => normalized.includes(marker))) {
    return true;
  }
  return /\b\d{1,4}(%|x)?\b/.test(content);
};

const runWithConcurrency = async <TInput, TResult>(
  items: TInput[],
  limit: number,
  task: (item: TInput, index: number) => Promise<TResult>
) => {
  const results: TResult[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const persistBadJsonRaw = (raw: string) => {
  if (!isDev) return;
  try {
    const dir = path.join(process.cwd(), ".tmp");
    fs.mkdirSync(dir, { recursive: true });
    const filename = `llm_raw_bad_json_${Date.now()}.txt`;
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

const logParseOk = (
  result: { usedRepair: boolean; extractedBy?: "tags" | "object" | "raw" },
  label?: string
) => {
  if (!isDev) return;
  const by = result.extractedBy ? ` extractedBy=${result.extractedBy}` : "";
  console.info(`[parse] ${label ?? "ok"} usedRepair=${result.usedRepair}${by}`);
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

const parseJsonWithFixRetryOrThrow = async ({
  rawText,
  fixJson,
  devLogLabel,
}: {
  rawText: string;
  fixJson: (bad: string) => Promise<string>;
  devLogLabel?: string;
}) => {
  const first = safeParseJsonFromLlm(rawText);
  if (first.ok) {
    logParseOk({ usedRepair: first.usedRepair, extractedBy: first.extractedBy }, devLogLabel);
    return first.value;
  }

  if (isDev) {
    console.warn(
      `[parse] ${devLogLabel ?? "parse"} failed, retrying FIX_JSON...`,
      first.error
    );
  }

  const fixedText = await fixJson(rawText);
  const second = safeParseJsonFromLlm(fixedText);

  if (second.ok) {
    logParseOk({ usedRepair: second.usedRepair, extractedBy: second.extractedBy }, "ok-after-fix");
    return second.value;
  }

  logBadJson(rawText);
  throw new VariantParseError(
    "LLM_BAD_RESPONSE_PARSE",
    "Não foi possível interpretar o JSON retornado.",
    rawText,
    second.error ?? first.error,
    second.extractedPreview ?? first.extractedPreview ?? buildSnippet(rawText, PARSE_SNIPPET_LENGTH)
  );
};

const tryParseJson = (raw: string) => {
  const cleaned = cleanupResponseText(raw);
  if (!cleaned) {
    return { ok: false as const, reason: "empty_response", cleaned };
  }
  const parsed = safeParseJsonFromLlm(cleaned);
  if (parsed.ok) {
    return {
      ok: true as const,
      value: parsed.value,
      cleaned,
      usedRepair: parsed.usedRepair,
    };
  }
  return {
    ok: false as const,
    reason: parsed.error,
    cleaned,
    usedRepair: false,
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

const parseStrictVariants = async (
  raw: string,
  platform: Platform,
  fixJson: (bad: string) => Promise<string>
) => {
  try {
    const payload = await parseJsonWithFixRetryOrThrow({
      rawText: raw,
      fixJson,
      devLogLabel: "draft",
    });
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

type QualityGateResult = { ok: true } | { ok: false; reason: string };

const qualityGateDraft = (
  variant: GenerateVariant,
  platform: Platform,
  cta?: string | null
): QualityGateResult => {
  const lines = normalizeLines(variant.content);
  const { min } = resolveCharRange(platform);

  if (!lines.length || lines[0].length <= 30) {
    return { ok: false, reason: "missing_hook" };
  }

  const bulletCount = lines.filter((line) => bulletRegex.test(line)).length;
  const shortPointCount = lines
    .slice(1, -1)
    .filter((line) => line.length <= 70).length;
  if (bulletCount < 3 && shortPointCount < 3) {
    return { ok: false, reason: "missing_bullets" };
  }

  if (lines.length < 6) {
    return { ok: false, reason: "missing_signature" };
  }

  const lastLine = lines[lines.length - 1];
  if (!hasCtaLine(lastLine, cta)) {
    return { ok: false, reason: "missing_cta" };
  }

  if (variant.content.length < min) {
    return { ok: false, reason: "too_short" };
  }

  return { ok: true };
};

const qualityGateFinal = (
  variant: GenerateVariant,
  platform: Platform,
  cta?: string | null,
  requireExample = false
): QualityGateResult => {
  const lines = normalizeLines(variant.content);
  const { min, max } = resolveCharRange(platform);

  if (!lines.length || lines[0].length <= 30) {
    return { ok: false, reason: "missing_hook" };
  }

  const bulletCount = lines.filter((line) => bulletRegex.test(line)).length;
  const shortPointCount = lines
    .slice(1, -1)
    .filter((line) => line.length <= 70).length;
  if (bulletCount < 3 && shortPointCount < 3) {
    return { ok: false, reason: "missing_bullets" };
  }

  const lastLine = lines[lines.length - 1];
  if (!hasCtaLine(lastLine, cta)) {
    return { ok: false, reason: "missing_cta" };
  }

  if (variant.content.length < min) {
    return { ok: false, reason: "too_short" };
  }

  if (variant.content.length > max) {
    return { ok: false, reason: "too_long" };
  }

  if (requireExample && !hasExampleSignal(variant.content)) {
    return { ok: false, reason: "missing_example" };
  }

  return { ok: true };
};

const gatherResponseText = async (
  provider: LlmProvider,
  prompt: string,
  options?: LlmRequestOptions
): Promise<LlmResponse> => provider.generateText(prompt, options);

const resolveDraftRequestOptions = (): LlmRequestOptions => {
  const ctxLimit = DRAFT_NUM_CTX_DEFAULT;
  const temperature = DRAFT_TEMPERATURE_DEFAULT;
  return {
    num_predict: DRAFT_NUM_PREDICT_DEFAULT,
    num_ctx: Math.min(DRAFT_NUM_CTX_DEFAULT, ctxLimit),
    temperature,
    mode: "draft",
  };
};

const resolveExpandRequestOptions = (): LlmRequestOptions => {
  const ctxLimit = EXPAND_NUM_CTX_DEFAULT;
  const temperature = EXPAND_TEMPERATURE_DEFAULT;
  const numPredict = EXPAND_NUM_PREDICT_DEFAULT;
  return {
    num_predict: numPredict,
    num_ctx: Math.min(EXPAND_NUM_CTX_DEFAULT, ctxLimit),
    temperature,
    timeoutMs: 150000,
    mode: "expand",
  };
};

const resolveFixJsonRequestOptions = (): LlmRequestOptions => {
  const ctxLimit = FIX_JSON_NUM_CTX_DEFAULT;
  const temperature = FIX_JSON_TEMPERATURE_DEFAULT;
  const numPredict = FIX_JSON_NUM_PREDICT_DEFAULT;
  return {
    num_predict: numPredict,
    num_ctx: Math.min(FIX_JSON_NUM_CTX_DEFAULT, ctxLimit),
    temperature,
  };
};
const resolveErrorType = (
  error: unknown
): "parse" | "schema" | "truncated" | "quality_gate" | "timeout" | "http" => {
  if (error instanceof VariantParseError) {
    if (error.code === "LLM_BAD_RESPONSE_PARSE") return "parse";
    if (error.code === "LLM_TRUNCATED") return "truncated";
    if (error.code === "LLM_QUALITY_GATE") return "quality_gate";
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
      error.message.includes("Gemini respondeu com status") ||
      error.message.includes("Não foi possível conectar ao Gemini")
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

const logDraftTiming = ({
  elapsedMs,
  len,
  doneReason,
}: {
  elapsedMs: number;
  len: number;
  doneReason?: string;
}) => {
  if (!isDev) return;
  console.info(
    `[draft] ok elapsedMs=${elapsedMs} len=${len} done_reason=${doneReason ?? "unknown"}`
  );
};

const logExpandTiming = ({
  label,
  elapsedMs,
  len,
  doneReason,
}: {
  label: string;
  elapsedMs: number;
  len: number;
  doneReason?: string;
}) => {
  if (!isDev) return;
  console.info(
    `[expand] label=${label} ok elapsedMs=${elapsedMs} len=${len} done_reason=${doneReason ?? "unknown"}`
  );
};

const logQualityFailure = (label: string, reason: string) => {
  if (!isDev) return;
  console.info(`[quality] label=${label} failReason=${reason}`);
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

const parseSubsetVariants = async (
  raw: string,
  expectedLabels: string[],
  platform: Platform,
  fixJson: (bad: string) => Promise<string>
) => {
  try {
    const payload = await parseJsonWithFixRetryOrThrow({
      rawText: raw,
      fixJson,
      devLogLabel: "expand",
    });
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
  const { min } = resolveCharRange(platform);

  variants.forEach((variant) => {
    if (variant.content.length >= min) return;
    warnings.push({
      label: variant.label,
      reason: "TOO_SHORT",
      minChars: min,
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
  platformContext,
  briefing,
  profile,
  format,
  directives,
  options,
  fixJson,
}: {
  provider: LlmProvider;
  variant: GenerateVariant;
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
  fixJson: (bad: string) => Promise<string>;
}): Promise<GenerateVariant> => {
  const expandPrompt = buildExpandPrompt({
    profile,
    platform,
    platformContext,
    briefing,
    theme,
    format,
    directives,
    variant,
  });

  const expandStart = Date.now();
  const rawExpand = await gatherResponseText(provider, expandPrompt, options);
  const [expanded] = await parseSubsetVariants(
    rawExpand.text,
    [variant.label],
    platform,
    fixJson
  );
  logExpandTiming({
    label: variant.label,
    elapsedMs: Date.now() - expandStart,
    len: rawExpand.text.length,
    doneReason: rawExpand.doneReason,
  });

  return expanded ?? variant;
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
  const draftOptions = resolveDraftRequestOptions();
  const expandOptions = resolveExpandRequestOptions();
  const fixJsonOptions = resolveFixJsonRequestOptions();
  const fixJson = async (badOutput: string) => {
    const fixPrompt = buildFixJsonPrompt(badOutput);
    const fixed = await gatherResponseText(provider, fixPrompt, fixJsonOptions);
    return fixed.text;
  };

  try {
    const totalStart = Date.now();
    const draftPrompt = buildDraftPrompt({
      profile: promptProfile,
      platform,
      platformContext,
      briefing: briefingInput,
      theme: trimmedTheme,
      format: input.format,
      directives,
    });

    const draftStart = Date.now();
    const rawDraft = await gatherResponseText(provider, draftPrompt, draftOptions);
    logDraftTiming({
      elapsedMs: Date.now() - draftStart,
      len: rawDraft.text.length,
      doneReason: rawDraft.doneReason,
    });
    const draftVariants = await parseStrictVariants(rawDraft.text, platform, fixJson);

    const labelsToExpand: string[] = [];
    draftVariants.forEach((variant) => {
      const gate = qualityGateDraft(variant, platform, briefing.cta);
      if (gate.ok) return;
      logQualityFailure(variant.label, gate.reason);
      labelsToExpand.push(variant.label);
    });

    const labelsToExpandSet = new Set(labelsToExpand);
    const expandTargets = draftVariants.filter((variant) =>
      labelsToExpandSet.has(variant.label)
    );

    let expandedVariants: GenerateVariant[] = [];
    if (expandTargets.length) {
      expandedVariants = await runWithConcurrency(
        expandTargets,
        2,
        async (variant) =>
          expandVariant({
            provider,
            variant,
            theme: trimmedTheme,
            platform,
            platformContext,
            briefing: briefingInput,
            profile: promptProfile,
            format: input.format,
            directives,
            options: expandOptions,
            fixJson,
          })
      );
    }

    const expandedMap = new Map(
      expandedVariants.map((variant) => [variant.label, variant])
    );
    const expandedSet = new Set(expandedVariants.map((variant) => variant.label));
    const finalVariants = draftVariants.map(
      (variant) => expandedMap.get(variant.label) ?? variant
    );

    let finalFailure: { label: string; reason: string } | null = null;
    for (const variant of finalVariants) {
      const gate = qualityGateFinal(
        variant,
        platform,
        briefing.cta,
        expandedSet.has(variant.label)
      );
      if (gate.ok) continue;
      logQualityFailure(variant.label, gate.reason);
      if (!finalFailure) {
        finalFailure = { label: variant.label, reason: gate.reason };
      }
    }

    if (finalFailure !== null) {
      throw new VariantParseError(
        "LLM_QUALITY_GATE",
        QUALITY_GATE_ERROR_MESSAGE,
        undefined,
        finalFailure.reason,
        undefined,
        finalFailure
      );
    }

    if (isDev) {
      const totalMs = Date.now() - totalStart;
      const expandCount = expandedVariants.length;
      console.info(
        `[generate] ok totalMs=${totalMs} expanded=${expandCount}`
      );
    }

    const { warnings } = getShortWarnings(finalVariants, platform);
    return {
      ok: true,
      variants: finalVariants,
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
      const message =
        error.code === "LLM_QUALITY_GATE"
          ? QUALITY_GATE_ERROR_MESSAGE
          : PARSE_RETRY_ERROR_MESSAGE;
      const actionError: ActionError = {
        code: error.code,
        message,
        dev: {
          kind:
            error.code === "LLM_BAD_RESPONSE_PARSE"
              ? "parse"
              : error.code === "LLM_TRUNCATED"
                ? "truncated"
                : error.code === "LLM_QUALITY_GATE"
                  ? "quality_gate"
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

  const provider = getLlmProvider();
  const expandOptions = resolveExpandRequestOptions();
  const fixJsonOptions = resolveFixJsonRequestOptions();
  const fixJson = async (badOutput: string) => {
    const fixPrompt = buildFixJsonPrompt(badOutput);
    const fixed = await gatherResponseText(provider, fixPrompt, fixJsonOptions);
    return fixed.text;
  };
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
  const requestedLabels =
    Array.isArray(input.labels) && input.labels.length
      ? input.labels.filter((label): label is string => typeof label === "string")
      : null;

  const failingLabels = baseVariants
    .filter((variant) => !qualityGateDraft(variant, platform, briefing.cta).ok)
    .map((variant) => variant.label);
  const labelSet = new Set(requestedLabels ?? failingLabels);
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
        platformContext,
        briefing: briefingInput,
        profile: promptProfile,
        format: input.format,
        directives,
        options: expandOptions,
        fixJson,
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
