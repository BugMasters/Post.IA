import { prisma } from "@/infra/db/prisma";
import type { DraftInput } from "@/domain/draft";

export async function createDraft(userId: string, input: DraftInput) {
  return prisma.draft.create({ data: { userId, ...input } });
}

export async function listDrafts(userId: string) {
  return prisma.draft.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteDraft(userId: string, id: string) {
  return prisma.draft.deleteMany({ where: { id, userId } });
}
