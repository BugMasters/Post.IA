import { LlmProvider } from "./provider";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL = "qwen2.5:7b-instruct";
const BASE_URL = (process.env.OLLAMA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
const OLLAMA_API_URL = `${BASE_URL}/api/generate`;

type OllamaResponse = {
  response?: string;
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
    let response: Response;

    try {
      response = await fetch(OLLAMA_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          stream: false,
        }),
      });
    } catch (error) {
      const innerMessage = error instanceof Error ? error.message : undefined;
      throw new Error(buildConnectionError(innerMessage));
    }

    if (!response.ok) {
      const statusText = response.statusText ? ` (${response.statusText})` : "";
      throw new Error(
        `Ollama respondeu com status ${response.status}${statusText}. Tente novamente.`
      );
    }

    const payload = (await response.json()) as OllamaResponse;

    if (!payload.response) {
      throw new Error(
        payload.error ?? "O Ollama retornou uma resposta inesperada. Tente novamente."
      );
    }

    return payload.response;
  }
}
