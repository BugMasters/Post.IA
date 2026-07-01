"use server";

import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/infra/auth/require-user";
import { draftInputSchema } from "@/domain/draft";
import { createDraft, deleteDraft } from "./draft.repository";

export type DraftActionResult = { ok: true } | { ok: false; error: string };

export async function createDraftAction(input: unknown): Promise<DraftActionResult> {
  const user = await requireUser();
  try {
    const parsed = draftInputSchema.parse(input);
    await createDraft(user.id, parsed);
    revalidatePath("/rascunhos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    console.error("[createDraftAction] erro ao salvar rascunho:", error);
    return { ok: false, error: "Não foi possível salvar o rascunho." };
  }
}

export async function deleteDraftAction(id: string): Promise<DraftActionResult> {
  const user = await requireUser();
  try {
    await deleteDraft(user.id, id);
    revalidatePath("/rascunhos");
    return { ok: true };
  } catch (error) {
    console.error("[deleteDraftAction] erro ao excluir rascunho:", error);
    return { ok: false, error: "Não foi possível excluir o rascunho." };
  }
}
