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

const draftAnglesByLabel: Record<string, string> = {
  Direto: "tese objetiva + 3 passos práticos de execução",
  Storytelling: "micro-história com virada e aprendizado aplicado",
  Engraçado: "situação cotidiana + ironia leve + insight útil",
  Autoridade: "framework proprietário + princípio + alerta profissional",
  Técnico: "processo técnico em 3 camadas + termos claros",
  Empático: "dor do público + validação + caminho realista",
};

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

const buildTemplateForLabels = (labels: readonly string[]) => {
  const items = labels
    .map((label) => `{"label":"${label}","content_lines":["..."]}`)
    .join(",\n    ");
  return `{\n  "variants": [\n    ${items}\n  ]\n}`;
};

const buildAngleBlock = (labels: readonly string[]) =>
  labels
    .map((label) => {
      const angle = draftAnglesByLabel[label] ?? "ângulo único e específico";
      return `${label}: ${angle}`;
    })
    .join("\n");

export function buildDraftPrompt({
  profile,
  platform,
  platformContext,
  briefing,
  theme,
  format,
  directives,
  labels,
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
  styleLabel?: string;
}): string {
  const platformGuide = PLATFORM_GUIDE[platform];
  const platformLabel = platformContext ?? platform;
  const directiveBlock = buildDirectiveBlock(directives, platform);
  const resolvedLabels = labels ?? EXPECTED_VARIANT_LABELS;
  const template = buildTemplateForLabels(resolvedLabels);
  const styleLine = styleLabel ? `Estilo solicitado: ${styleLabel}` : "";

  return [
    "[ROLE]",
    "Você é um redator especialista em criar drafts rápidos, específicos e altamente diferenciados.",
    "",
    "[OUTPUT CONTRACT]",
    "Responda APENAS com JSON válido e estrito dentro de <JSON>...</JSON>.",
    "NÃO inclua texto fora do JSON.",
    "NÃO use markdown.",
    "Não use o campo content. Use sempre content_lines.",
    "NÃO coloque quebras de linha dentro de strings.",
    "content_lines deve ser um array JSON com strings separadas por vírgula.",
    "Cada item do array deve estar entre aspas e separado por vírgula.",
    `Você deve retornar ${resolvedLabels.length} variações no mesmo JSON.`,
    "Exemplo correto (minificado): <JSON>{\"variants\":[{\"label\":\"Direto\",\"content_lines\":[\"Linha 1\",\"Linha 2\",\"Linha 3\"]}]}</JSON>",
    "Use exatamente o template e a ordem das labels fixas.",
    `<JSON>${template}</JSON>`,
    "",
    "[STRUCTURE RULES]",
    "Cada variação deve ter exatamente estas linhas, nesta ordem:",
    "1) Hook (1-2 linhas no máximo, mas aqui use apenas 1 linha).",
    "2) Bullet 1 (linha iniciando com '-' ou '•').",
    "3) Bullet 2 (linha iniciando com '-' ou '•').",
    "4) Bullet 3 (linha iniciando com '-' ou '•').",
    "5) Assinatura de estilo (linha curta que revela o estilo sem usar 'Tom:').",
    "6) CTA final obrigatório (última linha).",
    "Não use texto genérico. Cada label deve ter ângulo diferente.",
    "Não repetir o mesmo ângulo em labels diferentes.",
    "CTA final deve ser exatamente o CTA do briefing.",
    "",
    "[ANGULOS POR LABEL]",
    buildAngleBlock(resolvedLabels),
    "",
    "[AUTHOR_PROFILE]",
    summarizeProfile(profile),
    "",
    "[PLATAFORMA]",
    `Plataforma: ${platformLabel}`,
    `Target length: ${platformGuide.targetLength}`,
    `Style guide: ${platformGuide.styleGuide}`,
    `CTA guide: ${platformGuide.ctaGuide}`,
    `Formatting: ${platformGuide.formatting}`,
    "",
    "[TEMA]",
    `Tema base: ${theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[format]}`,
    styleLine,
    `Resumo do briefing: ${summarizeBriefing(briefing)}`,
    "",
    "[DIRETRIZES]",
    directiveBlock || "Sem diretrizes adicionais além do briefing.",
    "",
    "[QUALITY RULES]",
    "O tema é soberano; mantenha foco total nele.",
    "Evite clichês e frases vazias.",
    `Não use clichês como: ${clichesToAvoid.join(", ")}.`,
    "CTA obrigatório na última linha e deve seguir o briefing.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildExpandPrompt({
  profile,
  platform,
  platformContext,
  briefing,
  theme,
  format,
  directives,
  variant,
}: {
  profile?: ProfileRecord | null;
  platform: Platform;
  platformContext?: string;
  briefing: BriefingInput;
  theme: string;
  format: GeneratePostFormat;
  directives: WritingDirectives;
  variant: { label: string; content: string };
}): string {
  const platformGuide = PLATFORM_GUIDE[platform];
  const platformLabel = platformContext ?? platform;
  const directiveBlock = buildDirectiveBlock(directives, platform);
  const template = buildTemplateForLabels([variant.label]);
  const draftLines = variant.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

  return [
    "[ROLE]",
    "Você é um redator especialista em expandir drafts para posts completos, mantendo o ângulo original.",
    "",
    "[OUTPUT CONTRACT]",
    "Responda APENAS com JSON válido e estrito dentro de <JSON>...</JSON>.",
    "NÃO inclua texto fora do JSON.",
    "NÃO use markdown.",
    "Não use o campo content. Use sempre content_lines.",
    "NÃO coloque quebras de linha dentro de strings.",
    "content_lines deve ser um array JSON com strings separadas por vírgula.",
    "Cada item do array deve estar entre aspas e separado por vírgula.",
    "Template obrigatório:",
    `<JSON>${template}</JSON>`,
    "",
    "[INPUT DRAFT]",
    `Label: ${variant.label}`,
    "Draft original (não repetir frases literalmente):",
    draftLines,
    "",
    "[EXPAND RULES]",
    "Mantenha o ângulo e o estilo do draft.",
    "Não repita frases do draft literalmente. Reescreva e expanda com variação lexical.",
    "Adicione coesão e transições entre as partes.",
    "Inclua 1 exemplo concreto (ex.: 'na prática', 'por exemplo', números ou porcentagens).",
    "Inclua 1 passo acionável claro.",
    `CTA final deve ser exatamente: ${briefing.cta}`,
    "A última linha precisa ser o CTA.",
    "Mantenha a estrutura com hook + 3 bullets + assinatura + CTA, mas expanda com mais contexto.",
    "",
    "[PLATAFORMA]",
    `Plataforma: ${platformLabel}`,
    `Target length: ${platformGuide.targetLength}`,
    `Style guide: ${platformGuide.styleGuide}`,
    `CTA guide: ${platformGuide.ctaGuide}`,
    `Formatting: ${platformGuide.formatting}`,
    "",
    "[TEMA]",
    `Tema base: ${theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[format]}`,
    `Resumo do briefing: ${summarizeBriefing(briefing)}`,
    "",
    "[DIRETRIZES]",
    directiveBlock || "Sem diretrizes adicionais além do briefing.",
    "",
    "[QUALITY RULES]",
    "O tema é soberano; mantenha foco total nele.",
    `Não use clichês como: ${clichesToAvoid.join(", ")}.`,
    "LinkedIn: 10-18 linhas, hook forte nas 2 primeiras linhas, corpo com 2-4 parágrafos curtos, CTA final.",
    "Instagram: 8-14 linhas, frases diretas, ritmo rápido, CTA para comentar/salvar.",
  ]
    .filter(Boolean)
    .join("\n");
}

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
    "Responda APENAS com JSON válido e estrito dentro de <JSON>...</JSON>.",
    "NÃO inclua texto fora do JSON.",
    `Você deve retornar ${variantCount} ${variantLabel} em um único JSON. Não use markdown.`,
    "NÃO use markdown.",
    "Não use o campo content. Use sempre content_lines.",
    "NÃO coloque quebras de linha dentro de strings.",
    "content_lines deve ser um array JSON com strings separadas por vírgula.",
    "Cada item do array deve estar entre aspas e separado por vírgula.",
    "Exemplo correto (minificado): <JSON>{\"variants\":[{\"label\":\"Direto\",\"content_lines\":[\"Linha 1\",\"Linha 2\",\"Linha 3\"]}]}</JSON>",
    "Use exatamente o template e a ordem das labels fixas.",
    "Use content_lines como array de strings. Cada linha deve ser uma string simples, sem \\n dentro.",
    `<JSON>${resolvedTemplate}</JSON>`,
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

export function buildFixJsonPrompt(badOutput: string) {
  return `
Corrija a saída abaixo para um JSON válido e completo.

REGRAS:
- Responder APENAS com JSON válido dentro de <JSON>...</JSON>
- Não usar markdown.
- Não adicionar texto fora do JSON.
- Não alterar labels, não remover variantes.
- Garantir "variants" com 6 itens e "content_lines" array de strings.

Saída quebrada:
${badOutput}
`.trim();
}
