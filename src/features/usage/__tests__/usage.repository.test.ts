import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const create = vi.fn();
const count = vi.fn();

vi.mock("@/infra/db/prisma", () => ({
  prisma: {
    usageEvent: {
      create: (a: unknown) => create(a),
      count: (a: unknown) => count(a),
    },
  },
}));

import {
  recordUsage,
  countUsageToday,
  getQuotaStatus,
} from "../usage.repository";

describe("usage.repository", () => {
  beforeEach(() => {
    create.mockReset();
    count.mockReset();
    vi.useFakeTimers();
    // 12:00 em SP
    vi.setSystemTime(new Date("2026-07-05T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.DAILY_GENERATION_LIMIT;
  });

  it("recordUsage grava evento escopado ao usuário com durationMs", async () => {
    create.mockResolvedValue({ id: "e1" });
    await recordUsage("user-1", "generate", 1234);
    expect(create).toHaveBeenCalledWith({
      data: { userId: "user-1", kind: "generate", durationMs: 1234 },
    });
  });

  it("countUsageToday conta só o usuário, o kind e o dia local de SP", async () => {
    count.mockResolvedValue(3);
    const result = await countUsageToday("user-1", "generate");
    expect(result).toBe(3);
    expect(count).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        kind: "generate",
        createdAt: { gte: new Date("2026-07-05T03:00:00.000Z") },
      },
    });
  });

  it("getQuotaStatus usa DAILY_GENERATION_LIMIT da env", async () => {
    process.env.DAILY_GENERATION_LIMIT = "5";
    count.mockResolvedValue(5);
    const status = await getQuotaStatus("user-1", "generate");
    expect(status).toEqual({ used: 5, limit: 5, remaining: 0 });
  });

  it("getQuotaStatus usa default 10 para generate sem env", async () => {
    count.mockResolvedValue(2);
    const status = await getQuotaStatus("user-1", "generate");
    expect(status).toEqual({ used: 2, limit: 10, remaining: 8 });
  });

  it("remaining nunca fica negativo", async () => {
    count.mockResolvedValue(99);
    const status = await getQuotaStatus("user-1", "generate");
    expect(status.remaining).toBe(0);
  });
});
