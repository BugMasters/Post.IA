"use server";

import { ZodError } from "zod";
import { signupSchema, type SignupValues } from "@/domain/auth";
import { createUserWithPassword } from "./auth.repository";

export type SignupResult = { ok: true } | { ok: false; error: string };

export async function signupAction(values: SignupValues): Promise<SignupResult> {
  try {
    const input = signupSchema.parse(values);
    await createUserWithPassword(
      input.email,
      input.password,
      input.inviteCode,
      input.name
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    // Erros de negócio esperados; qualquer outro vira mensagem genérica
    // para não vazar detalhes internos (Prisma, conexão, etc.).
    const KNOWN_BUSINESS_ERRORS = [
      "Email já cadastrado.",
      "Código de convite inválido.",
    ];
    if (error instanceof Error && KNOWN_BUSINESS_ERRORS.includes(error.message)) {
      return { ok: false, error: error.message };
    }
    console.error("[signupAction] erro ao cadastrar:", error);
    return { ok: false, error: "Não foi possível criar a conta." };
  }
}
