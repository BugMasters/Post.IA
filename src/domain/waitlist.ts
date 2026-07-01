import { z } from "zod";
export const waitlistSchema = z.object({ email: z.string().email("Email inválido.") });
export type WaitlistValues = z.infer<typeof waitlistSchema>;
