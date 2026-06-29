import { describe, it, expect, vi } from "vitest";

const create = vi.fn(async ({ data }: any) => ({ id: "p1", ...data }));
const findMany = vi.fn(async (_arg?: any) => [] as any[]);
vi.mock("@/infra/db/prisma", () => ({
  prisma: { post: { create: (a: unknown) => create(a), findMany: (a: unknown) => findMany(a) } },
}));

import { savePost, listPosts } from "../posts.repository";

describe("posts.repository", () => {
  it("salva post com userId e variants", async () => {
    const res = await savePost("u1", {
      theme: "x", platform: "LINKEDIN", length: "MEDIO", objective: "ENSINAR",
      variants: [{ label: "Direto", content: "abc" }],
    });
    expect(res.id).toBe("p1");
    expect(create.mock.calls[0][0].data.userId).toBe("u1");
  });

  it("lista filtrando por userId", async () => {
    await listPosts("u1");
    expect(findMany.mock.calls[0][0].where.userId).toBe("u1");
  });
});
