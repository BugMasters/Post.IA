import { z } from "zod";

const optionalText = z.string().trim().optional();

export const profileSchema = z.object({
  userId: z.string().min(1),
  displayName: optionalText,
  headline: optionalText,
  bio: optionalText,
  role: optionalText,
  website: optionalText,
  linkedin: optionalText,
  github: optionalText,
  writingStyleNotes: optionalText,
  bannedClaims: optionalText,
});

export const profileFormSchema = z.object({
  displayName: optionalText,
  headline: optionalText,
  bio: optionalText,
  role: optionalText,
  website: optionalText,
  linkedin: optionalText,
  github: optionalText,
  writingStyleNotes: optionalText,
  bannedClaims: optionalText,
});

export type ProfileInput = z.input<typeof profileSchema>;
export type ProfileRecord = z.output<typeof profileSchema>;
export type ProfileFormValues = z.input<typeof profileFormSchema>;
