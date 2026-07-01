import { describe, it, expect, vi } from "vitest";

const create = vi.fn(async ({ data }: any) => ({ id: "p1", ...data }));
const findMany = vi.fn(async (_arg?: any) => [] as any[]);
const updateMany = vi.fn((_a?: unknown) => Promise.resolve({ count: 1 }));
vi.mock("@/infra/db/prisma", () => ({
  prisma: {
    post: {
      create: (a: unknown) => create(a),
      findMany: (a: unknown) => findMany(a),
      updateMany: (a: unknown) => updateMany(a),
    },
  },
}));

import { savePost, listPosts, updatePostVariants } from "../posts.repository";

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

describe("updatePostVariants", () => {
  it("atualiza variantes escopado por userId via updateMany", async () => {
    const variants = [{ label: "Direto", content: "novo" }];
    await updatePostVariants("u1", "p1", variants);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (updateMany.mock.calls.at(-1) as unknown as [any])[0];
    expect(arg.where).toEqual({ id: "p1", userId: "u1" });
    expect(arg.data.variants).toEqual(variants);
  });
});
