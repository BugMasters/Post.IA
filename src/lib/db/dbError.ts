import { Prisma } from "@/generated/prisma";

export type DbUserMessage = {
  code?: string;
  message: string;
  devDetails?: string;
};

const isDev = process.env.NODE_ENV !== "production";

const DEFAULT_DB_MESSAGE = "Não foi possível acessar o banco de dados.";

const MESSAGE_BY_CODE: Record<string, string> = {
  P1000:
    "Banco local com credenciais inválidas. Verifique DATABASE_URL e as variáveis POSTGRES_* do docker-compose. Se você alterou senha depois do volume criado, pode ser necessário resetar o volume.",
  P1001: "Banco local indisponível. Suba o Postgres no Docker e tente novamente.",
  P2021: "Migrations não aplicadas. Rode migrate dev (local) ou migrate deploy (prod).",
};

const shortSnippet = (value: string, limit = 180) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
};

const getPrismaCode = (error: unknown) => {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

const resolveCode = (error: unknown) => {
  const prismaCode = getPrismaCode(error);
  if (prismaCode) return prismaCode;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return getPrismaCode(error);
  }
  if (error instanceof Error && error.name === "MissingUserProfileTableError") {
    return "P2021";
  }
  return undefined;
};

const buildDevDetails = (code?: string, error?: Error) => {
  if (!isDev) return undefined;
  const snippet = error?.message ? shortSnippet(error.message) : undefined;
  const parts = [code, snippet].filter(Boolean);
  return parts.length ? parts.join(" | ") : undefined;
};

export const toDbUserMessage = (error: unknown): DbUserMessage | null => {
  const code = resolveCode(error);
  const message = code ? MESSAGE_BY_CODE[code] : DEFAULT_DB_MESSAGE;
  const errInstance = error instanceof Error ? error : undefined;
  const devDetails = buildDevDetails(code, errInstance);

  if (code || errInstance) {
    return { code, message, devDetails };
  }

  return null;
};

export const formatDbUserMessage = (value: DbUserMessage) => {
  if (!isDev || !value.devDetails) return value.message;
  return `${value.message} (dev=${value.devDetails})`;
};
