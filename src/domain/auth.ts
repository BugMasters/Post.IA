import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome."),
  email: z.string().email("Email inválido."),
  password: z.string().min(8, "Senha precisa de ao menos 8 caracteres."),
  inviteCode: z
    .string()
    .trim()
    .min(1, "Informe o código de convite.")
    .max(64, "Código de convite muito longo."),
});

export const loginSchema = z.object({
  email: z.string().email("Email inválido."),
  password: z.string().min(8, "Senha precisa de ao menos 8 caracteres."),
});

export type SignupValues = z.infer<typeof signupSchema>;
export type LoginValues = z.infer<typeof loginSchema>;
