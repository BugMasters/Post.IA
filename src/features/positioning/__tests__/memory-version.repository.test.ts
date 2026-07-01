import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn((_a?: unknown) => Promise.resolve({ id: "v1" }));
const findMany = vi.fn((_a?: unknown) => Promise.resolve([]));
const findFirst = vi.fn((_a?: unknown) => Promise.resolve(null));
vi.mock("@/infra/db/prisma", () => ({
  prisma: {
    positioningMemoryVersion: {
      create: (a: unknown) => create(a),
      findMany: (a: unknown) => findMany(a),
      findFirst: (a: unknown) => findFirst(a),
    },
  },
}));

import {
  recordMemoryVersion,
  listMemoryVersions,
  getMemoryVersion,
} from "../memory-version.repository";

describe("memory-version.repository", () => {
  beforeEach(() => {
    create.mockClear();
    findMany.mockClear();
    findFirst.mockClear();
  });

  it("grava versão com userId, memory e source", async () => {
    await recordMemoryVersion("u1", "minha memória", "relearn");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (create.mock.calls[0] as [any])[0];
    expect(arg.data).toEqual({ userId: "u1", memory: "minha memória", source: "relearn" });
  });

  it("lista escopado por userId, mais recentes primeiro", async () => {
    await listMemoryVersions("u1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (findMany.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("busca uma versão escopada por userId", async () => {
    await getMemoryVersion("u1", "v1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (findFirst.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ id: "v1", userId: "u1" });
  });
});
