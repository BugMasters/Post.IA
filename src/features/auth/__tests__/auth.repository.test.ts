import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();

vi.mock("@/infra/db/prisma", () => ({
  prisma: { user: { findUnique: (a: unknown) => findUnique(a), create: (a: unknown) => create(a) } },
}));

import { createUserWithPassword } from "../auth.repository";

describe("createUserWithPassword", () => {
  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
  });

  it("rejeita email já cadastrado", async () => {
    findUnique.mockResolvedValue({ id: "u1" });
    await expect(
      createUserWithPassword("a@a.com", "12345678", "A")
    ).rejects.toThrow(/já cadastrado/i);
  });

  it("salva senha como hash, nunca em texto puro", async () => {
    findUnique.mockResolvedValue(null);
    create.mockImplementation(async ({ data }: any) => ({ id: "u1", email: data.email }));

    await createUserWithPassword("a@a.com", "segredo123", "A");

    const passed = create.mock.calls[0][0].data.passwordHash as string;
    expect(passed).not.toBe("segredo123");
    expect(passed.length).toBeGreaterThan(20);
  });
});
