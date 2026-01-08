import { prisma } from "@/infra/db/prisma";
import type { ProfileInput } from "@/domain/profile";

type ProfileData = Omit<ProfileInput, "userId">;

export async function getProfileForUser(userId: string) {
  return prisma.userProfile.findUnique({
    where: { userId },
  });
}

export async function upsertProfileForUser(userId: string, data: ProfileData) {
  return prisma.userProfile.upsert({
    where: { userId },
    update: { ...data },
    create: { ...data, userId },
  });
}
