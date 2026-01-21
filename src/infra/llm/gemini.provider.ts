import type { LlmProvider, LlmRequestOptions, LlmResponse } from "./provider";

const DEFAULT_MODEL = "gemini-1.5-flash";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_TIMEOUT_MS = 120000;

const resolveNumberEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export class GeminiProvider implements LlmProvider {
  async generateText(prompt: string, requestOptions?: LlmRequestOptions): Promise<LlmResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
    const baseUrl = process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL;
    const timeoutMs =
      requestOptions?.timeoutMs ??
      resolveNumberEnv("GEMINI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);

    const resolvedOptions = {
      maxTokens: requestOptions?.maxTokens ?? requestOptions?.num_predict,
      temperature: requestOptions?.temperature,
      topP: requestOptions?.topP ?? requestOptions?.top_p,
      contextLimit: requestOptions?.contextLimit ?? requestOptions?.num_ctx,
    };

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY ausente. Configure o provider Gemini.");
    }

    void prompt;
    void model;
    void baseUrl;
    void timeoutMs;
    void resolvedOptions;

    throw new Error("Gemini provider stub: TODO implementar chamada de API.");
  }
}
