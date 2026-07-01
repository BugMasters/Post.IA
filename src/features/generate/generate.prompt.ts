import type { PositioningProfile } from "@/generated/prisma";
import type { PositiveExample } from "@/features/feedback/feedback.repository";
import {
  getPostCharacterRange,
  type Platform,
  type PostLength,
  type PostObjective,
  type ToneOption,
  type AngleOption,
} from "@/domain/generate";
import type { GeneratePostFormat } from "./generate.actions";

export const EXPECTED_VARIANT_LABELS = [
  "Direto",
  "Storytelling",
  "Engraçado",
  "Autoridade",
  "Técnico",
  "Empático",
] as const;

export const FORMAT_DESCRIPTIONS: Record<GeneratePostFormat, string> = {
  TEXT: "texto enxuto pronto para publicação em feed ou thread",
  PHOTO_TEXT: "legenda que acompanha imagem marcante com contexto claro",
  PHOTO: "foco na imagem, frase curta e impacto visual",
};

const AUDIENCE_LEVEL_GUIDANCE: Record<string, string> = {
  Leigo:
    "use analogias do cotidiano, explique ideias simples e evite termos técnicos demais",
  Intermediário:
    "combine contexto estratégico com termos reconhecíveis para quem já vive as dores do profissional",
  Técnico:
    "apresente termos precisos, referências práticas e passos objetivos sem perder a clareza",
};

export const BASE_AVOIDANCES = [
  "Jargão",
  "Textão",
  "Polêmica",
  "Coach vibes",
  "CTA agressivo",
];

const PLATFORM_BLOCKS: Record<Platform, string[]> = {
  LINKEDIN: [
    "Escreva com repertório profissional, clareza estratégica e credibilidade.",
    "Use quebras de linha para facilitar a leitura em feed sem soar prolixo.",
    "Quando fizer sentido, use bullets objetivos e uma conclusão prática.",
  ],
  INSTAGRAM: [
    "Escreva com ritmo visual, frases curtas e leitura escaneável.",
    "Priorize quebras de linha, cadência emocional e proximidade humana.",
    "O texto deve funcionar como legenda nativa de Instagram, sem parecer um post de LinkedIn reciclado.",
  ],
};

const OBJECTIVE_BLOCKS: Record<PostObjective, string[]> = {
  ENSINAR: [
    "Otimize para clareza, utilidade prática e aprendizado rápido.",
    "Explique o raciocínio com exemplos, passos ou mini-frameworks concretos.",
  ],
  ENGAJAR: [
    "Otimize para identificação, curiosidade e vontade de responder.",
    "Crie abertura para comentário, reflexão ou conversa sem cair em clickbait.",
  ],
  VENDER: [
    "Otimize para desejo, percepção de valor e próximo passo natural.",
    "Mostre transformação e fit da oferta sem tom agressivo ou promoção dura.",
  ],
  AUTORIDADE: [
    "Otimize para credibilidade, tese forte e confiança no repertório do autor.",
    "Use critério, experiência e visão própria para demonstrar domínio do assunto.",
  ],
};

const LENGTH_BLOCKS: Record<Platform, Record<PostLength, string[]>> = {
  LINKEDIN: {
    CURTO: [
      "Faixa obrigatória: 500-800 caracteres.",
      "Estrutura recomendada: gancho forte + insight central + CTA final.",
    ],
    MEDIO: [
      "Faixa obrigatória: 900-1400 caracteres.",
      "Estrutura recomendada: gancho + contexto + 2-4 blocos de desenvolvimento + CTA final.",
    ],
    LONGO: [
      "Faixa obrigatória: 1500-2500 caracteres.",
      "Estrutura obrigatória: gancho + contexto + 3-6 bullets + conclusão + CTA final.",
    ],
  },
  INSTAGRAM: {
    CURTO: [
      "Faixa obrigatória: 300-600 caracteres.",
      "Estrutura recomendada: gancho curto + desenvolvimento enxuto + CTA emocional ou pergunta final.",
    ],
    MEDIO: [
      "Faixa obrigatória: 700-1100 caracteres.",
      "Estrutura recomendada: gancho + blocos curtos com quebras + fechamento com pergunta ou CTA emocional.",
    ],
    LONGO: [
      "Faixa obrigatória: 1200-1800 caracteres.",
      "Estrutura obrigatória: frases curtas, muitas quebras de linha e CTA emocional ou pergunta final.",
    ],
  },
};

export const buildPlatformBlock = (platform: Platform) =>
  ["[PLATFORM]", ...PLATFORM_BLOCKS[platform], "[/PLATFORM]"].join("\n");

export const buildObjectiveBlock = (objective: PostObjective) =>
  ["[OBJECTIVE]", ...OBJECTIVE_BLOCKS[objective], "[/OBJECTIVE]"].join("\n");

export const buildLengthBlock = (platform: Platform, length: PostLength) =>
  ["[LENGTH]", ...LENGTH_BLOCKS[platform][length], "[/LENGTH]"].join("\n");

export function buildPositioningBlock(
  profile: Pick<PositioningProfile, "positioningMemory">
) {
  const memory = profile.positioningMemory?.trim();
  return [
    "[POSICIONAMENTO]",
    memory && memory.length > 0 ? memory : "não informado",
    "[/POSICIONAMENTO]",
  ].join("\n");
}

const safeField = (value: string | undefined | null, fallback: string) =>
  value?.trim() || fallback;

export const FEW_SHOT_CHAR_CAP = 500;

