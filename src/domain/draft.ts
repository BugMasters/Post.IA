import { z } from "zod";

export const draftInputSchema = z.object({
  postId: z.string().min(1).optional(),
  label: z.string().min(1, "Informe um rótulo.").max(80),
  content: z.string().min(1, "O rascunho não pode ficar vazio."),
  theme: z.string().max(200).optional(),
  platform: z.string().max(40).optional(),
});
export type DraftInput = z.infer<typeof draftInputSchema>;
