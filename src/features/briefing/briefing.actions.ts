'use server';
import { BriefingFormValues, briefingSchema } from "@/domain/briefing";
import { ensureDevUser } from "@/infra/dev/devUser";
import { upsertBriefingForUser } from "./briefing.repository";
import { formatDbUserMessage, toDbUserMessage } from "@/lib/db/dbError";
import { ZodError } from "zod";

export type SaveBriefingResult =
  | { ok: true }
  | { ok: false; error: string };

export async function saveBriefingAction(
  values: BriefingFormValues
): Promise<SaveBriefingResult> {
  try {
    const input = briefingSchema.parse(values);
    const user = await ensureDevUser();

    await upsertBriefingForUser(user.id, input);

    return { ok: true };
  } catch (e) {
    console.error("[saveBriefingAction] failed:", e);

    if (e instanceof ZodError) {
      const msg = e.issues.map((i) => i.message).join(", ");
      return { ok: false, error: msg || "Dados inválidos." };
    }

    const dbMessage = toDbUserMessage(e);
    if (dbMessage) {
      return { ok: false, error: formatDbUserMessage(dbMessage) };
    }

    const message = e instanceof Error ? e.message : "Erro desconhecido ao salvar.";
    return { ok: false, error: message };
  }
}
