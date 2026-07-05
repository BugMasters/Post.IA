"use server";

import { ZodError } from "zod";
import { signupSchema, type SignupValues } from "@/domain/auth";
import { createUserWithPassword } from "./auth.repository";

export type SignupResult = { ok: true } | { ok: false; error: string };

export async function signupAction(values: SignupValues): Promise<SignupResult> {
  try {
    const input = signupSchema.parse(values);
    await createUserWithPassword(input.email, input.password, input.name);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    // Único erro de negócio esperado; qualquer outro vira mensagem genérica
    // para não vazar detalhes internos (Prisma, conexão, etc.).
    if (error instanceof Error && error.message === "Email já cadastrado.") {
      return { ok: false, error: error.message };
    }
    console.error("[signupAction] erro ao cadastrar:", error);
    return { ok: false, error: "Não foi possível criar a conta." };
  }
}
