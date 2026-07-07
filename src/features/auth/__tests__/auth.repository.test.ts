import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const userCreate = vi.fn();
const inviteUpdateMany = vi.fn();

vi.mock("@/infra/db/prisma", () => {
  const tx = {
    user: { create: (a: unknown) => userCreate(a) },
    inviteCode: { updateMany: (a: unknown) => inviteUpdateMany(a) },
  };
  return {
    prisma: {
      user: { findUnique: (a: unknown) => findUnique(a) },
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

import { createUserWithPassword } from "../auth.repository";

describe("createUserWithPassword", () => {
  beforeEach(() => {
    findUnique.mockReset();
    userCreate.mockReset();
    inviteUpdateMany.mockReset();
  });

  it("rejeita email já cadastrado", async () => {
    findUnique.mockResolvedValue({ id: "u1" });
    await expect(
      createUserWithPassword("a@a.com", "12345678", "PIA-AB12", "A")
    ).rejects.toThrow(/já cadastrado/i);
  });

  it("salva senha como hash, nunca em texto puro", async () => {
    findUnique.mockResolvedValue(null);
    userCreate.mockImplementation(async ({ data }: any) => ({
      id: "u1",
      email: data.email,
    }));
    inviteUpdateMany.mockResolvedValue({ count: 1 });

    await createUserWithPassword("a@a.com", "segredo123", "PIA-AB12", "A");

    const passed = userCreate.mock.calls[0][0].data.passwordHash as string;
    expect(passed).not.toBe("segredo123");
    expect(passed.length).toBeGreaterThan(20);
  });

  it("consome o convite só se ainda não usado (updateMany condicional)", async () => {
    findUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "u1", email: "a@a.com" });
    inviteUpdateMany.mockResolvedValue({ count: 1 });

    await createUserWithPassword("a@a.com", "12345678", "PIA-AB12", "A");

    expect(inviteUpdateMany).toHaveBeenCalledWith({
      where: { code: "PIA-AB12", usedById: null },
      data: { usedById: "u1", usedAt: expect.any(Date) },
    });
  });

  it("rejeita convite inválido ou já usado (count 0) com mensagem exata", async () => {
    findUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "u1", email: "a@a.com" });
    inviteUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      createUserWithPassword("a@a.com", "12345678", "PIA-USADO", "A")
    ).rejects.toThrow("Código de convite inválido.");
  });
});
