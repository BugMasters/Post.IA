import type { BriefingInput } from "@/domain/briefing";
import type { ProfileRecord } from "@/domain/profile";
import { PLATFORM_GUIDE, type Platform } from "@/domain/platform";
import { EXPECTED_VARIANT_LABELS, FORMAT_DESCRIPTIONS, VARIANT_TEMPLATE } from "./constants";
import type { GeneratePostFormat } from "./types";

type WritingDirectives = {
  tone?: string;
  structure?: string;
  size?: string;
  cta?: string;
};

const audienceLevelGuidance: Record<string, string> = {
  Leigo: "use analogias do cotidiano e explique termos simples",
  Intermediário: "combine contexto estratégico com termos reconhecíveis",
  Técnico: "use termos precisos e passos objetivos sem perder a clareza",
};

const clichesToAvoid = [
  "transforme sua vida",
  "ninguém te conta",
  "no mercado acelerado",
  "sucesso garantido",
  "em tempo recorde",
];

const safeLine = (label: string, value?: string) =>
  value ? `${label}: ${value}` : "";

const summarizeProfile = (profile?: ProfileRecord | null) => {
  if (!profile) {
    return "Sem memória salva. Use apenas o briefing e o tema.";
  }

  const lines = [
    safeLine("Cargo/identidade", profile.roleTitle),
    safeLine("O que faz", profile.whatIDo),
    safeLine("Como trabalha", profile.howIWork),
    safeLine("Nicho", profile.niche),
    safeLine("Audiência", profile.audience),
    safeLine("Nível da audiência", profile.audienceLevel),
    safeLine("Estilo de linguagem", profile.languageStyle),
    safeLine("Objetivos", profile.goals),
    safeLine("Restrições", profile.constraints),
  ].filter(Boolean);

  return lines.length ? lines.join("\n") : "Sem memória salva. Use apenas o briefing e o tema.";
};

const summarizeBriefing = (briefing: BriefingInput) => {
  const tone = briefing.tone?.length ? briefing.tone.join(", ") : "neutro";
  const avoid = briefing.avoid?.length ? briefing.avoid.join(", ") : "nenhum";

  const guidance =
    audienceLevelGuidance[briefing.audienceLevel] ??
    "Equilibre clareza e autoridade conforme o contexto.";

  return [
    `Objetivo: ${briefing.goal}`,
    `Oferta: ${briefing.offer}`,
    `Diferencial: ${briefing.differentiation}`,
    `Público: ${briefing.audience} (${briefing.audienceLevel})`,
    `Tom preferido: ${tone}`,
    `Evitar: ${avoid}`,
    `Guia de nível: ${guidance}`,
    `CTA sugerido: ${briefing.cta}`,
  ].join(" | ");
};

const buildDirectiveBlock = (directives: WritingDirectives, platform: Platform) => {
  const platformGuide = PLATFORM_GUIDE[platform];
  const size =
    directives.size ??
    `${platformGuide.charRange.min}-${platformGuide.charRange.max} caracteres`;

  return [
    safeLine("Tom", directives.tone),
    safeLine("Estrutura", directives.structure),
    safeLine("Tamanho", size),
    safeLine("CTA sugerido", directives.cta),
  ]
    .filter(Boolean)
    .join("\n");
};

export function buildGeneratePrompt({
  profile,
  platform,
  briefing,
  theme,
  format,
  directives,
}: {
  profile?: ProfileRecord | null;
  platform: Platform;
  briefing: BriefingInput;
  theme: string;
  format: GeneratePostFormat;
  directives: WritingDirectives;
}): string {
  const platformGuide = PLATFORM_GUIDE[platform];
  const directiveBlock = buildDirectiveBlock(directives, platform);

  return [
    "[ROLE]",
    "Você é um redator especialista em criar posts longos, coesos e específicos para redes sociais.",
    "",
    "[OUTPUT CONTRACT]",
    "Retorne APENAS JSON válido e estrito.",
    "Use exatamente o template e a ordem das labels.",
    VARIANT_TEMPLATE,
    "",
    "[1 USER MEMORY]",
    summarizeProfile(profile),
    "",
    "[2 PLATFORM]",
    `Plataforma: ${platform}`,
    `Target length: ${platformGuide.targetLength}`,
    `Style guide: ${platformGuide.styleGuide}`,
    `CTA guide: ${platformGuide.ctaGuide}`,
    `Formatting: ${platformGuide.formatting}`,
    "",
    "[3 POST CONTEXT]",
    `Tema base: ${theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[format]}`,
    `Resumo do briefing: ${summarizeBriefing(briefing)}`,
    "",
    "[4 WRITING DIRECTIVES]",
    directiveBlock || "Sem diretrizes adicionais além do briefing.",
    "",
    "[QUALITY RULES]",
    "O tema é soberano; mantenha foco total nele.",
    "Sem texto genérico. Cada variação deve mudar o ângulo, mas manter o mesmo contexto.",
    "Exija começo/meio/fim. Parágrafos devem se conectar.",
    "Evite respostas curtas ou com apenas 5 linhas.",
    "Inclua 1 exemplo concreto e 1 insight aplicável por variação.",
    "Não invente dados, números, cases, clientes ou resultados.",
    `Não use clichês ou frases vazias como: ${clichesToAvoid.join(", ")}.`,
    "LinkedIn: 900-1800 caracteres, 3-6 parágrafos, CTA profissional.",
    "Instagram: 500-1200 caracteres, 2-5 parágrafos, emojis leves (máx. 3), CTA de engajamento.",
    "",
    `Labels exigidos: ${EXPECTED_VARIANT_LABELS.join(", ")}. Mantenha essa ordem.`,
  ]
    .filter(Boolean)
    .join("\n");
}
