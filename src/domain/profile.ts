import { z } from "zod";

export const audienceLevelOptions = ["Iniciante", "Intermediário", "Avançado"] as const;
export const languageStyleOptions = ["Formal", "Casual", "Didático", "Provocativo"] as const;

export const profileSchema = z.object({
  userId: z.string().min(1),
  roleTitle: z.string().optional(),
  whatIDo: z.string().optional(),
  howIWork: z.string().optional(),
  niche: z.string().optional(),
  audience: z.string().optional(),
  audienceLevel: z.enum(audienceLevelOptions).optional(),
  languageStyle: z.enum(languageStyleOptions).optional(),
  goals: z.string().optional(),
  constraints: z.string().optional(),
});

export type ProfileInput = z.input<typeof profileSchema>;
export type ProfileRecord = z.output<typeof profileSchema>;
