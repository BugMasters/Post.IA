import { prisma } from "@/infra/db/prisma";

export async function addToWaitlist(email: string) {
  return prisma.waitlistEntry.upsert({
    where: { email },
    create: { email },
    update: {},
  });
}
