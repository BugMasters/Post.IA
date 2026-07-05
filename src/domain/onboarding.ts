import { z } from "zod";

export const MAX_ONBOARDING_TURNS = 6;

export const chatMessageSchema = z.object({
  role: z.enum(["assistant", "user"]),
  content: z.string().min(1),
});
export const chatMessagesSchema = z.array(chatMessageSchema);
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const ONBOARDING_MESSAGE_MAX = 2000;

// Mensagem digitada pelo usuário no chat de onboarding. Vazia é permitida
// (dispara a primeira pergunta); o teto evita payloads gigantes no banco/LLM.
export const onboardingMessageSchema = z
  .string()
  .trim()
  .max(
    ONBOARDING_MESSAGE_MAX,
    `A mensagem pode ter no máximo ${ONBOARDING_MESSAGE_MAX} caracteres.`
  );

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

export const POSITIONING_SHORT_FIELD_MAX = 500;
export const POSITIONING_MEMORY_MAX = 5000;

export const positioningPatchSchema = z
  .object({
    niche: z.string().max(POSITIONING_SHORT_FIELD_MAX),
    audience: z.string().max(POSITIONING_SHORT_FIELD_MAX),
    offer: z.string().max(POSITIONING_SHORT_FIELD_MAX),
    differentiation: z.string().max(POSITIONING_SHORT_FIELD_MAX),
    tonePreference: z.string().max(POSITIONING_SHORT_FIELD_MAX),
    ctaPreference: z.string().max(POSITIONING_SHORT_FIELD_MAX),
    positioningMemory: z
      .string()
      .min(1, "A memória não pode ficar vazia.")
      .max(POSITIONING_MEMORY_MAX, "A memória ficou longa demais."),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });
export type PositioningPatch = z.infer<typeof positioningPatchSchema>;
