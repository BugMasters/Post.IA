import { z } from "zod";

export const platformOptions = ["LINKEDIN", "INSTAGRAM"] as const;
export const postObjectiveOptions = [
  "ENSINAR",
  "ENGAJAR",
  "VENDER",
  "AUTORIDADE",
] as const;
export const postLengthOptions = ["CURTO", "MEDIO", "LONGO"] as const;

export const DEFAULT_PLATFORM = "LINKEDIN";
export const DEFAULT_POST_OBJECTIVE = "ENSINAR";
export const DEFAULT_POST_LENGTH = "MEDIO";

export const platformSchema = z.enum(platformOptions).default(DEFAULT_PLATFORM);
export const postObjectiveSchema = z
  .enum(postObjectiveOptions)
  .default(DEFAULT_POST_OBJECTIVE);
export const postLengthSchema = z.enum(postLengthOptions).default(DEFAULT_POST_LENGTH);

export type Platform = z.output<typeof platformSchema>;
export type PostObjective = z.output<typeof postObjectiveSchema>;
export type PostLength = z.output<typeof postLengthSchema>;

export type CharacterRange = {
  min: number;
  max: number;
};

export const platformLabels: Record<Platform, string> = {
  LINKEDIN: "LinkedIn",
  INSTAGRAM: "Instagram",
};

export const postObjectiveLabels: Record<PostObjective, string> = {
  ENSINAR: "Ensinar",
  ENGAJAR: "Engajar",
  VENDER: "Vender",
  AUTORIDADE: "Autoridade",
};

export const postLengthLabels: Record<PostLength, string> = {
  CURTO: "Curto",
  MEDIO: "Médio",
  LONGO: "Longo",
};

export const characterRangesByPlatform: Record<
  Platform,
  Record<PostLength, CharacterRange>
> = {
  LINKEDIN: {
    CURTO: { min: 500, max: 800 },
    MEDIO: { min: 900, max: 1400 },
    LONGO: { min: 1500, max: 2500 },
  },
  INSTAGRAM: {
    CURTO: { min: 300, max: 600 },
    MEDIO: { min: 700, max: 1100 },
    LONGO: { min: 1200, max: 1800 },
  },
};

export const getPostCharacterRange = (
  platform: Platform,
  length: PostLength
) => characterRangesByPlatform[platform][length];
