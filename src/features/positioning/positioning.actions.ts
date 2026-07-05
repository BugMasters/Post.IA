"use server";

import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/infra/auth/require-user";
import { positioningPatchSchema } from "@/domain/onboarding";
import { updatePositioningProfile } from "./positioning.repository";
import { recordMemoryVersion } from "./memory-version.repository";

export type UpdatePositioningResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updatePositioningProfileAction(
  patch: unknown
): Promise<UpdatePositioningResult> {
  const user = await requireUser();
  try {
    const parsed = positioningPatchSchema.parse(patch);
    await updatePositioningProfile(user.id, parsed);
    if (parsed.positioningMemory) {
      try {
        await recordMemoryVersion(user.id, parsed.positioningMemory, "manual");
      } catch (versionError) {
        console.error("[updatePositioningProfileAction] falha ao versionar memória:", versionError);
      }
    }
    revalidatePath("/posicionamento");
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    console.error("[updatePositioningProfileAction] erro ao salvar posicionamento:", error);
    return { ok: false, error: "Não foi possível salvar o posicionamento." };
  }
}
