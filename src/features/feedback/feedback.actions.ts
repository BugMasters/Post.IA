"use server";

import { ZodError } from "zod";
import { requireUser } from "@/infra/auth/require-user";
import { feedbackInputSchema, LEARNING_THRESHOLD, type FeedbackInput } from "@/domain/feedback";
import { recordFeedback, countUnprocessedFeedback } from "./feedback.repository";

export type SubmitFeedbackResult =
  | { ok: true; shouldRelearn: boolean }
  | { ok: false; error: string };

export async function submitFeedbackAction(input: FeedbackInput): Promise<SubmitFeedbackResult> {
  try {
    const parsed = feedbackInputSchema.parse(input);
    const user = await requireUser();
    await recordFeedback(user.id, parsed);
    const pending = await countUnprocessedFeedback(user.id);
    return { ok: true, shouldRelearn: pending >= LEARNING_THRESHOLD };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    const message = error instanceof Error ? error.message : "Erro ao salvar feedback.";
    return { ok: false, error: message };
  }
}
