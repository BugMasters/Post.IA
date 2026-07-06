import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
vi.mock("@/infra/auth/require-user", () => ({
  requireUser: () => requireUser(),
}));

const getPositioningProfile = vi.fn();
vi.mock("@/features/positioning/positioning.repository", () => ({
  getPositioningProfile: (...a: unknown[]) => getPositioningProfile(...a),
}));

const listPositiveExamples = vi.fn();
vi.mock("@/features/feedback/feedback.repository", () => ({
  listPositiveExamples: (...a: unknown[]) => listPositiveExamples(...a),
}));

const savePost = vi.fn();
vi.mock("@/features/posts/posts.repository", () => ({
  savePost: (...a: unknown[]) => savePost(...a),
}));

const generateText = vi.fn();
vi.mock("@/infra/llm", () => ({
  getLlmProvider: () => ({
    generateText: (...a: unknown[]) => generateText(...a),
  }),
}));

const getQuotaStatus = vi.fn();
const recordUsage = vi.fn();
vi.mock("@/features/usage/usage.repository", () => ({
  getQuotaStatus: (...a: unknown[]) => getQuotaStatus(...a),
  recordUsage: (...a: unknown[]) => recordUsage(...a),
}));

import { generatePostsAction } from "../generate.actions";
import { EXPECTED_VARIANT_LABELS } from "../generate.prompt";

const PROFILE = {
  niche: "n",
  audience: "a",
  offer: "o",
  differentiation: "d",
  tonePreference: "t",
  ctaPreference: "c",
  positioningMemory: "m",
};

const validLlmResponse = JSON.stringify({
  variants: EXPECTED_VARIANT_LABELS.map((label) => ({
    label,
    content: "conteúdo válido para publicação. ".repeat(40),
  })),
});

describe("generatePostsAction — quota diária", () => {
  beforeEach(() => {
    requireUser.mockReset().mockResolvedValue({ id: "user-1" });
    getPositioningProfile.mockReset().mockResolvedValue(PROFILE);
    listPositiveExamples.mockReset().mockResolvedValue([]);
    savePost.mockReset().mockResolvedValue({ id: "post-1" });
    generateText.mockReset().mockResolvedValue(validLlmResponse);
    getQuotaStatus.mockReset();
    recordUsage.mockReset().mockResolvedValue({ id: "e1" });
  });

  it("bloqueia sem chamar o LLM quando quota esgotada", async () => {
    getQuotaStatus.mockResolvedValue({ used: 10, limit: 10, remaining: 0 });

    const result = await generatePostsAction({ theme: "tema", format: "TEXT" });

    expect(result).toEqual({
      ok: false,
      error: "Você atingiu o limite diário de gerações. Volte amanhã.",
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(savePost).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("gera e registra uso com duração quando há quota", async () => {
    getQuotaStatus.mockResolvedValue({ used: 1, limit: 10, remaining: 9 });

    const result = await generatePostsAction({ theme: "tema", format: "TEXT" });

    expect(result.ok).toBe(true);
    expect(getQuotaStatus).toHaveBeenCalledWith("user-1", "generate");
    expect(recordUsage).toHaveBeenCalledWith(
      "user-1",
      "generate",
      expect.any(Number)
    );
  });

  it("falha do registro de uso não derruba a geração", async () => {
    getQuotaStatus.mockResolvedValue({ used: 1, limit: 10, remaining: 9 });
    recordUsage.mockRejectedValue(new Error("db down"));

    const result = await generatePostsAction({ theme: "tema", format: "TEXT" });

    expect(result.ok).toBe(true);
  });
});
