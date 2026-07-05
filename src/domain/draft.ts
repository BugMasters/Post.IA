import { z } from "zod";

export const draftInputSchema = z.object({
  postId: z.string().min(1).optional(),
  label: z.string().min(1, "Informe um rótulo.").max(80, "O rótulo deve ter no máximo 80 caracteres."),
  content: z
    .string()
    .min(1, "O rascunho não pode ficar vazio.")
    .max(5000, "O rascunho deve ter no máximo 5000 caracteres."),
  theme: z.string().max(200, "O tema deve ter no máximo 200 caracteres.").optional(),
  platform: z.string().max(40, "A plataforma deve ter no máximo 40 caracteres.").optional(),
});
export type DraftInput = z.infer<typeof draftInputSchema>;
