"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { authorProfileSchema, type AuthorProfileValues } from "@/domain/authorProfile";
import { ensureDevUser } from "@/infra/dev/devUser";

import { upsertAuthorProfileForUser } from "./profile.actions";

export type SaveAuthorProfileResult = { ok: true } | { ok: false; error: string };

export async function saveAuthorProfileAction(
  values: AuthorProfileValues
): Promise<SaveAuthorProfileResult> {
  try {
    const input = authorProfileSchema.parse(values);
    const user = await ensureDevUser();

    await upsertAuthorProfileForUser(user.id, input);

    revalidatePath("/profile");
    revalidatePath("/dashboard");
    revalidatePath("/generate");

    return { ok: true };
  } catch (error) {
    console.error("[saveAuthorProfileAction] failed:", error);

    if (error instanceof ZodError) {
      const message = error.issues.map((issue) => issue.message).join(", ");
      return { ok: false, error: message || "Dados inválidos." };
    }

    const message =
      error instanceof Error ? error.message : "Erro desconhecido ao salvar o perfil.";

    return { ok: false, error: message };
  }
}
