type DevDetails = { kind: string; meta?: Record<string, unknown>; snippet?: string };

export type ActionError = {
  code: string;
  message: string;
  hint?: string;
  dev?: DevDetails;
};

const isDev = process.env.NODE_ENV !== "production";

const DEFAULT_MESSAGE = "A IA retornou um erro. Tente novamente.";

const MESSAGE_BY_CODE: Record<string, string> = {
  LLM_TIMEOUT: "A IA demorou demais para responder. Tente novamente.",
  LLM_UNAVAILABLE: "Não consegui conectar na IA (Ollama). Verifique se está ligado.",
  LLM_HTTP_ERROR: "A IA retornou um erro. Tente novamente.",
  LLM_BAD_RESPONSE: "A IA retornou um formato inválido. Tente novamente.",
  LLM_BAD_RESPONSE_PARSE: "A IA retornou um formato inválido. Tente novamente.",
  LLM_BAD_RESPONSE_SCHEMA: "A IA respondeu em formato inesperado. Tente novamente.",
  LLM_TRUNCATED: "A IA cortou a resposta por limite de geração. Tente novamente.",
};

const HINT_BY_CODE: Record<string, string> = {
  LLM_BAD_RESPONSE_PARSE:
    "Se continuar acontecendo, tente novamente (o modelo às vezes erra a estrutura do JSON).",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const shortSnippet = (value: string, limit = 180) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
};

const buildDevDetails = (dev?: DevDetails, fallback?: string) => {
  if (!isDev) return undefined;
  const parts: string[] = [];
  if (dev?.kind) parts.push(dev.kind);
  if (dev?.meta) {
    try {
      parts.push(JSON.stringify(dev.meta));
    } catch {
      parts.push(String(dev.meta));
    }
  }
  if (dev?.snippet) parts.push(dev.snippet);
  if (!parts.length && fallback) {
    parts.push(fallback);
  }
  return parts.length ? shortSnippet(parts.join(" | ")) : undefined;
};

const resolveCodeFromError = (error: Error) => {
  const name = error.name?.toUpperCase?.() ?? "";
  const message = error.message.toLowerCase();

  if (name.startsWith("LLM_")) return name;
  if (name === "TIMEOUTERROR" || name === "ABORTERROR" || /timeout|tempo limite/.test(message)) {
    return "LLM_TIMEOUT";
  }
  if (
    message.includes("não foi possível conectar ao ollama") ||
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("eai_again")
  ) {
    return "LLM_UNAVAILABLE";
  }
  if (message.includes("formato inválido") || message.includes("json")) {
    return "LLM_BAD_RESPONSE_PARSE";
  }
  return "LLM_HTTP_ERROR";
};

const resolveMessage = (
  code: string,
  fallback?: string,
  meta?: Record<string, unknown>
) => {
  const base = MESSAGE_BY_CODE[code] ?? fallback ?? DEFAULT_MESSAGE;
  if (code === "LLM_TRUNCATED" && typeof meta?.label === "string") {
    return `${base} (label: ${meta.label})`;
  }
  if (code === "LLM_TRUNCATED" && Array.isArray(meta?.labels) && meta.labels.length) {
    return `${base} (labels: ${meta.labels.join(", ")})`;
  }
  return base;
};

const resolveHint = (code: string, fallback?: string) => fallback ?? HINT_BY_CODE[code];

export function toUserMessage(
  err: unknown
): { code: string; message: string; hint?: string; devDetails?: string } {
  if (isRecord(err) && typeof err.code === "string" && typeof err.message === "string") {
    const code = err.code.toUpperCase();
    const dev = isRecord(err.dev) ? (err.dev as DevDetails) : undefined;
    const message = resolveMessage(code, err.message, dev?.meta);
    const hint = resolveHint(code, typeof err.hint === "string" ? err.hint : undefined);
    return {
      code,
      message,
      hint,
      devDetails: buildDevDetails(dev, message),
    };
  }

  if (err instanceof Error) {
    const code = resolveCodeFromError(err);
    const dev = isRecord((err as { dev?: unknown }).dev)
      ? ((err as { dev?: DevDetails }).dev as DevDetails)
      : undefined;
    const message = resolveMessage(code, err.message, dev?.meta);
    const hint = resolveHint(code);
    const devDetails = buildDevDetails(
      dev,
      err.message
    );
    return { code, message, hint, devDetails };
  }

  return { code: "LLM_HTTP_ERROR", message: DEFAULT_MESSAGE };
}
