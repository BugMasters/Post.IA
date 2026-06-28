import {
  LlmProvider,
  LlmProviderError,
  type LlmRequestOptions,
} from "./provider";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 120000;

type GeminiTextPart = {
  text?: string;
};

type GeminiCandidate = {
  content?: {
    parts?: GeminiTextPart[];
  };
};

type GeminiErrorPayload = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
  promptFeedback?: {
    blockReason?: string;
  };
  candidates?: GeminiCandidate[];
};

const normalizeBaseUrl = (value: string | undefined) =>
  (value?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");

const normalizeModel = (value: string | undefined) => {
  const model = value?.trim() || DEFAULT_MODEL;
  return model.replace(/^models\//, "");
};

const getApiKey = () => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY nao esta configurada.");
  }
  return apiKey;
};

const parsePositiveNumber = (
  raw: number | string,
  label: string
) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} deve ser um numero positivo.`);
  }

  return parsed;
};

const getTimeoutMs = (requestOptions?: LlmRequestOptions) => {
  const envTimeout = process.env.GEMINI_TIMEOUT_MS?.trim() || undefined;
  const raw = requestOptions?.timeoutMs ?? envTimeout ?? DEFAULT_TIMEOUT_MS;
  return parsePositiveNumber(raw, "GEMINI_TIMEOUT_MS");
};

const getMaxTokens = (requestOptions?: LlmRequestOptions) => {
  if (requestOptions?.maxTokens == null) {
    return undefined;
  }

  return parsePositiveNumber(requestOptions.maxTokens, "maxTokens");
};

const readJsonSafely = async (
  response: Response
): Promise<GeminiErrorPayload | null> => {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as GeminiErrorPayload;
  } catch {
    return null;
  }
};

const extractApiMessage = (payload: GeminiErrorPayload | null) => {
  const message = payload?.error?.message?.trim();
  if (!message) {
    return "";
  }

  return ` ${message}`;
};

const buildStatusError = (status: number, payload: GeminiErrorPayload | null) => {
  const apiMessage = extractApiMessage(payload);

  if (status === 401) {
    return new Error(`Falha de autenticacao no Gemini (401). Verifique a GEMINI_API_KEY.${apiMessage}`);
  }

  if (status === 403) {
    return new Error(
      `Acesso negado pelo Gemini (403). Verifique permissoes da chave e do projeto.${apiMessage}`
    );
  }

  if (status === 404) {
    return new Error(
      `Endpoint ou modelo Gemini nao encontrado (404). Revise GEMINI_BASE_URL e GEMINI_MODEL.${apiMessage}`
    );
  }

  if (status === 429) {
    return new Error(
      `Limite de uso do Gemini atingido (429). Aguarde um pouco e tente novamente.${apiMessage}`
    );
  }

  if (status >= 500) {
    return new Error(
      `O Gemini esta indisponivel no momento (${status}). Tente novamente em instantes.${apiMessage}`
    );
  }

  const statusLabel = payload?.error?.status?.trim();
  const suffix = statusLabel ? ` ${statusLabel}.` : ".";
  return new Error(`Falha ao chamar o Gemini (${status})${suffix}${apiMessage}`);
};

const extractText = (payload: GeminiErrorPayload | null) => {
  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (text) {
    return text;
  }

  if (payload?.promptFeedback?.blockReason) {
    throw new Error(
      `O Gemini bloqueou a resposta por politica de seguranca (${payload.promptFeedback.blockReason}).`
    );
  }

  if (payload?.error?.message) {
    throw new Error(payload.error.message);
  }

  throw new Error("O Gemini retornou uma resposta sem texto utilizavel.");
};

export class GeminiProvider implements LlmProvider {
  async generateText(
    prompt: string,
    requestOptions?: LlmRequestOptions
  ): Promise<string> {
    const apiKey = getApiKey();
    const model = normalizeModel(process.env.GEMINI_MODEL);
    const baseUrl = normalizeBaseUrl(process.env.GEMINI_BASE_URL);
    const timeoutMs = getTimeoutMs(requestOptions);
    const maxTokens = getMaxTokens(requestOptions);

    const url = new URL(`${baseUrl}/models/${model}:generateContent`);
    url.searchParams.set("key", apiKey);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const requestBody = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      ...(maxTokens
        ? {
            generationConfig: {
              maxOutputTokens: maxTokens,
            },
          }
        : {}),
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      const payload = await readJsonSafely(response);

      if (!response.ok) {
        throw buildStatusError(response.status, payload);
      }

      return extractText(payload);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new LlmProviderError(
          "LLM_TIMEOUT",
          `Tempo limite excedido ao chamar o Gemini (${timeoutMs} ms).`
        );
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error("Falha inesperada ao chamar o Gemini.");
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
