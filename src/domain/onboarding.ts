import { z } from "zod";

export const MAX_ONBOARDING_TURNS = 6;

export const chatMessageSchema = z.object({
  role: z.enum(["assistant", "user"]),
  content: z.string().min(1),
});
export const chatMessagesSchema = z.array(chatMessageSchema);
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const positioningSeedSchema = z.object({
  niche: z.string().default(""),
  audience: z.string().default(""),
  offer: z.string().default(""),
  differentiation: z.string().default(""),
  tonePreference: z.string().default(""),
  ctaPreference: z.string().default(""),
  positioningMemory: z.string().min(1),
});
export type PositioningSeed = z.infer<typeof positioningSeedSchema>;
