import { describe, it, expect, vi, beforeEach } from "vitest";

const upsert = vi.fn(async (_a?: unknown) => ({ id: "w1" }));
vi.mock("@/infra/db/prisma", () => ({
  prisma: { waitlistEntry: { upsert: (a: unknown) => upsert(a) } },
}));

import { joinWaitlistAction } from "../waitlist.actions";

describe("joinWaitlistAction", () => {
  beforeEach(() => upsert.mockClear());

  it("aceita email válido", async () => {
    const res = await joinWaitlistAction("a@a.com");
    expect(res.ok).toBe(true);
  });

  it("rejeita email inválido sem tocar o banco", async () => {
    const res = await joinWaitlistAction("nao-email");
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});
