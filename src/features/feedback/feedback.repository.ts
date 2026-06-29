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
