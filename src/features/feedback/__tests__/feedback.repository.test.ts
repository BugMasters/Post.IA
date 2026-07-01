import { describe, it, expect, vi } from "vitest";

const create = vi.fn((_a: unknown) => Promise.resolve({ id: "f1" }));
const count = vi.fn((_a: unknown) => Promise.resolve(2));
vi.mock("@/infra/db/prisma", () => ({
  prisma: { postFeedback: { create: (a: unknown) => create(a), count: (a: unknown) => count(a) } },
}));

import { recordFeedback, countUnprocessedFeedback } from "../feedback.repository";

describe("feedback.repository", () => {
  it("grava feedback com userId", async () => {
    await recordFeedback("u1", { postId: "p1", variantLabel: "Direto", signal: "liked" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (create.mock.calls[0] as [any])[0];
    expect(arg.data.userId).toBe("u1");
    expect(arg.data.processed).toBe(false);
  });

  it("conta só não processados do usuário", async () => {
    const n = await countUnprocessedFeedback("u1");
    expect(n).toBe(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (count.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ userId: "u1", processed: false });
  });
});
