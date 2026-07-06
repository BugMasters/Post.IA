import { prisma } from "@/infra/db/prisma";
import type { UsageKind } from "@/domain/usage";
import {
  resolveDailyLimit,
  startOfCurrentDaySaoPaulo,
} from "./usage.helpers";

const QUOTA_ENV: Record<
  "generate" | "regenerate",
  { envVar: string; fallback: number }
> = {
  generate: { envVar: "DAILY_GENERATION_LIMIT", fallback: 10 },
  regenerate: { envVar: "DAILY_REGENERATION_LIMIT", fallback: 20 },
};

export async function recordUsage(
  userId: string,
  kind: UsageKind,
  durationMs?: number
) {
  return prisma.usageEvent.create({
    data: { userId, kind, durationMs: durationMs ?? null },
  });
}

export async function countUsageToday(userId: string, kind: UsageKind) {
  return prisma.usageEvent.count({
    where: {
      userId,
      kind,
      createdAt: { gte: startOfCurrentDaySaoPaulo(new Date()) },
    },
  });
}

export async function getQuotaStatus(
  userId: string,
  kind: "generate" | "regenerate"
) {
  const { envVar, fallback } = QUOTA_ENV[kind];
  const limit = resolveDailyLimit(process.env[envVar], fallback);
  const used = await countUsageToday(userId, kind);
  return { used, limit, remaining: Math.max(0, limit - used) };
}
