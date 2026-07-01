// src/features/positioning/memory-version.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/infra/auth/require-user";
import { updatePositioningMemory } from "./positioning.repository";
import {
  getMemoryVersion,
  recordMemoryVersion,
} from "./memory-version.repository";

export type RevertMemoryResult = { ok: true } | { ok: false; error: string };

export async function revertMemoryVersionAction(
  versionId: string
): Promise<RevertMemoryResult> {
  const user = await requireUser();
  try {
    const version = await getMemoryVersion(user.id, versionId);
    if (!version) {
      return { ok: false, error: "Versão não encontrada." };
    }

    await updatePositioningMemory(user.id, version.memory);
    // Reverter cria uma nova versão a partir da antiga — nunca destrói o histórico.
    try {
      await recordMemoryVersion(user.id, version.memory, "manual");
    } catch (versionError) {
      console.error("[revertMemoryVersionAction] falha ao versionar revert:", versionError);
    }

    revalidatePath("/posicionamento");
    return { ok: true };
  } catch (error) {
    console.error("[revertMemoryVersionAction] erro ao reverter memória:", error);
    return { ok: false, error: "Não foi possível reverter a memória." };
  }
}
