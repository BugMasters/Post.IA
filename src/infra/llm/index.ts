import type { LlmProvider } from "./provider";
import { GeminiProvider } from "./gemini.provider";

let cachedProvider: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (cachedProvider) return cachedProvider;

  const provider = (process.env.LLM_PROVIDER ?? "gemini").trim().toLowerCase();

  // Gemini-only (Ollama removido do projeto)
  if (provider !== "gemini") {
    // fallback seguro para evitar crash por env errado
    cachedProvider = new GeminiProvider();
    return cachedProvider;
  }

  cachedProvider = new GeminiProvider();
  return cachedProvider;
}
