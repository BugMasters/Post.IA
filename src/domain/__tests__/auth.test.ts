import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { signupSchema } from "@/domain/auth";

const BASE = {
  name: "Diogo",
  email: "a@a.com",
  password: "12345678",
};

describe("signupSchema — inviteCode", () => {
  it("aceita signup com código de convite", () => {
    const parsed = signupSchema.parse({ ...BASE, inviteCode: " PIA-AB12 " });
    expect(parsed.inviteCode).toBe("PIA-AB12");
  });

  it("rejeita signup sem código de convite", () => {
    expect(() => signupSchema.parse(BASE)).toThrowError(ZodError);
  });

  it("rejeita código vazio com mensagem pt-BR", () => {
    try {
      signupSchema.parse({ ...BASE, inviteCode: "  " });
      expect.unreachable("deveria ter lançado ZodError");
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues[0].message).toBe(
        "Informe o código de convite."
      );
    }
  });
});
