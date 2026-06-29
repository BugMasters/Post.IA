import { z } from "zod";

export const feedbackSignalSchema = z.enum([
  "liked",
  "disliked",
  "edited",
  "more_like_this",
]);
export type FeedbackSignal = z.infer<typeof feedbackSignalSchema>;

export const feedbackInputSchema = z.object({
  postId: z.string().min(1),
  variantLabel: z.string().min(1),
  signal: feedbackSignalSchema,
  editedContent: z.string().optional(),
  note: z.string().max(280).optional(),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export const LEARNING_THRESHOLD = 3;
