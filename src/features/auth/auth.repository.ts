import bcrypt from "bcryptjs";
import { prisma } from "@/infra/db/prisma";

export async function createUserWithPassword(
  email: string,
  password: string,
  inviteCode: string,
  name?: string
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("Email já cadastrado.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Criação do usuário e consumo do convite são atômicos: se o código for
  // inválido ou outra requisição consumi-lo antes (count 0), a transação
  // reverte e o usuário não é criado.
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name, passwordHash },
      select: { id: true, email: true },
    });

    const consumed = await tx.inviteCode.updateMany({
      where: { code: inviteCode, usedById: null },
      data: { usedById: user.id, usedAt: new Date() },
    });

    if (consumed.count === 0) {
      throw new Error("Código de convite inválido.");
    }

    return user;
  });
}
