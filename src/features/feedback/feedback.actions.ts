"use server";

import { ZodError } from "zod";
import { requireUser } from "@/infra/auth/require-user";
import { feedbackInputSchema, LEARNING_THRESHOLD, type FeedbackInput } from "@/domain/feedback";
import { recordFeedback, countUnprocessedFeedback } from "./feedback.repository";
import { getPost } from "@/features/posts/posts.repository";

export type SubmitFeedbackResult =
  | { ok: true; shouldRelearn: boolean }
  | { ok: false; error: string };

export async function submitFeedbackAction(input: FeedbackInput): Promise<SubmitFeedbackResult> {
  const user = await requireUser();
  try {
    const parsed = feedbackInputSchema.parse(input);

    // Posse do post: feedback só pode apontar para post do próprio usuário.
    const post = await getPost(user.id, parsed.postId);
    if (!post) {
      return { ok: false, error: "Post não encontrado." };
    }

    await recordFeedback(user.id, parsed);
    const pending = await countUnprocessedFeedback(user.id);
    return { ok: true, shouldRelearn: pending >= LEARNING_THRESHOLD };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    console.error("[submitFeedbackAction] erro ao salvar feedback:", error);
    return { ok: false, error: "Não foi possível salvar o feedback." };
  }
}
