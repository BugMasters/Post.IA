"use server";

import { ZodError } from "zod";
import { ensureDevUser } from "@/infra/dev/devUser";
import { profileFormSchema, type ProfileFormValues } from "@/domain/profile";
import { formatDbUserMessage, toDbUserMessage } from "@/lib/db/dbError";
import { getProfileForUser, upsertProfileForUser } from "./profile.repository";
import { isMissingProfileTableError, MissingUserProfileTableError } from "./profile.errors";

export async function getUserProfile() {
  const user = await ensureDevUser();
  return getProfileForUser(user.id);
}

export async function upsertUserProfile(values: ProfileFormValues) {
  try {
    const input = profileFormSchema.parse(values);
    const user = await ensureDevUser();

    await upsertProfileForUser(user.id, input);

    return { ok: true } as const;
  } catch (error) {
    if (isMissingProfileTableError(error)) {
      const dbMessage = toDbUserMessage(new MissingUserProfileTableError());
      if (dbMessage) {
        return { ok: false, error: formatDbUserMessage(dbMessage) } as const;
      }
    }

    if (error instanceof ZodError) {
      const msg = error.issues.map((issue) => issue.message).join(", ");
      return { ok: false, error: msg || "Dados inválidos." } as const;
    }

    const dbMessage = toDbUserMessage(error);
    if (dbMessage) {
      return { ok: false, error: formatDbUserMessage(dbMessage) } as const;
    }

    const message =
      error instanceof Error ? error.message : "Erro desconhecido ao salvar.";
    return { ok: false, error: message } as const;
  }
}
