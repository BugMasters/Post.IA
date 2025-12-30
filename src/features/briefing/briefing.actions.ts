import { z } from "zod";
import { BriefingInput, briefingSchema } from "@/domain/briefing";
import { ensureDevUser } from "@/infra/dev/devUser";
import { upsertBriefingForUser } from "./briefing.repository";

export type SaveBriefingResult = { ok: true } | { ok: false; error: string };

function toString(value: FormDataEntryValue | null) {
  return value ? String(value) : "";
}

function toStringArray(values: string[]) {
  return values.map((value) => value).filter(Boolean);
}

export async function saveBriefingAction(
  formData: FormData,
): Promise<SaveBriefingResult> {
  try {
    const devUser = await ensureDevUser();
    const payload: BriefingInput = {
      goal: toString(formData.get("goal")),
      audience: toString(formData.get("audience")),
      audienceLevel: toString(formData.get("audienceLevel")),
      offer: toString(formData.get("offer")),
      differentiation: toString(formData.get("differentiation")),
      tone: toStringArray(formData.getAll("tone") as string[]),
      avoid: toStringArray(formData.getAll("avoid") as string[]),
      cta: toString(formData.get("cta")) || "Sem CTA",
    };

    const parsed = briefingSchema.parse(payload);
    await upsertBriefingForUser(devUser.id, parsed);
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Não foi possível salvar o briefing" };
  }
}
