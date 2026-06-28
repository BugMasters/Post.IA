"use server";

import { z } from "zod";

import {
  DEFAULT_PLATFORM,
  DEFAULT_POST_LENGTH,
  DEFAULT_POST_OBJECTIVE,
  getPostCharacterRange,
  platformSchema,
  type CharacterRange,
  type Platform,
  postLengthSchema,
  type PostLength,
  postObjectiveSchema,
  type PostObjective,
} from "@/domain/generate";
import { getLatestBriefingForUser } from "@/features/briefing/briefing.repository";
import { getAuthorProfileForUser } from "@/features/profile/profile.actions";
import { ensureDevUser } from "@/infra/dev/devUser";
import { getLlmProvider } from "@/infra/llm";
import {
  LlmProviderError,
  type LlmProvider,
  type LlmRequestOptions,
} from "@/infra/llm/provider";
import type { GenerateResult, GenerateVariant } from "@/infra/llm/types";

export type GeneratePostFormat = "TEXT" | "PHOTO_TEXT" | "PHOTO";

type BriefingRecord = NonNullable<
  Awaited<ReturnType<typeof getLatestBriefingForUser>>
>;
type AuthorProfileRecord = Awaited<ReturnType<typeof getAuthorProfileForUser>>;

const EXPECTED_VARIANT_LABELS = [
  "Direto",
  "Storytelling",
  "Engraçado",
  "Autoridade",
  "Técnico",
  "Empático",
] as const;

