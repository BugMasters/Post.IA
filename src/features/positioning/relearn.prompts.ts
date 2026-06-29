import type { PostFeedback } from "@/generated/prisma";

type FeedbackLike = Pick<PostFeedback, "variantLabel" | "signal" | "editedContent" | "note">;

const signalLabel: Record<string, string> = {
  liked: "GOSTOU",
  disliked: "NÃO GOSTOU",
  edited: "EDITOU",
  more_like_this: "QUER MAIS ASSIM",
};

export function buildRelearnPrompt(currentMemory: string, feedbacks: FeedbackLike[]): string {
  const signals = feedbacks
    .map((f) => {
      const parts = [`- [${signalLabel[f.signal] ?? f.signal}] variação "${f.variantLabel}"`];
      if (f.note) parts.push(`nota: ${f.note}`);
      if (f.editedContent) parts.push(`edição: ${f.editedContent}`);
      return parts.join(" | ");
    })
    .join("\n");

  return [
    "Você mantém o documento de posicionamento de um expert.",
    "Atualize a MEMÓRIA atual incorporando os sinais de feedback abaixo.",
    "Mantenha o que segue válido, ajuste tom/preferências reveladas pelo feedback.",
    "Retorne APENAS o novo texto da memória (markdown, 8-15 linhas). Sem JSON, sem comentários.",
    "",
    "MEMÓRIA ATUAL:",
    currentMemory || "(vazia)",
    "",
    "SINAIS DE FEEDBACK:",
    signals,
  ].join("\n");
}
