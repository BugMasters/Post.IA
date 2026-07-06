import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
vi.mock("@/infra/auth/require-user", () => ({
  requireUser: () => requireUser(),
}));

const getOnboarding = vi.fn();
const saveOnboarding = vi.fn();
vi.mock("../onboarding.repository", () => ({
  getOnboarding: (...a: unknown[]) => getOnboarding(...a),
  saveOnboarding: (...a: unknown[]) => saveOnboarding(...a),
}));

vi.mock("../onboarding.prompts", () => ({
  buildNextQuestionPrompt: () => "prompt",
  buildMemorySynthesisPrompt: () => "prompt",
  parseSynthesisPayload: () => ({ positioningMemory: "" }),
}));

vi.mock("@/features/positioning/positioning.repository", () => ({
  upsertPositioningProfile: vi.fn(),
}));

vi.mock("@/features/positioning/memory-version.repository", () => ({
  recordMemoryVersion: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const generateText = vi.fn();
vi.mock("@/infra/llm", () => ({
  getLlmProvider: () => ({
    generateText: (...a: unknown[]) => generateText(...a),
  }),
}));

const recordUsage = vi.fn();
vi.mock("@/features/usage/usage.repository", () => ({
  recordUsage: (...a: unknown[]) => recordUsage(...a),
}));

import { advanceOnboardingAction } from "../onboarding.actions";

describe("advanceOnboardingAction — registro de uso", () => {
  beforeEach(() => {
    requireUser.mockReset().mockResolvedValue({ id: "user-1" });
    getOnboarding.mockReset().mockResolvedValue(null);
    saveOnboarding.mockReset().mockResolvedValue(undefined);
    generateText.mockReset().mockResolvedValue("Qual seu nicho?");
    recordUsage.mockReset().mockResolvedValue({ id: "e1" });
  });

  it("registra evento onboarding após chamada LLM bem-sucedida", async () => {
    const result = await advanceOnboardingAction("minha mensagem");

    expect(result.ok).toBe(true);
    expect(recordUsage).toHaveBeenCalledWith(
      "user-1",
      "onboarding",
      expect.any(Number)
    );
  });

  it("falha no registro não derruba a action", async () => {
    recordUsage.mockRejectedValue(new Error("db down"));

    const result = await advanceOnboardingAction("minha mensagem");

    expect(result.ok).toBe(true);
  });
});
