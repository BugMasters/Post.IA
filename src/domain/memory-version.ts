import { z } from "zod";

export const memorySourceSchema = z.enum(["manual", "relearn", "onboarding"]);
export type MemorySource = z.infer<typeof memorySourceSchema>;
