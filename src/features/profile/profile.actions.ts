import type { AuthorProfileInput } from "@/domain/authorProfile";
import { prisma } from "@/infra/db/prisma";

export async function getAuthorProfileForUser(userId: string) {
  return prisma.authorProfile.findUnique({
    where: { userId },
  });
}

export async function upsertAuthorProfileForUser(
  userId: string,
  data: AuthorProfileInput
) {
  return prisma.authorProfile.upsert({
    where: { userId },
    create: {
      userId,
      ...data,
    },
    update: data,
  });
}
