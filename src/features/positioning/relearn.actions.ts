"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/infra/auth/require-user";
import { getLlmProvider } from "@/infra/llm";
import { getPositioningProfile, updatePositioningMemory } from "./positioning.repository";
import { recordMemoryVersion } from "./memory-version.repository";
import { buildRelearnPrompt } from "./relearn.prompts";
import {
  listUnprocessedFeedback,
  markFeedbackProcessed,
} from "@/features/feedback/feedback.repository";

export type RelearnResult =
  | { ok: true; updated: boolean }
  | { ok: false; error: string };

export async function relearnPositioningAction(): Promise<RelearnResult> {
  try {
    const user = await requireUser();
    const [profile, feedbacks] = await Promise.all([
      getPositioningProfile(user.id),
      listUnprocessedFeedback(user.id),
    ]);

    if (!profile || feedbacks.length === 0) {
      return { ok: true, updated: false };
    }

    const provider = getLlmProvider();
    const newMemory = (
      await provider.generateText(buildRelearnPrompt(profile.positioningMemory, feedbacks), {
        maxTokens: 700,
        timeoutMs: 60000,
      })
    ).trim();

    if (newMemory.length > 0) {
      await updatePositioningMemory(user.id, newMemory);
      try {
        await recordMemoryVersion(user.id, newMemory, "relearn");
      } catch (versionError) {
        console.error("[relearnPositioningAction] falha ao versionar memória:", versionError);
      }
      await markFeedbackProcessed(feedbacks.map((f) => f.id));
      revalidatePath("/posicionamento");
      return { ok: true, updated: true };
    }
    return { ok: true, updated: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao reaprender.";
    return { ok: false, error: message };
  }
}
