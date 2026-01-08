import { LlmProvider } from "./provider";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "qwen2.5:7b-instruct";
const DEFAULT_KEEP_ALIVE = "10m";
const BASE_URL = (process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
const OLLAMA_API_URL = `${BASE_URL}/api/generate`;

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

const buildConnectionError = (inner?: string) => {
  const baseMessage = `Não foi possível conectar ao Ollama em ${BASE_URL}. Verifique se o serviço está em execução.`;
  if (inner) {
    return `${baseMessage} (${inner})`;
  }
  return baseMessage;
};

export class OllamaProvider implements LlmProvider {
  async generateText(prompt: string): Promise<string> {
    const options = {
      num_predict: numEnv("OLLAMA_NUM_PREDICT", 900),
      num_ctx: numEnv("OLLAMA_NUM_CTX", 2048),
      temperature: numEnv("OLLAMA_TEMPERATURE", 0.6),
      top_p: numEnv("OLLAMA_TOP_P", 0.9),
      repeat_penalty: numEnv("OLLAMA_REPEAT_PENALTY", 1.15),
    };

    const body = {
      model: MODEL,
      prompt,
      stream: false,
      format: "json",
      keep_alive: strEnv("OLLAMA_KEEP_ALIVE", DEFAULT_KEEP_ALIVE),
      options,
    };

    const timeoutMs = numEnv("OLLAMA_TIMEOUT_MS", 25000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(OLLAMA_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        const timeoutError = new Error("Tempo limite ao aguardar resposta do Ollama.");
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      }
      const innerMessage = error instanceof Error ? error.message : undefined;
      throw new Error(buildConnectionError(innerMessage));
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const text = await response.text();
      const statusText = response.statusText ? ` (${response.statusText})` : "";
      const resolvedText = text ? ` Resposta: ${text.trim()}` : "";
      throw new Error(
        `Ollama respondeu com status ${response.status}${statusText}.${resolvedText}`
      );
    }

    const payload = (await response.json()) as OllamaResponse;
    const result = payload.response ?? payload.message?.content;

    if (!result || typeof result !== "string") {
      throw new Error(
        payload.error ??
          "O Ollama retornou uma resposta inesperada. Tente novamente."
      );
    }

    return result;
  }
}
