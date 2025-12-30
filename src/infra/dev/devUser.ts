import { prisma } from "@/infra/db/prisma";

export const DEV_USER_EMAIL = "dev@postia.local";

export async function ensureDevUser() {
  const existingUser = await prisma.user.findUnique({
    where: { email: DEV_USER_EMAIL },
  });

  if (existingUser) {
    return existingUser;
  }

  return prisma.user.create({
    data: {
      email: DEV_USER_EMAIL,
      name: "Post IA Dev",
    },
  });
}
