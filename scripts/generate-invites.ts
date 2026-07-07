/**
 * Gera códigos de convite para o beta fechado.
 *
 * Uso: npx tsx scripts/generate-invites.ts [quantidade]
 * (usa o DATABASE_URL do ambiente — apontar para prod para gerar convites reais)
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma";

// Sem 0/O/1/I para o código ser fácil de digitar.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomSegment(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function buildCode(): string {
  return `PIA-${randomSegment(4)}-${randomSegment(4)}`;
}

async function main() {
  const count = Math.max(1, Number(process.argv[2]) || 10);
  const prisma = new PrismaClient();

  try {
    const codes = Array.from({ length: count }, buildCode);
    await prisma.inviteCode.createMany({
      data: codes.map((code) => ({ code })),
      skipDuplicates: true,
    });
    console.log(`${codes.length} convites gerados:`);
    for (const code of codes) {
      console.log(`  ${code}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Falha ao gerar convites:", error);
  process.exit(1);
});
