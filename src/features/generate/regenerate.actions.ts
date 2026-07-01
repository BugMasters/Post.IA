"use server";

import type { LlmRequestOptions } from "@/infra/llm/provider";
import type { GenerateVariant } from "@/infra/llm/types";
import type {
  Platform,
  PostLength,
  PostObjective,
} from "@/domain/generate";

export type RegenerateVariantResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

const REGENERATE_REQUEST_OPTIONS: LlmRequestOptions = {
  maxTokens: 1024,
  timeoutMs: 60000,
};

const cleanText = (raw: string) =>
  raw.replace(/```(?:json)?/gi, "").trim();

const safeField = (value: string | undefined | null, fallback: string) =>
  value?.trim() || fallback;

export function replaceVariant(
  variants: GenerateVariant[],
  label: string,
  content: string
): GenerateVariant[] {
  return variants.map((variant) =>
    variant.label === label ? { ...variant, content } : variant
  );
}

export async function regenerateVariantAction(
  postId: string,
  label: string
): Promise<RegenerateVariantResult> {
  try {
    const { requireUser } = await import("@/infra/auth/require-user");
    const { getLlmProvider } = await import("@/infra/llm");
    const { getPost, updatePostVariants } = await import(
      "@/features/posts/posts.repository"
    );
    const { getPositioningProfile } = await import(
      "@/features/positioning/positioning.repository"
    );
    const { buildVariantRegenerationPrompt } = await import(
      "./generate.prompt"
    );

    const user = await requireUser();
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
    return { ok: true, content: newContent };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao regenerar a variação.";
    return { ok: false, error: message };
  }
}
