import { Prisma } from "@/generated/prisma";

export class MissingUserProfileTableError extends Error {
  constructor(message = "Migrations não aplicadas: tabela UserProfile não existe.") {
    super(message);
    this.name = "MissingUserProfileTableError";
  }
}

export const isMissingProfileTableError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
