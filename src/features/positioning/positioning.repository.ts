import { prisma } from "@/infra/db/prisma";
import type { PositioningSeed } from "@/domain/onboarding";

export async function getPositioningProfile(userId: string) {
  return prisma.positioningProfile.findUnique({ where: { userId } });
}

export async function upsertPositioningProfile(userId: string, seed: PositioningSeed) {
  return prisma.positioningProfile.upsert({
    where: { userId },
    create: { userId, ...seed },
    update: seed,
  });
}

export async function updatePositioningMemory(userId: string, positioningMemory: string) {
  return prisma.positioningProfile.update({
    where: { userId },
    data: { positioningMemory },
  });
}
