import { GeminiProvider } from "../src/infra/llm/gemini.provider";

const prompt = "Diga olá em uma frase curta.";

const main = async () => {
  const provider = new GeminiProvider();
  const result = await provider.generateText(prompt);
  console.log(result.text.slice(0, 200));
};

main().catch((error) => {
  console.error("Falha ao validar Gemini:", error);
  process.exit(1);
});
