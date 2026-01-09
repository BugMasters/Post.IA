import { LlmProvider, type LlmRequestOptions } from "./provider";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "qwen2.5:7b-instruct";
const DEFAULT_KEEP_ALIVE = "10m";
const DEFAULT_NUM_PREDICT = 1400;
const DEFAULT_NUM_CTX = 4096;
const MIN_NUM_PREDICT = 900;
const MIN_NUM_CTX = 1024;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_TIMEOUT_PER_TOKEN_MS = 18;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_TOP_P = 0.9;
const DEFAULT_REPEAT_PENALTY = 1.1;
const BASE_URL = (process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
const OLLAMA_API_URL = `${BASE_URL}/api/generate`;
const isDev = process.env.NODE_ENV !== "production";

const numEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const strEnv = (name: string, fallback: string): string => process.env[name] ?? fallback;

type OllamaResponse = {
  response?: string;
  message?: { content?: string };
  error?: string;
};

type OllamaOptions = {
  num_predict: number;
  num_ctx: number;
  temperature: number;
  top_p: number;
  repeat_penalty: number;
};

type TimeoutMeta = {
  elapsedMs: number;
  timeoutMs: number;
  numPredict: number;
  numCtx: number;
  keepAlive: string;
};

const buildConnectionError = (inner?: string) => {
  const baseMessage = `Não foi possível conectar ao Ollama em ${BASE_URL}. Verifique se o serviço está em execução.`;
  if (inner) {
    return `${baseMessage} (${inner})`;
  }
  return baseMessage;
};

const computeTimeoutMs = (
  numPredict: number,
  baseTimeoutMs: number,
  perTokenMs: number
) => Math.max(baseTimeoutMs, numPredict * perTokenMs);

const buildDevTimeoutMessage = (meta: TimeoutMeta) => {
  return `Tempo limite ao aguardar resposta do Ollama. (elapsedMs=${meta.elapsedMs} timeoutMs=${meta.timeoutMs} num_predict=${meta.numPredict} keep_alive=${meta.keepAlive})`;
};

type LlmRequestDev = {
  kind: "timeout" | "network" | "http" | "bad_response";
  meta?: Record<string, unknown>;
  snippet?: string;
};

class LlmRequestError extends Error {
  code: string;
  dev?: LlmRequestDev;
  status?: number;

  constructor(code: string, message: string, dev?: LlmRequestDev, status?: number) {
    super(message);
    this.name = code;
    this.code = code;
    this.dev = dev;
    this.status = status;
  }
}

const RETRYABLE_STATUSES = new Set([429, 503]);
const RETRY_BACKOFFS_MS = [700, 1500];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isNetworkError = (error: unknown) => {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("ecconnrefused") ||
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("eai_again")
  );
};

const toTimeoutError = (meta: TimeoutMeta, attempt: number) =>
  new LlmRequestError(
    "LLM_TIMEOUT",
    "Tempo limite ao aguardar resposta do Ollama.",
    { kind: "timeout", meta: { attempt, ...meta } }
  );

const toNetworkError = (inner: string | undefined, meta: Record<string, unknown>) =>
  new LlmRequestError("LLM_UNAVAILABLE", buildConnectionError(inner), {
    kind: "network",
    meta,
  });

const toHttpError = (message: string, meta: Record<string, unknown>, status: number, snippet?: string) =>
  new LlmRequestError("LLM_HTTP_ERROR", message, { kind: "http", meta, snippet }, status);

const toBadResponseError = (meta: Record<string, unknown>, snippet?: string) =>
  new LlmRequestError(
    "LLM_BAD_RESPONSE",
    "O Ollama retornou uma resposta inesperada. Tente novamente.",
    { kind: "bad_response", meta, snippet }
  );

const isFormatUnsupportedError = (error: unknown) => {
  if (!(error instanceof LlmRequestError)) return false;
  if (error.code !== "LLM_HTTP_ERROR") return false;
  const snippet = error.dev?.snippet ? error.dev.snippet.toLowerCase() : "";
  const message = error.message.toLowerCase();
  const combined = `${message} ${snippet}`;
  if (!combined.includes("format")) return false;
  return (
    combined.includes("unknown") ||
    combined.includes("unsupported") ||
    combined.includes("invalid") ||
    combined.includes("unrecognized")
  );
};

const logRetryAttempt = (error: unknown, attempt: number) => {
  if (!isDev) return;
  const dev = error instanceof LlmRequestError ? error.dev : undefined;
  const kind = dev?.kind ?? "unknown";
  const durationMs =
    typeof dev?.meta?.elapsedMs === "number" ? dev.meta.elapsedMs : undefined;
  const durationLabel = durationMs !== undefined ? durationMs : "n/a";
  console.info(`[ollama] type=${kind} attempt=${attempt} durationMs=${durationLabel}`);
};

const shouldRetry = (error: unknown) => {
  if (error instanceof LlmRequestError) {
    if (error.code === "LLM_TIMEOUT" || error.code === "LLM_UNAVAILABLE") {
      return true;
    }
    if (error.code === "LLM_HTTP_ERROR" && error.status) {
      return RETRYABLE_STATUSES.has(error.status);
    }
  }
  return false;
};