export function buildFewShotBlock(examples: PositiveExample[]) {
  if (examples.length === 0) return "";
  const lines = examples.map((ex, index) => {
    const text = ex.content.length > FEW_SHOT_CHAR_CAP
      ? `${ex.content.slice(0, FEW_SHOT_CHAR_CAP)}…`
      : ex.content;
    return `Exemplo ${index + 1} (${ex.label}):\n${text}`;
  });
  return [
    "[EXEMPLOS_NA_VOZ_DO_USUARIO]",
    "Use o estilo e a voz destes textos que o usuário aprovou ou editou. Não copie o conteúdo, apenas a voz.",
    ...lines,
    "[/EXEMPLOS_NA_VOZ_DO_USUARIO]",
  ].join("\n");
}

const TONE_GUIDANCE: Record<Exclude<ToneOption, "AUTOMATICO">, string> = {
  DIDATICO: "Tom didático: explique com clareza, exemplos e ritmo de quem ensina.",
  PROVOCADOR: "Tom provocador: tese forte, contraponto e leve tensão, sem ofender.",
  STORYTELLING: "Tom de storytelling: comece por uma cena concreta e conduza por narrativa.",
  DIRETO: "Tom direto: vá ao ponto, frases curtas, zero rodeio.",
};

const ANGLE_GUIDANCE: Record<Exclude<AngleOption, "AUTOMATICO">, string> = {
  CONTRARIAN: "Ângulo contrarian: parta de uma visão contra o senso comum e sustente com argumento.",
  CASO_REAL: "Ângulo de caso real: ancore em uma situação concreta e prática.",
  PASSO_A_PASSO: "Ângulo passo a passo: estruture como sequência clara de passos acionáveis.",
};

export function buildToneAngleBlock(tone: ToneOption, angle: AngleOption) {
  const lines: string[] = [];
  if (tone !== "AUTOMATICO") lines.push(TONE_GUIDANCE[tone]);
  if (angle !== "AUTOMATICO") lines.push(ANGLE_GUIDANCE[angle]);
  if (lines.length === 0) return "";
  return ["[TOM_E_ANGULO]", ...lines, "[/TOM_E_ANGULO]"].join("\n");
}

export type GeneratePromptInput = {
  theme: string;
  format: GeneratePostFormat;
  platform: Platform;
  objective: PostObjective;
  length: PostLength;
  tone: ToneOption;
  angle: AngleOption;
};

export function buildVariantRegenerationPrompt({
  input,
  profile,
  cta,
  label,
  currentContent,
}: {
  input: {
    theme: string;
    format: GeneratePostFormat;
    platform: Platform;
    objective: PostObjective;
    length: PostLength;
  };
  profile: Pick<PositioningProfile, "positioningMemory">;
  cta: string;
  label: string;
  currentContent: string;
}) {
  const characterRange = getPostCharacterRange(input.platform, input.length);
  return [
    "Você vai gerar uma NOVA VERSÃO de uma única variação, mantendo o label e o ângulo central, mas com texto novo e diferente do atual.",
    `Tema base: ${input.theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[input.format]}`,
    buildPositioningBlock(profile),
    buildPlatformBlock(input.platform),
    buildObjectiveBlock(input.objective),
    buildLengthBlock(input.platform, input.length),
    `Label da variação: ${label}`,
    `Faixa obrigatória: ${characterRange.min}-${characterRange.max} caracteres.`,
    `CTA final obrigatório: ${cta}.`,
    "Mantenha o texto em português, pronto para publicação e fiel ao posicionamento.",
    "Retorne APENAS o texto final da variação, sem JSON, sem comentários e sem título extra.",
    "[VARIACAO_ATUAL]",
    currentContent,
    "[/VARIACAO_ATUAL]",
  ].join("\n");
}

export const buildPrompt = (
  input: GeneratePromptInput,
  profile: Pick<PositioningProfile, "positioningMemory" | "ctaPreference">,
  examples: PositiveExample[] = []
) => {
  const cta = safeField(profile.ctaPreference, "CTA respeitosa");
  const characterRange = getPostCharacterRange(input.platform, input.length);

  const avoidSummary = BASE_AVOIDANCES.join(", ");
  const fewShotBlock = buildFewShotBlock(examples);

  return [
    "Você é um redator experiente focado em redes sociais B2B/B2C.",
    "Use apenas os dados abaixo como contexto e não repita os nomes dos campos do posicionamento nos textos finais.",
    `Tema base: ${input.theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[input.format]}`,
    buildPositioningBlock(profile),
    fewShotBlock,
    buildPlatformBlock(input.platform),
    buildObjectiveBlock(input.objective),
    buildToneAngleBlock(input.tone, input.angle),
    buildLengthBlock(input.platform, input.length),
    `Evite: ${avoidSummary}.`,
    `Labels exigidos: ${EXPECTED_VARIANT_LABELS.join(", ")}. Mantenha essa ordem.`,
    'Retorne APENAS JSON válido com estrutura { "variants": [ { "label": "...", "content": "..." }, ... ] }.',
    `Cada post deve ser em português, pronto para publicação, e ficar preferencialmente entre ${characterRange.min} e ${characterRange.max} caracteres.`,
    "Respeite as regras de plataforma, objetivo e tamanho descritas nos blocos acima.",
    `A última linha deve repetir exatamente o CTA sugerido: ${cta}.`,
    'Não invente dados, não use clichês como "transforme sua vida" ou "ninguém te conta", nem jargões, textão, coach vibes, polêmica ou CTA agressivo.',
    "O conteúdo deve evitar mencionar diretamente os campos do posicionamento e não pode trazer claims não fornecidas.",
    "O gancho, a estrutura e o CTA não podem usar clichês ou figuras de autoridade exageradas.",
  ]
    .filter(Boolean)
    .join("\n");
};
