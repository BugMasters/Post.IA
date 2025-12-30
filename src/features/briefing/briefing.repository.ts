import { prisma } from "@/infra/db/prisma";
import { BriefingInput } from "@/domain/briefing";

export async function upsertBriefingForUser(userId: string, input: BriefingInput) {
  const latestBriefing = await getLatestBriefingForUser(userId);

  if (latestBriefing) {
    return prisma.briefing.update({
      where: { id: latestBriefing.id },
      data: { ...input },
    });
  }

  return prisma.briefing.create({
    data: { ...input, userId },
  });
}

export async function getLatestBriefingForUser(userId: string) {
  return prisma.briefing.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}
