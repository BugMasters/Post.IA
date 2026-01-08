export type Platform = "LINKEDIN" | "INSTAGRAM";

export type PlatformGuide = {
  targetLength: "LONG" | "MEDIUM";
  styleGuide: string;
  ctaGuide: string;
  formatting: string;
  charRange: { min: number; max: number };
};

export const PLATFORM_GUIDE: Record<Platform, PlatformGuide> = {
  LINKEDIN: {
    targetLength: "LONG",
    styleGuide:
      "Tom profissional, claro e aprofundado. Desenvolvimento com começo/meio/fim, mantendo coerência entre parágrafos.",
    ctaGuide: "CTA profissional e respeitosa, alinhada ao contexto do autor.",
    formatting:
      "3-6 parágrafos curtos. Sem emojis em excesso. Pode usar 1 lista curta apenas se ajudar a clareza.",
    charRange: { min: 900, max: 1800 },
  },
  INSTAGRAM: {
    targetLength: "MEDIUM",
    styleGuide:
      "Tom direto, humano e específico. Ritmo mais ágil, mas ainda com começo/meio/fim.",
    ctaGuide: "CTA de engajamento (comentário, salvar, compartilhar), sem agressividade.",
    formatting:
      "2-5 parágrafos. Emojis leves (máx. 3) se fizerem sentido. Evitar blocos longos.",
    charRange: { min: 500, max: 1200 },
  },
};

export const isPlatform = (value: string | undefined | null): value is Platform =>
  value === "LINKEDIN" || value === "INSTAGRAM";