const FORMAT_DESCRIPTIONS: Record<GeneratePostFormat, string> = {
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

const BASE_AVOIDANCES = [
  "Jargão",
  "Textão",
  "Polêmica",
  "Coach vibes",
  "CTA agressivo",
];

const DEFAULT_SERVER_ERROR_MESSAGE =
  "Não foi possível gerar variações no momento.";
const PARSE_RETRY_ERROR_MESSAGE =
  "Não foi possível gerar variações. Tente novamente.";
const LENGTH_REQUEST_OPTIONS: Record<
  PostLength,
  { maxTokens: number; timeoutMs: number }
> = {
  CURTO: { maxTokens: 300, timeoutMs: 45000 },
  MEDIO: { maxTokens: 650, timeoutMs: 90000 },
  LONGO: { maxTokens: 1100, timeoutMs: 120000 },
};
const INSTAGRAM_TOKEN_REDUCTION_FACTOR = 0.85;
const EXPANSION_REQUEST_OPTIONS: LlmRequestOptions = {
  maxTokens: 250,
  timeoutMs: 45000,
};
const generatePostFormatOptions = ["TEXT", "PHOTO_TEXT", "PHOTO"] as const;

const generatePostsActionSchema = z.object({
  theme: z
    .string()
    .trim()
    .min(3, "Informe um tema com pelo menos 3 caracteres."),
  format: z.enum(generatePostFormatOptions),
  platform: platformSchema.default(DEFAULT_PLATFORM),
  objective: postObjectiveSchema.default(DEFAULT_POST_OBJECTIVE),
  length: postLengthSchema.default(DEFAULT_POST_LENGTH),
});

type GenerateActionInput = z.input<typeof generatePostsActionSchema>;
type GenerateActionData = z.output<typeof generatePostsActionSchema>;

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeLabel = (label: unknown) =>
  typeof label === "string" ? label.trim().toLowerCase() : "";

const safeField = (value: string | undefined | null, fallback: string) =>
  value?.trim() || fallback;

const safeAuthorProfileField = (value: string | undefined | null) =>
  value?.trim() || "não informado";

const cleanupResponseText = (raw: string) =>
  raw
    .replace(/```(?:json)?/gi, "")
    .trim()
    .replace(/^\u200B+|\u200B+$/g, "");

const countCharacters = (content: string) => content.trim().length;

class VariantParseError extends Error {}

const tryParseJson = (value: string) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractPayload = (raw: string) => {
  const cleaned = cleanupResponseText(raw);

  if (!cleaned) {
    throw new VariantParseError("Resposta vazia da IA.");
  }

  const direct = tryParseJson(cleaned);
  if (direct) {
    return direct;
  }

  const firstObjectMatch = cleaned.match(/(\{[\s\S]*\})/);
  if (firstObjectMatch) {
    const fromBlock = tryParseJson(firstObjectMatch[1]);
    if (fromBlock) {
      return fromBlock;
    }
  }

  throw new VariantParseError("Não foi possível interpretar o JSON retornado.");
};

const buildVariantList = (payload: unknown): GenerateVariant[] => {
  if (!isRecord(payload)) {
    throw new VariantParseError("Formato inválido: payload não é um objeto.");
  }

  const rawVariants = payload.variants;
  if (!Array.isArray(rawVariants)) {
    throw new VariantParseError(
      "Formato inválido: variants ausente ou malformado."
    );
  }

  if (rawVariants.length !== EXPECTED_VARIANT_LABELS.length) {
    throw new VariantParseError(
      "A resposta deve conter exatamente 6 variações dentro de variants."
    );
  }

  const normalizedMap = new Map<string, { label: string; content: string }>();

  rawVariants.forEach((item, index) => {
    if (!isRecord(item)) {
      throw new VariantParseError(
        `Formato inválido: variante ${index + 1} não é um objeto.`
      );
    }

    const rawLabel = typeof item.label === "string" ? item.label.trim() : "";
    if (!rawLabel) {
      throw new VariantParseError(
        `Formato inválido: variante ${index + 1} precisa de um label válido.`
      );
    }

    const rawContent =
      typeof item.content === "string" ? item.content.trim() : "";
    if (!rawContent) {
      throw new VariantParseError(
        `Formato inválido: o conteúdo da variação "${rawLabel}" não pode estar vazio.`
      );
    }

    const key = normalizeLabel(rawLabel);
    if (!key) {
      throw new VariantParseError(
        `Formato inválido: o label "${rawLabel}" não pôde ser normalizado.`
      );
    }

    if (normalizedMap.has(key)) {
      throw new VariantParseError(`Duplicata detectada para o label "${rawLabel}".`);
    }

    normalizedMap.set(key, { label: rawLabel, content: rawContent });
  });

  const missing = EXPECTED_VARIANT_LABELS.filter(
    (label) => !normalizedMap.has(label.toLowerCase())
  );

  if (missing.length) {
    throw new VariantParseError(`Faltam variações: ${missing.join(", ")}.`);
  }

  return EXPECTED_VARIANT_LABELS.map((label) => {
    const entry = normalizedMap.get(label.toLowerCase());
    if (!entry) {
      throw new VariantParseError(`Faltam variações: ${label}.`);
    }

    return {
      label,
      content: entry.content,
    };
  });
};

const parseStrictVariants = (raw: string) => {
  const payload = extractPayload(raw);
  return buildVariantList(payload);
};

const getGenerationRequestOptions = (
  platform: Platform,
  length: PostLength
): LlmRequestOptions => {
  const requestOptions = LENGTH_REQUEST_OPTIONS[length];

  if (platform !== "INSTAGRAM") {
    return requestOptions;
  }

  return {
    ...requestOptions,
    maxTokens: Math.max(
      1,
      Math.floor(requestOptions.maxTokens * INSTAGRAM_TOKEN_REDUCTION_FACTOR)
    ),
  };
};

const gatherResponseText = async (
  provider: LlmProvider,
  prompt: string,
  requestOptions?: LlmRequestOptions
) => {
  return provider.generateText(prompt, requestOptions);
};

const buildPlatformBlock = (platform: Platform) =>
  ["[PLATFORM]", ...PLATFORM_BLOCKS[platform], "[/PLATFORM]"].join("\n");

const buildObjectiveBlock = (objective: PostObjective) =>
  ["[OBJECTIVE]", ...OBJECTIVE_BLOCKS[objective], "[/OBJECTIVE]"].join("\n");

const buildLengthBlock = (platform: Platform, length: PostLength) =>
  ["[LENGTH]", ...LENGTH_BLOCKS[platform][length], "[/LENGTH]"].join("\n");

const buildAuthorProfileBlock = (profile: AuthorProfileRecord) => {
  if (!profile) {
    return "[AUTHOR_PROFILE] não informado [/AUTHOR_PROFILE]";
  }

  return [
    "[AUTHOR_PROFILE]",
    `Cargo/Atuação: ${safeAuthorProfileField(profile.role)}`,
    `Nicho: ${safeAuthorProfileField(profile.niche)}`,
    `Público: ${safeAuthorProfileField(profile.audience)}`,
    `Nível: ${safeAuthorProfileField(profile.audienceLevel)}`,
    `Estilo: ${safeAuthorProfileField(profile.writingStyle)}`,
    `Tom: ${safeAuthorProfileField(profile.tonePreference)}`,
    `CTA preferido: ${safeAuthorProfileField(profile.ctaPreference)}`,
    "[/AUTHOR_PROFILE]",
  ].join("\n");
};

const buildPrompt = (
  input: GenerateActionData,
  briefing: BriefingRecord,
  authorProfile: AuthorProfileRecord
) => {
  const goal = safeField(briefing.goal, "objetivo principal do briefing");
  const offer = safeField(briefing.offer, "oferta principal");
  const differentiation = safeField(
    briefing.differentiation,
    "diferencial principal"
  );
  const audience = safeField(briefing.audience, "público-alvo não informado");
  const audienceLevel = safeField(briefing.audienceLevel, "Intermediário");
  const tone = briefing.tone?.length ? briefing.tone.join(", ") : "neutro";
  const cta = safeField(briefing.cta, "CTA respeitosa");
  const characterRange = getPostCharacterRange(input.platform, input.length);

  const audienceGuidance =
    AUDIENCE_LEVEL_GUIDANCE[audienceLevel] ??
    "Equilibre clareza e autoridade conforme o contexto.";

  const avoidList = Array.from(
    new Set([
      ...(Array.isArray(briefing.avoid) ? briefing.avoid : []),
      ...BASE_AVOIDANCES,
    ])
  );
  const avoidSummary = avoidList.length ? avoidList.join(", ") : "nenhum";

  const contextSummary = `Objetivo "${goal}", oferta "${offer}", diferencial "${differentiation}", público "${audience}" (${audienceLevel}).`;
  const toneInstruction = `Tons preferidos: ${tone}. ${audienceGuidance}.`;
  const authorProfileBlock = buildAuthorProfileBlock(authorProfile);

  return [
    "Você é um redator experiente focado em redes sociais B2B/B2C.",
    "Use apenas os dados abaixo como contexto e não repita os nomes dos campos do briefing nos textos finais.",
    `Tema base: ${input.theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[input.format]}`,
    authorProfileBlock,
    buildPlatformBlock(input.platform),
    buildObjectiveBlock(input.objective),
    buildLengthBlock(input.platform, input.length),
    `Contexto: ${contextSummary}`,
    toneInstruction,
    `Evite: ${avoidSummary}.`,
    `Labels exigidos: ${EXPECTED_VARIANT_LABELS.join(", ")}. Mantenha essa ordem.`,
    'Retorne APENAS JSON válido com estrutura { "variants": [ { "label": "...", "content": "..." }, ... ] }.',
    `Cada post deve ser em português, pronto para publicação, e ficar preferencialmente entre ${characterRange.min} e ${characterRange.max} caracteres.`,
    "Respeite as regras de plataforma, objetivo e tamanho descritas nos blocos acima.",
    `A última linha deve repetir exatamente o CTA sugerido: ${cta}.`,
    'Não invente dados, não use clichês como "transforme sua vida" ou "ninguém te conta", nem jargões, textão, coach vibes, polêmica ou CTA agressivo.',
    "O conteúdo deve evitar mencionar diretamente os campos do briefing e não pode trazer claims não fornecidas.",
    "O gancho, a estrutura e o CTA não podem usar clichês ou figuras de autoridade exageradas.",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildVariantExpansionPrompt = ({
  input,
  cta,
  label,
  content,
  characterRange,
}: {
  input: GenerateActionData;
  cta: string;
  label: string;
  content: string;
  characterRange: CharacterRange;
}) =>
  [
    "Você vai reescrever apenas uma variação para expandir o texto sem mudar o ângulo central.",
    `Tema base: ${input.theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[input.format]}`,
    buildPlatformBlock(input.platform),
    buildObjectiveBlock(input.objective),
    buildLengthBlock(input.platform, input.length),
    `Label da variação: ${label}`,
    `Faixa obrigatória: ${characterRange.min}-${characterRange.max} caracteres.`,
    `CTA final obrigatório: ${cta}.`,
    "Mantenha o texto em português, pronto para publicação e fiel ao briefing.",
    "Retorne APENAS o texto final da variação, sem JSON, sem comentários e sem título extra.",
    "[CURRENT_VARIANT]",
    content,
    "[/CURRENT_VARIANT]",
  ].join("\n");

const expandShortVariants = async ({
  variants,
  provider,
  input,
  cta,
}: {
  variants: GenerateVariant[];
  provider: LlmProvider;
  input: GenerateActionData;
  cta: string;
}) => {
  const characterRange = getPostCharacterRange(input.platform, input.length);

  return Promise.all(
    variants.map(async (variant) => {
      const originalLength = countCharacters(variant.content);

      if (originalLength >= characterRange.min) {
        return variant;
      }

      try {
        const expandedContent = cleanupResponseText(
          await gatherResponseText(
            provider,
            buildVariantExpansionPrompt({
              input,
              cta,
              label: variant.label,
              content: variant.content,
              characterRange,
            }),
            EXPANSION_REQUEST_OPTIONS
          )
        );

        if (!expandedContent) {
          return variant;
        }

        return countCharacters(expandedContent) >= originalLength
          ? { ...variant, content: expandedContent }
          : variant;
      } catch (error) {
        console.error(
          `[generatePostsAction] erro ao expandir a variação "${variant.label}":`,
          error
        );
        return variant;
      }
    })
  );
};

export async function generatePostsAction(
  input: GenerateActionInput
): Promise<GenerateResult> {
  const parsedInput = generatePostsActionSchema.safeParse(input);

  if (!parsedInput.success) {
    return {
      ok: false,
      error:
        parsedInput.error.flatten().fieldErrors.theme?.[0] ??
        "Não foi possível validar os dados da geração.",
    };
  }

  const validatedInput = parsedInput.data;
  const user = await ensureDevUser();
  const briefing = await getLatestBriefingForUser(user.id);
  const authorProfile = await getAuthorProfileForUser(user.id);

  if (!briefing) {
    return {
      ok: false,
      error: "Salve um briefing antes de gerar os posts.",
    };
  }

  const provider = getLlmProvider();
  const prompt = buildPrompt(validatedInput, briefing, authorProfile);
  const cta = safeField(briefing.cta, "CTA respeitosa");
  const generationRequestOptions = getGenerationRequestOptions(
    validatedInput.platform,
    validatedInput.length
  );

  const runPrompt = async (promptToSend: string) => {
    const rawResponse = await gatherResponseText(
      provider,
      promptToSend,
      generationRequestOptions
    );
    return parseStrictVariants(rawResponse);
  };

  try {
    const variants = await runPrompt(prompt);
    const qualityCheckedVariants = await expandShortVariants({
      variants,
      provider,
      input: validatedInput,
      cta,
    });
    return { ok: true, variants: qualityCheckedVariants };
  } catch (error) {
    if (error instanceof VariantParseError) {
      const retryPrompt = `${prompt}\n\nRETORNE APENAS JSON.`;

      try {
        const variants = await runPrompt(retryPrompt);
        const qualityCheckedVariants = await expandShortVariants({
          variants,
          provider,
          input: validatedInput,
          cta,
        });
        return { ok: true, variants: qualityCheckedVariants };
      } catch (retryError) {
        if (retryError instanceof VariantParseError) {
          return { ok: false, error: PARSE_RETRY_ERROR_MESSAGE };
        }

        const message =
          retryError instanceof Error
            ? retryError.message
            : DEFAULT_SERVER_ERROR_MESSAGE;
        const errorCode =
          retryError instanceof LlmProviderError ? retryError.code : undefined;
        console.error(
          "[generatePostsAction] erro ao gerar variações no retry:",
          retryError
        );
        return {
          ok: false,
          error: message || DEFAULT_SERVER_ERROR_MESSAGE,
          errorCode,
        };
      }
    }

    const message =
      error instanceof Error ? error.message : DEFAULT_SERVER_ERROR_MESSAGE;
    const errorCode =
      error instanceof LlmProviderError ? error.code : undefined;
    console.error("[generatePostsAction] erro ao gerar variações:", error);
    return {
      ok: false,
      error: message || DEFAULT_SERVER_ERROR_MESSAGE,
      errorCode,
    };
  }
}
