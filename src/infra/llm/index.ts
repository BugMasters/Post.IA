import { LlmProvider } from "./provider";
import { GeminiProvider } from "./gemini.provider";
import { OllamaProvider } from "./ollama.provider";

let cachedProvider: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const provider = (process.env.LLM_PROVIDER ?? "ollama").trim().toLowerCase();

  if (provider === "gemini") {
    cachedProvider = new GeminiProvider();
    return cachedProvider;
  }

  if (provider === "ollama") {
    cachedProvider = new OllamaProvider();
    return cachedProvider;
  }

  throw new Error(`Provedor LLM desconhecido: ${provider}`);
}
