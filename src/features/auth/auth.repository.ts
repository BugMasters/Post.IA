import bcrypt from "bcryptjs";
import { prisma } from "@/infra/db/prisma";

export async function createUserWithPassword(
  email: string,
  password: string,
  name?: string
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("Email já cadastrado.");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: { email, name, passwordHash },
    select: { id: true, email: true },
  });
}
