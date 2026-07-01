"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/infra/auth/require-user";
import { getLlmProvider } from "@/infra/llm";
import {
  MAX_ONBOARDING_TURNS,
  type ChatMessage,
} from "@/domain/onboarding";
import {
  buildNextQuestionPrompt,
  buildMemorySynthesisPrompt,
  parseSynthesisPayload,
} from "./onboarding.prompts";
import { getOnboarding, saveOnboarding } from "./onboarding.repository";
import { upsertPositioningProfile } from "@/features/positioning/positioning.repository";
import { recordMemoryVersion } from "@/features/positioning/memory-version.repository";

const READY = "[PRONTO]";

export type AdvanceResult =
  | { ok: true; done: boolean; question?: string }
  | { ok: false; error: string };

export async function advanceOnboardingAction(userMessage: string): Promise<AdvanceResult> {
  try {
    const user = await requireUser();
    const existing = await getOnboarding(user.id);
    const history: ChatMessage[] = (existing?.messages as ChatMessage[] | undefined) ?? [];

    const messages: ChatMessage[] = userMessage.trim()
      ? [...history, { role: "user", content: userMessage.trim() }]
      : history;

    const turnCount = (existing?.turnCount ?? 0) + (userMessage.trim() ? 1 : 0);

    if (turnCount >= MAX_ONBOARDING_TURNS) {
      await saveOnboarding(user.id, messages, "in_progress", turnCount);
      return { ok: true, done: true };
    }

    const provider = getLlmProvider();
    const rawResponse = (await provider.generateText(buildNextQuestionPrompt(messages), {
      maxTokens: 256,
      timeoutMs: 30000,
    })).trim();
    // o modelo as vezes ecoa o rotulo do papel ("ENTREVISTADOR:") do historico.
    const raw = rawResponse.replace(/^(ENTREVISTADOR|EXPERT)\s*:\s*/i, "").trim();

    if (raw.includes(READY)) {
      await saveOnboarding(user.id, messages, "in_progress", turnCount);
      return { ok: true, done: true };
    }

    const withQuestion: ChatMessage[] = [...messages, { role: "assistant", content: raw }];
    await saveOnboarding(user.id, withQuestion, "in_progress", turnCount);
    return { ok: true, done: false, question: raw };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro no onboarding.";
    return { ok: false, error: message };
  }
}

export type FinishResult = { ok: true } | { ok: false; error: string };

export async function finishOnboardingAction(): Promise<FinishResult> {
  try {
    const user = await requireUser();
    const existing = await getOnboarding(user.id);
    const messages = (existing?.messages as ChatMessage[] | undefined) ?? [];
    if (messages.length === 0) {
      return { ok: false, error: "Conversa vazia." };
    }

    const provider = getLlmProvider();
    const raw = await provider.generateText(buildMemorySynthesisPrompt(messages), {
      maxTokens: 700,
      timeoutMs: 60000,
    });
    const seed = parseSynthesisPayload(raw);

    await upsertPositioningProfile(user.id, seed);
    if (seed.positioningMemory) {
      try {
        await recordMemoryVersion(user.id, seed.positioningMemory, "onboarding");
      } catch (versionError) {
        console.error("[finishOnboardingAction] falha ao versionar memória:", versionError);
      }
    }
    await saveOnboarding(user.id, messages, "completed", existing?.turnCount ?? messages.length);

    revalidatePath("/dashboard");
    revalidatePath("/posicionamento");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao concluir onboarding.";
    return { ok: false, error: message };
  }
}
