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
  "no mundo de hoje",
  "é essencial",
  "dicas importantes",
];

const safeLine = (label: string, value?: string) =>
  value ? `${label}: ${value}` : "";

const formatLinks = (profile: ProfileRecord) => {
  const items = [
    profile.website ? `Site: ${profile.website}` : "",
    profile.linkedin ? `LinkedIn: ${profile.linkedin}` : "",
    profile.github ? `GitHub: ${profile.github}` : "",
  ].filter(Boolean);

  return items.length ? items.join(" | ") : "";
};

const summarizeProfile = (profile?: ProfileRecord | null) => {
  if (!profile) {
    return "Sem perfil salvo. Não invente informações sobre o autor.";
  }

  const links = formatLinks(profile);
  const lines = [
    safeLine("Nome", profile.displayName),
    safeLine("Headline", profile.headline),
    safeLine("Bio", profile.bio),
    safeLine("Cargo/identidade", profile.role),
    safeLine("Links", links),
    safeLine("Notas de estilo", profile.writingStyleNotes),
    safeLine("Restrições", profile.bannedClaims),
  ].filter(Boolean);

  return lines.length
    ? lines.join("\n")
    : "Sem perfil salvo. Não invente informações sobre o autor.";
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
  platformContext,
  briefing,
  theme,
  format,
  directives,
  labels,
  template,
  focusLabel,
  styleLabel,
}: {
  profile?: ProfileRecord | null;
  platform: Platform;
  platformContext?: string;
  briefing: BriefingInput;
  theme: string;
  format: GeneratePostFormat;
  directives: WritingDirectives;
  labels?: string[];
  template?: string;
  focusLabel?: string;
  styleLabel?: string;
}): string {
  const platformGuide = PLATFORM_GUIDE[platform];
  const platformLabel = platformContext ?? platform;
  const directiveBlock = buildDirectiveBlock(directives, platform);
  const resolvedLabels = labels ?? EXPECTED_VARIANT_LABELS;
  const resolvedTemplate = template ?? VARIANT_TEMPLATE;
  const variantCount = resolvedLabels.length;
  const variantLabel = variantCount === 1 ? "variação" : "variações";
  const styleLine = styleLabel ? `Estilo solicitado: ${styleLabel}` : "";

  return [
    "[ROLE]",
    "Você é um redator especialista em criar posts longos, coesos e específicos para redes sociais.",
    "",
    "[OUTPUT CONTRACT]",
    "Responda APENAS com JSON válido e estrito. NÃO inclua texto fora do JSON.",
    `Você deve retornar ${variantCount} ${variantLabel} em um único JSON. Não use markdown.`,
    "NÃO use markdown.",
    "Não use o campo content. Use sempre content_lines.",
    "NÃO coloque quebras de linha dentro de strings.",
    "content_lines deve ser um array JSON com strings separadas por vírgula.",
    "Cada item do array deve estar entre aspas e separado por vírgula.",
    "Exemplo correto (minificado): {\"variants\":[{\"label\":\"Direto\",\"content_lines\":[\"Linha 1\",\"Linha 2\",\"Linha 3\"]}]}",
    "Use exatamente o template e a ordem das labels fixas.",
    "Use content_lines como array de strings. Cada linha deve ser uma string simples, sem \\n dentro.",
    resolvedTemplate,
    "",
    "[AUTHOR_PROFILE]",
    summarizeProfile(profile),
    "",
    "[2 PLATAFORMA]",
    `Plataforma: ${platformLabel}`,
    `Target length: ${platformGuide.targetLength}`,
    `Style guide: ${platformGuide.styleGuide}`,
    `CTA guide: ${platformGuide.ctaGuide}`,
    `Formatting: ${platformGuide.formatting}`,
    "",
    "[3 TEMA]",
    `Tema base: ${theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[format]}`,
    styleLine,
    `Resumo do briefing: ${summarizeBriefing(briefing)}`,
    "",
    "[4 DIRETRIZES]",
    directiveBlock || "Sem diretrizes adicionais além do briefing.",
    "",
    "[QUALITY RULES]",
    "O tema é soberano; mantenha foco total nele.",
    "Sem texto genérico. Cada variação deve mudar o ângulo, mas manter o mesmo contexto.",
    "Exija começo/meio/fim. Parágrafos devem se conectar.",
    "Evite respostas curtas ou truncadas.",
    "Escreva entre 900 e 1100 caracteres.",
    "Inclua 1 exemplo concreto e 1 insight aplicável por variação.",
    "Não invente dados, números, cases, clientes ou resultados.",
    `Não use clichês ou frases vazias como: ${clichesToAvoid.join(", ")}.`,
    "LinkedIn: 10-18 linhas, hook forte nas 2 primeiras linhas, corpo com 2-4 parágrafos curtos, CTA final.",
    "Instagram: 8-14 linhas, frases diretas, ritmo rápido, CTA para comentar/salvar.",
    "CTA obrigatório em todas as variações.",
    "",
    `Labels exigidos: ${resolvedLabels.join(", ")}. Mantenha essa ordem.`,
    focusLabel ? `Gere somente a variação com label "${focusLabel}".` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
