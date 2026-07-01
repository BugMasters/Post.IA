import { prisma } from "@/infra/db/prisma";
import type { FeedbackInput } from "@/domain/feedback";

export async function recordFeedback(userId: string, input: FeedbackInput) {
  return prisma.postFeedback.create({
    data: { userId, processed: false, ...input },
  });
}

export async function countUnprocessedFeedback(userId: string) {
  return prisma.postFeedback.count({ where: { userId, processed: false } });
}

export async function listUnprocessedFeedback(userId: string) {
  return prisma.postFeedback.findMany({ where: { userId, processed: false } });
}

export async function markFeedbackProcessed(ids: string[]) {
  return prisma.postFeedback.updateMany({
    where: { id: { in: ids } },
    data: { processed: true },
  });
}

// --- Exemplos positivos para few-shot ---

export type PositiveExample = { label: string; content: string };

// Sinais que indicam aprovação do usuário
const POSITIVE_SIGNALS = ["more_like_this", "edited", "liked"] as const;

// Teto de candidatos lidos do banco antes de ranquear/cortar em memória.
const POSITIVE_EXAMPLE_CANDIDATE_POOL = 50;

// Prioridade: more_like_this(0) > edited(1) > liked(2)
const SIGNAL_RANK: Record<string, number> = {
  more_like_this: 0,
  edited: 1,
  liked: 2,
};

/**
 * Retorna os melhores exemplos positivos do usuário para uso em few-shot prompting.
 * Prioriza more_like_this > edited > liked; desempate por createdAt desc.
 * Conteúdo: editedContent quando sinal=edited e presente; senão variante do post com label correspondente.
 */
export async function listPositiveExamples(
  userId: string,
  limit: number
): Promise<PositiveExample[]> {
  // Limita o pool de candidatos aos N feedbacks positivos mais recentes para não
  // varrer todo o histórico do usuário no hot path da geração.
  const rows = await prisma.postFeedback.findMany({
    where: { userId, signal: { in: [...POSITIVE_SIGNALS] } },
    include: { post: true },
    orderBy: { createdAt: "desc" },
    take: POSITIVE_EXAMPLE_CANDIDATE_POOL,
  });

  // Reordena por prioridade de sinal; dentro do mesmo rank, desempata por createdAt desc.
  const ranked = [...rows].sort((a, b) => {
    const rank = (SIGNAL_RANK[a.signal] ?? 99) - (SIGNAL_RANK[b.signal] ?? 99);
    if (rank !== 0) return rank;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const examples: PositiveExample[] = [];
  for (const row of ranked) {
    if (examples.length >= limit) break;
    const content = resolveExampleContent(row);
    if (content) examples.push({ label: row.variantLabel, content });
  }
  return examples;
}

type FeedbackWithPost = {
  signal: string;
  variantLabel: string;
  editedContent: string | null;
  post: { variants: unknown };
};

/** Resolve o conteúdo do exemplo: editedContent ou variante do post com label correspondente. */
function resolveExampleContent(row: FeedbackWithPost): string | null {
  // Caso edited: usa conteúdo editado quando disponível
  if (row.signal === "edited" && row.editedContent?.trim()) {
    return row.editedContent.trim();
  }
  // Demais casos: busca variante do post pelo label
  const variants = row.post?.variants;
  if (Array.isArray(variants)) {
    const match = variants.find(
      (v): v is { label: string; content: string } =>
        typeof v === "object" &&
        v !== null &&
        (v as { label?: unknown }).label === row.variantLabel &&
        typeof (v as { content?: unknown }).content === "string"
    );
    if (match && match.content.trim()) return match.content.trim();
  }
  return null;
}
