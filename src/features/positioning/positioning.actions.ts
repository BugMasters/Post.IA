"use server";

import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/infra/auth/require-user";
import { positioningPatchSchema } from "@/domain/onboarding";
import { updatePositioningProfile } from "./positioning.repository";

export type UpdatePositioningResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updatePositioningProfileAction(
  patch: unknown
): Promise<UpdatePositioningResult> {
  try {
    const parsed = positioningPatchSchema.parse(patch);
    const user = await requireUser();
    await updatePositioningProfile(user.id, parsed);
    revalidatePath("/posicionamento");
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    const message = error instanceof Error ? error.message : "Erro ao salvar posicionamento.";
    return { ok: false, error: message };
  }
}
