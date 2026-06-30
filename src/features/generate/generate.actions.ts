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
import { getPositioningProfile } from "@/features/positioning/positioning.repository";
import { requireUser } from "@/infra/auth/require-user";
import { getLlmProvider } from "@/infra/llm";
import {
  LlmProviderError,
  type LlmProvider,
  type LlmRequestOptions,
} from "@/infra/llm/provider";
import type { GenerateResult, GenerateVariant } from "@/infra/llm/types";
import { savePost } from "@/features/posts/posts.repository";
import {
  EXPECTED_VARIANT_LABELS,
  FORMAT_DESCRIPTIONS,
  buildPrompt,
  buildPlatformBlock,
  buildObjectiveBlock,
  buildLengthBlock,
} from "./generate.prompt";

export type GeneratePostFormat = "TEXT" | "PHOTO_TEXT" | "PHOTO";

const DEFAULT_SERVER_ERROR_MESSAGE =
  "Não foi possível gerar variações no momento.";
const PARSE_RETRY_ERROR_MESSAGE =
  "Não foi possível gerar variações. Tente novamente.";
// Orcamento cobre as 6 variacoes inteiras (nao por-variante). Cada variacao
// pode ter ~1 token a cada 3 caracteres em portugues; 6x o limite alto + JSON.
const LENGTH_REQUEST_OPTIONS: Record<
  PostLength,
  { maxTokens: number; timeoutMs: number }
> = {
  CURTO: { maxTokens: 2048, timeoutMs: 60000 },
  MEDIO: { maxTokens: 4096, timeoutMs: 90000 },
  LONGO: { maxTokens: 8192, timeoutMs: 120000 },
};
const INSTAGRAM_TOKEN_REDUCTION_FACTOR = 0.85;
const EXPANSION_REQUEST_OPTIONS: LlmRequestOptions = {
  maxTokens: 1024,
  timeoutMs: 60000,
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeLabel = (label: unknown) =>
  typeof label === "string" ? label.trim().toLowerCase() : "";

const safeField = (value: string | undefined | null, fallback: string) =>
  value?.trim() || fallback;

const cleanupResponseText = (raw: string) =>
  raw
    .replace(/```(?:json)?/gi, "")
    .trim()
    .replace(/^\u200b+|\u200b+$/g, "");

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
    "Mantenha o texto em português, pronto para publicação e fiel ao posicionamento.",
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
  const user = await requireUser();
  const profile = await getPositioningProfile(user.id);

  if (!profile) {
    return {
      ok: false,
      error: "Conclua seu onboarding antes de gerar posts.",
    };
  }

  const provider = getLlmProvider();
  const prompt = buildPrompt(validatedInput, profile);
  const cta = safeField(profile.ctaPreference, "CTA respeitosa");
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
    const saved = await savePost(user.id, {
      theme: validatedInput.theme,
      platform: validatedInput.platform,
      length: validatedInput.length,
      objective: validatedInput.objective,
      variants: qualityCheckedVariants,
    });
    return { ok: true, variants: qualityCheckedVariants, postId: saved.id };
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
        const saved = await savePost(user.id, {
          theme: validatedInput.theme,
          platform: validatedInput.platform,
          length: validatedInput.length,
          objective: validatedInput.objective,
          variants: qualityCheckedVariants,
        });
        return { ok: true, variants: qualityCheckedVariants, postId: saved.id };
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
