import { z } from "zod";

export const usageKindSchema = z.enum([
  "generate",
  "regenerate",
  "onboarding",
  "relearn",
]);

export type UsageKind = z.infer<typeof usageKindSchema>;
