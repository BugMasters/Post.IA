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
    const message = error instanceof Error ? error.message : "Erro ao cadastrar.";
    return { ok: false, error: message };
  }
}
