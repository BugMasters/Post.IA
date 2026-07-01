import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn((_a?: unknown) => Promise.resolve({ id: "d1" }));
const findMany = vi.fn((_a?: unknown) => Promise.resolve([]));
const deleteMany = vi.fn((_a?: unknown) => Promise.resolve({ count: 1 }));
vi.mock("@/infra/db/prisma", () => ({
  prisma: {
    draft: {
      create: (a: unknown) => create(a),
      findMany: (a: unknown) => findMany(a),
      deleteMany: (a: unknown) => deleteMany(a),
    },
  },
}));

import { createDraft, listDrafts, deleteDraft } from "../draft.repository";

describe("draft.repository", () => {
  beforeEach(() => {
    create.mockClear();
    findMany.mockClear();
    deleteMany.mockClear();
  });

  it("cria rascunho com userId", async () => {
    await createDraft("u1", { label: "Direto", content: "x" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (create.mock.calls[0] as [any])[0];
    expect(arg.data.userId).toBe("u1");
    expect(arg.data.label).toBe("Direto");
  });

  it("lista escopado por userId, mais recentes primeiro", async () => {
    await listDrafts("u1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (findMany.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("exclui escopado por userId via deleteMany", async () => {
    await deleteDraft("u1", "d1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (deleteMany.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ id: "d1", userId: "u1" });
  });
});
