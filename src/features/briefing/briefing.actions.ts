'use server';
import { revalidatePath } from "next/cache";
import { BriefingFormValues, briefingSchema } from "@/domain/briefing";
import { ensureDevUser } from "@/infra/dev/devUser";
import { upsertBriefingForUser } from "./briefing.repository";

export type SaveBriefingResult =
  | { ok: true; redirectTo: "/dashboard" }
  | { ok: false; error: string };

export async function saveBriefingAction(
  values: BriefingFormValues
): Promise<SaveBriefingResult> {
  try {
    const input = briefingSchema.parse(values);
    const user = await ensureDevUser();

    await upsertBriefingForUser(user.id, input);
    revalidatePath("/briefing");
    revalidatePath("/dashboard");

    return { ok: true, redirectTo: "/dashboard" };
  } catch (e) {
    console.error("[saveBriefingAction] failed:", e);

    if (e && typeof e === "object" && "issues" in (e as any)) {
      const msg = (e as any).issues?.map((i: any) => i.message).join(", ");
      return { ok: false, error: msg || "Dados inválidos." };
    }

    const message =
      e instanceof Error ? e.message : "Erro desconhecido ao salvar.";
    return { ok: false, error: message };
  }
}
