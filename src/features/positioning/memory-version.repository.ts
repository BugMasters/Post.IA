import { prisma } from "@/infra/db/prisma";
import type { MemorySource } from "@/domain/memory-version";

export async function recordMemoryVersion(
  userId: string,
  memory: string,
  source: MemorySource
) {
  return prisma.positioningMemoryVersion.create({
    data: { userId, memory, source },
  });
}

export async function listMemoryVersions(userId: string) {
  return prisma.positioningMemoryVersion.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getMemoryVersion(userId: string, id: string) {
  return prisma.positioningMemoryVersion.findFirst({ where: { id, userId } });
}
