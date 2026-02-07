import type { LlmProvider, LlmRequestOptions, LlmResponse } from "./provider";

const DEFAULT_MODEL = "gemini-flash-latest";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_TOP_P = 0.9;
const DEFAULT_MAX_OUTPUT_TOKENS = 800;
const RETRY_BASE_MS = 800;
const RETRY_MAX_MS = 8000;
const RETRY_ATTEMPTS = 4;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const isDev = process.env.NODE_ENV !== "production";

const resolveNumberEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

type GeminiPart = { text?: string };
type GeminiCandidate = {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
};
type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};
type GeminiResponse = {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
};

type LlmRequestDev = {
  kind: "timeout" | "network" | "http" | "bad_response" | "empty_response";
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

const buildApiUrl = (baseUrl: string, model: string, apiKey: string) =>
  `${baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

const toTimeoutError = (meta: Record<string, unknown>) =>
  new LlmRequestError(
    "LLM_TIMEOUT",
    "Tempo limite ao aguardar resposta do Gemini.",
    { kind: "timeout", meta }
  );

const toNetworkError = (inner: string | undefined, meta: Record<string, unknown>) => {
  const message = inner
    ? `Não foi possível conectar ao Gemini. Verifique sua rede e a chave de API. (${inner})`
    : "Não foi possível conectar ao Gemini. Verifique sua rede e a chave de API.";
  return new LlmRequestError("LLM_UNAVAILABLE", message, { kind: "network", meta });
};

const toHttpError = (
  status: number,
  meta: Record<string, unknown>,
  snippet?: string,
  apiMessage?: string
) => {
  let message = `Erro ao chamar o Gemini (status ${status}).`;
  if (status === 401) {
    message = "Chave GEMINI_API_KEY inválida ou ausente.";
  } else if (status === 403) {
    message = "Sem permissão para usar o Gemini. Verifique sua conta/projeto.";
  } else if (status === 404) {
    message =
      "Modelo não encontrado/sem suporte. Rode ListModels (v1beta/models) para ver modelos e métodos suportados.";
  } else if (status === 429) {
    message = "Limite de requisições do Gemini excedido. Tente novamente mais tarde.";
  } else if (status >= 500) {
    message = `O Gemini está indisponível no momento (status ${status}).`;
  } else if (apiMessage) {
    message = `${message} ${apiMessage}`;
  }

  return new LlmRequestError(
    "LLM_HTTP_ERROR",
    message,
    { kind: "http", meta, snippet },
    status
  );
};

const toBadResponseError = (meta: Record<string, unknown>, snippet?: string) =>
  new LlmRequestError(
    "LLM_BAD_RESPONSE",
    "O Gemini retornou uma resposta inesperada. Tente novamente.",
    { kind: "bad_response", meta, snippet }
  );

const toEmptyResponseError = (meta: Record<string, unknown>) =>
  new LlmRequestError(
    "LLM_EMPTY_RESPONSE",
    "O Gemini não retornou texto.",
    { kind: "empty_response", meta }
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveRetryDelayMs = (attempt: number, retryAfter?: string | null) => {
  if (retryAfter) {
    const parsed = Number(retryAfter);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed * 1000);
    }
  }
  const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
  const jittered = backoff * (0.5 + Math.random());
  return Math.min(RETRY_MAX_MS, Math.round(jittered));
};

export class GeminiProvider implements LlmProvider {
  async generateText(prompt: string, requestOptions?: LlmRequestOptions): Promise<LlmResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    const rawModel = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
    const baseUrl = process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL;
    const timeoutMs =
      requestOptions?.timeoutMs ??
      resolveNumberEnv("GEMINI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

    const temperature = requestOptions?.temperature ?? DEFAULT_TEMPERATURE;
    const topP = requestOptions?.topP ?? requestOptions?.top_p ?? DEFAULT_TOP_P;
    const maxOutputTokens =
      requestOptions?.maxTokens ?? requestOptions?.num_predict ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const generationConfig = { temperature, topP, maxOutputTokens };

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY ausente. Configure o provider Gemini.");
    }

    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    };

    const model = rawModel.replace(/^models\//, "");
    const apiUrl = buildApiUrl(baseUrl, model, apiKey);

    let response: Response | undefined;
    let elapsedMs = 0;
    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const attemptStartedAt = Date.now();

        try {
          response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (error) {
          elapsedMs = Date.now() - attemptStartedAt;
          if (isDev) {
            const statusLabel =
              error instanceof Error && error.name === "AbortError" ? "timeout" : "network";
            console.info(
              `[gemini] status=${statusLabel} elapsedMs=${elapsedMs} model=${model} attempt=${attempt} maxOutputTokens=${maxOutputTokens}`
            );
          }
          if (error instanceof Error && error.name === "AbortError") {
            throw toTimeoutError({ elapsedMs, timeoutMs });
          }
          if (isNetworkError(error)) {
            throw toNetworkError(error instanceof Error ? error.message : undefined, {
              elapsedMs,
              baseUrl,
            });
          }
          throw error;
        } finally {
          clearTimeout(timeoutId);
        }

        elapsedMs = Date.now() - attemptStartedAt;
        if (isDev) {
          console.info(
            `[gemini] status=${response.status} elapsedMs=${elapsedMs} model=${model} attempt=${attempt} maxOutputTokens=${maxOutputTokens}`
          );
        }

        if (response.ok) {
          break;
        }

        if (RETRYABLE_STATUS.has(response.status) && attempt < RETRY_ATTEMPTS) {
          const retryAfter = response.headers.get("retry-after");
          const delayMs = resolveRetryDelayMs(attempt, retryAfter);
          await sleep(delayMs);
          continue;
        }

        const bodyText = await response.text();
        let apiMessage: string | undefined;
        if (bodyText) {
          try {
            const parsed = JSON.parse(bodyText) as { error?: { message?: string } };
            apiMessage = parsed?.error?.message;
          } catch {
            apiMessage = undefined;
          }
        }
        throw toHttpError(
          response.status,
          { elapsedMs, baseUrl, model, maxOutputTokens },
          bodyText ? bodyText.slice(0, 500) : undefined,
          apiMessage
        );
      }

      if (!response) {
        throw toNetworkError(undefined, { baseUrl, model, maxOutputTokens });
      }

      let payload: GeminiResponse;
      try {
        payload = (await response.json()) as GeminiResponse;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw toBadResponseError({ elapsedMs, model }, message);
      }

      const candidate = payload.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const text = parts.map((part) => part?.text).filter(Boolean).join("");

      if (!text) {
        throw toEmptyResponseError({ elapsedMs, model });
      }

    return {
      text,
      doneReason: candidate?.finishReason,
    };
  }
}
