"use server";

import { requireUser } from "@/infra/auth/require-user";
import { getLlmProvider } from "@/infra/llm";
import type { LlmRequestOptions } from "@/infra/llm/provider";
import type { GenerateVariant } from "@/infra/llm/types";
import type {
  Platform,
  PostLength,
  PostObjective,
} from "@/domain/generate";
import { getPost, updatePostVariants } from "@/features/posts/posts.repository";
import { getPositioningProfile } from "@/features/positioning/positioning.repository";
import { getQuotaStatus, recordUsage } from "@/features/usage/usage.repository";
import { buildVariantRegenerationPrompt } from "./generate.prompt";
import { replaceVariant } from "./regenerate.helpers";

export type RegenerateVariantResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

const REGENERATE_REQUEST_OPTIONS: LlmRequestOptions = {
  maxTokens: 1024,
  timeoutMs: 60000,
};

const DEFAULT_REGENERATE_ERROR = "Não foi possível regenerar a variação.";

const REGENERATE_QUOTA_MESSAGE =
  "Você atingiu o limite diário de regenerações. Volte amanhã.";

// Remove cercas de código que a IA às vezes adiciona ao redor do texto.
const cleanText = (raw: string) =>
  raw.replace(/```(?:json)?/gi, "").trim();

const safeField = (value: string | undefined | null, fallback: string) =>
  value?.trim() || fallback;

export async function regenerateVariantAction(
  postId: string,
  label: string
): Promise<RegenerateVariantResult> {
  // Fora do try: requireUser pode chamar redirect() (lança NEXT_REDIRECT), que
  // não deve ser capturado como erro de aplicação — deixa o redirect propagar.
  const user = await requireUser();

  try {
    const quota = await getQuotaStatus(user.id, "regenerate");
    if (quota.remaining <= 0) {
      return { ok: false, error: REGENERATE_QUOTA_MESSAGE };
    }
    const startedAt = Date.now();

    const post = await getPost(user.id, postId);
    if (!post) {
      return { ok: false, error: "Post não encontrado." };
    }

    const profile = await getPositioningProfile(user.id);
    if (!profile) {
      return { ok: false, error: "Conclua seu onboarding antes de regenerar." };
    }

    const variants = post.variants as GenerateVariant[];
    const target = variants.find((variant) => variant.label === label);
    if (!target) {
      return { ok: false, error: "Variação não encontrada." };
    }

    const provider = getLlmProvider();
    const cta = safeField(profile.ctaPreference, "CTA respeitosa");
    const prompt = buildVariantRegenerationPrompt({
      input: {
        theme: post.theme,
        format: "TEXT",
        platform: post.platform as Platform,
        objective: post.objective as PostObjective,
        length: post.length as PostLength,
      },
      profile,
      cta,
      label,
      currentContent: target.content,
    });

    const newContent = cleanText(
      await provider.generateText(prompt, REGENERATE_REQUEST_OPTIONS)
    );
    if (!newContent) {
      return { ok: false, error: "A IA não retornou texto. Tente novamente." };
    }

    const newVariants = replaceVariant(variants, label, newContent);
    await updatePostVariants(user.id, postId, newVariants);
    try {
      await recordUsage(user.id, "regenerate", Date.now() - startedAt);
    } catch (usageError) {
      console.error(
        "[regenerateVariantAction] falha ao registrar uso:",
        usageError
      );
    }
    return { ok: true, content: newContent };
  } catch (error) {
    console.error("[regenerateVariantAction] erro ao regenerar variação:", error);
    return { ok: false, error: DEFAULT_REGENERATE_ERROR };
  }
}