export class OllamaProvider implements LlmProvider {
  async generateText(prompt: string, requestOptions?: LlmRequestOptions): Promise<string> {
    const fallbackPredict =
      requestOptions?.num_predict ?? numEnv("OLLAMA_NUM_PREDICT", DEFAULT_NUM_PREDICT);
    const fallbackCtx =
      requestOptions?.num_ctx ?? numEnv("OLLAMA_NUM_CTX", DEFAULT_NUM_CTX);
    const fallbackTemperature =
      requestOptions?.temperature ?? numEnv("OLLAMA_TEMPERATURE", DEFAULT_TEMPERATURE);
    const fallbackTopP =
      requestOptions?.top_p ?? numEnv("OLLAMA_TOP_P", DEFAULT_TOP_P);
    const options: OllamaOptions = {
      num_predict: Math.max(fallbackPredict, MIN_NUM_PREDICT),
      num_ctx: Math.max(fallbackCtx, MIN_NUM_CTX),
      temperature: fallbackTemperature,
      top_p: fallbackTopP,
      repeat_penalty: numEnv("OLLAMA_REPEAT_PENALTY", DEFAULT_REPEAT_PENALTY),
    };

    const keepAlive = strEnv("OLLAMA_KEEP_ALIVE", DEFAULT_KEEP_ALIVE);
    const baseTimeoutMs = numEnv("OLLAMA_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    const perTokenMs = numEnv("OLLAMA_TIMEOUT_PER_TOKEN_MS", DEFAULT_TIMEOUT_PER_TOKEN_MS);

    const requestOnce = async (
      attemptOptions: OllamaOptions,
      timeoutMs: number,
      attempt: number,
      includeFormat: boolean
    ) => {
      const body: Record<string, unknown> = {
        model: MODEL,
        prompt,
        stream: false,
        keep_alive: keepAlive,
        options: attemptOptions,
      };
      if (includeFormat) {
        body.format = "json";
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = Date.now();
      let ok = false;

      try {
        let response: Response;
        try {
          response = await fetch(OLLAMA_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (error) {
          const elapsedMs = Date.now() - startedAt;
          if (error instanceof Error && error.name === "AbortError") {
            throw toTimeoutError(
              {
              elapsedMs,
              timeoutMs,
              numPredict: attemptOptions.num_predict,
              numCtx: attemptOptions.num_ctx,
              keepAlive,
              },
              attempt
            );
          }
          const innerMessage = error instanceof Error ? error.message : undefined;
          if (isNetworkError(error)) {
            throw toNetworkError(innerMessage, { elapsedMs, attempt });
          }
          throw toNetworkError(innerMessage, { elapsedMs, attempt });
        }

        if (!response.ok) {
          const text = await response.text();
          const elapsedMs = Date.now() - startedAt;
          const statusText = response.statusText ? ` (${response.statusText})` : "";
          const resolvedText = text ? ` Resposta: ${text.trim()}` : "";
          throw toHttpError(
            `Ollama respondeu com status ${response.status}${statusText}.${resolvedText}`,
            { elapsedMs, attempt, status: response.status },
            response.status,
            text?.trim().slice(0, 400)
          );
        }

        const text = await response.text();
        let payload: OllamaResponse;
        try {
          payload = JSON.parse(text) as OllamaResponse;
        } catch (error) {
          const elapsedMs = Date.now() - startedAt;
          throw toBadResponseError(
            { elapsedMs, attempt, reason: "json_parse" },
            text?.trim().slice(0, 400)
          );
        }
        const result = payload.response ?? payload.message?.content;

        if (!result || typeof result !== "string") {
          const elapsedMs = Date.now() - startedAt;
          throw toBadResponseError(
            { elapsedMs, attempt, reason: "missing_response" },
            payload.error?.slice(0, 400)
          );
        }

        ok = true;
        return result;
      } finally {
        clearTimeout(timeoutId);
        if (isDev) {
          const elapsedMs = Date.now() - startedAt;
          const status = ok ? "ok" : "err";
          console.info(
            `[ollama] ${status} elapsedMs=${elapsedMs} model=${MODEL} num_predict=${attemptOptions.num_predict} num_ctx=${attemptOptions.num_ctx}`
          );
        }
      }
    };

    const primaryTimeoutMs = computeTimeoutMs(
      options.num_predict,
      baseTimeoutMs,
      perTokenMs
    );

    const maxAttempts = 2;
    let includeFormat = true;
    let triedWithoutFormat = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await requestOnce(options, primaryTimeoutMs, attempt, includeFormat);
      } catch (error) {
        if (includeFormat && !triedWithoutFormat && isFormatUnsupportedError(error)) {
          triedWithoutFormat = true;
          includeFormat = false;
          return await requestOnce(options, primaryTimeoutMs, attempt, false);
        }
        logRetryAttempt(error, attempt);
        if (attempt === maxAttempts || !shouldRetry(error)) {
          if (error instanceof LlmRequestError && error.code === "LLM_TIMEOUT" && isDev) {
            const meta = error.dev?.meta as TimeoutMeta | undefined;
            if (meta) {
              const timeoutError = new Error(buildDevTimeoutMessage(meta));
              timeoutError.name = "TimeoutError";
              throw timeoutError;
            }
          }
          throw error;
        }
        const backoff = RETRY_BACKOFFS_MS[Math.min(attempt - 1, RETRY_BACKOFFS_MS.length - 1)];
        await sleep(backoff);
      }
    }

    throw new Error("Falha inesperada ao acessar o Ollama.");
  }
}
