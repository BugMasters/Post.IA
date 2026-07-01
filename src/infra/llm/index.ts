import { LlmProvider } from "./provider";
import { GeminiProvider } from "./gemini.provider";

let cachedProvider: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const provider = (process.env.LLM_PROVIDER ?? "gemini").trim().toLowerCase();

  if (provider === "gemini") {
    cachedProvider = new GeminiProvider();
    return cachedProvider;
  }

  throw new Error(
    `LLM_PROVIDER invalido: "${provider}". Este projeto aceita apenas "gemini".`
  );
}
