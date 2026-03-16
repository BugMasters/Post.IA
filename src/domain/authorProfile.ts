import { z } from "zod";

export const audienceLevelOptions = ["Leigo", "Intermediário", "Técnico"] as const;

const requiredTextField = (fieldLabel: string) =>
  z.string().trim().min(1, `${fieldLabel} é obrigatório.`);

const optionalTextField = z.string().trim().max(500).default("");

export const authorProfileSchema = z.object({
  role: requiredTextField("Cargo/atuação"),
  niche: requiredTextField("Nicho"),
  audience: requiredTextField("Público"),
  audienceLevel: z.enum(audienceLevelOptions),
  writingStyle: optionalTextField,
  tonePreference: optionalTextField,
  ctaPreference: optionalTextField,
});

export type AuthorProfileValues = z.input<typeof authorProfileSchema>;
export type AuthorProfileInput = z.output<typeof authorProfileSchema>;

export const emptyAuthorProfileValues: AuthorProfileValues = {
  role: "",
  niche: "",
  audience: "",
  audienceLevel: "Intermediário",
  writingStyle: "",
  tonePreference: "",
  ctaPreference: "",
};
