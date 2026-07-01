import {
  chatMessagesSchema,
  positioningSeedSchema,
  type ChatMessage,
  type PositioningSeed,
} from "@/domain/onboarding";

export function buildOnboardingSystemPrompt(): string {
  return [
    "Você é um estrategista de marca pessoal entrevistando um expert.",
    "Objetivo: entender nicho, público, oferta, diferencial, tom e como ele quer ser percebido.",
    "Faça UMA pergunta por vez, curta e em português. Adapte pela resposta anterior.",
    "Não repita perguntas já respondidas. Seja caloroso e objetivo.",
    'Responda APENAS com o texto da pergunta. Não escreva rótulos como "ENTREVISTADOR:" nem prefixos.',
    "Quando tiver contexto suficiente, responda apenas com: [PRONTO]",
  ].join("\n");
}

export function buildNextQuestionPrompt(messages: ChatMessage[]): string {
  const history = messages
    .map((m) => `${m.role === "assistant" ? "ENTREVISTADOR" : "EXPERT"}: ${m.content}`)
    .join("\n");
  return `${buildOnboardingSystemPrompt()}\n\nHistórico:\n${history}\n\nPróxima pergunta (ou [PRONTO]):`;
}

export function buildMemorySynthesisPrompt(messages: ChatMessage[]): string {
  const history = messages
    .map((m) => `${m.role === "assistant" ? "ENTREVISTADOR" : "EXPERT"}: ${m.content}`)
    .join("\n");
  return [
    "Com base na entrevista abaixo, sintetize o posicionamento do expert.",
    'Retorne APENAS JSON: {"niche","audience","offer","differentiation","tonePreference","ctaPreference","positioningMemory"}.',
    'O campo "positioningMemory" é um resumo denso em markdown (8-15 linhas) que outra IA usará para escrever posts na voz dessa pessoa.',
    "",
    history,
  ].join("\n");
}

const cleanup = (raw: string) =>
  raw.replace(/```(?:json)?/gi, "").trim();

export function parseSynthesisPayload(raw: string): PositioningSeed {
  const cleaned = cleanup(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Síntese sem JSON válido.");
  const parsed = JSON.parse(match[0]);
  return positioningSeedSchema.parse(parsed);
}

export { chatMessagesSchema };
