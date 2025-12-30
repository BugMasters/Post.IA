import { z } from "zod";

export const goalOptions = [
  "Aumentar autoridade",
  "Gerar leads",
  "Lançar novo produto",
  "Nutrir audiência existente",
  "Educar sobre um tema",
] as const;

export const audienceOptions = [
  "Empreendedores iniciantes",
  "Profissionais técnicos",
  "PMEs prontas para escalar",
  "Times de marketing",
  "Mentores e consultores",
] as const;

export const audienceLevelOptions = ["Leigo", "Intermediário", "Técnico"] as const;

export const toneOptions = ["Inspirador", "Direto", "Leve", "Autoritário", "Empático"] as const;

export const avoidOptions = [
  "Jargão",
  "Textão",
  "Polêmica",
  "CTA agressivo",
  "Coach vibes",
] as const;

export const ctaOptions = ["Comentar", "Direct", "Salvar/Compartilhar", "Link", "Sem CTA"] as const;

export type BriefingGoal = (typeof goalOptions)[number];
export type BriefingAudience = (typeof audienceOptions)[number];
export type BriefingAudienceLevel = (typeof audienceLevelOptions)[number];

const toneSchema = z.array(z.string()).max(2);
const avoidSchema = z.array(z.string());

export const briefingSchema = z.object({
  goal: z.string().min(1),
  audience: z.string().min(1),
  audienceLevel: z.string().min(1),
  offer: z.string().min(3),
  differentiation: z.string().min(3),
  tone: toneSchema.default([]),
  avoid: avoidSchema.default([]),
  cta: z.string(),
});

export type BriefingFormValues = z.input<typeof briefingSchema>;
export type BriefingInput = z.output<typeof briefingSchema>;
