import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
vi.mock("@/infra/auth/require-user", () => ({
  requireUser: () => requireUser(),
}));

const getPost = vi.fn();
const updatePostVariants = vi.fn();
vi.mock("@/features/posts/posts.repository", () => ({
  getPost: (...a: unknown[]) => getPost(...a),
  updatePostVariants: (...a: unknown[]) => updatePostVariants(...a),
}));

const getPositioningProfile = vi.fn();
vi.mock("@/features/positioning/positioning.repository", () => ({
  getPositioningProfile: (...a: unknown[]) => getPositioningProfile(...a),
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

import { regenerateVariantAction } from "../regenerate.actions";

const PROFILE = {
  niche: "n",
  audience: "a",
  offer: "o",
  differentiation: "d",
  tonePreference: "t",
  ctaPreference: "c",
  positioningMemory: "m",
};

const POST = {
  id: "post-1",
  theme: "tema",
  platform: "LINKEDIN",
  objective: "AUTORIDADE",
  length: "CURTO",
  variants: [{ label: "Direto ao ponto", content: "texto atual" }],
};

describe("regenerateVariantAction — quota diária", () => {
  beforeEach(() => {
    requireUser.mockReset().mockResolvedValue({ id: "user-1" });
    getPost.mockReset().mockResolvedValue(POST);
    updatePostVariants.mockReset().mockResolvedValue(undefined);
    getPositioningProfile.mockReset().mockResolvedValue(PROFILE);
    generateText.mockReset().mockResolvedValue("novo texto regenerado");
    getQuotaStatus.mockReset();
    recordUsage.mockReset().mockResolvedValue({ id: "e1" });
  });

  it("bloqueia sem chamar o LLM quando quota esgotada", async () => {
    getQuotaStatus.mockResolvedValue({ used: 20, limit: 20, remaining: 0 });

    const result = await regenerateVariantAction("post-1", "Direto ao ponto");

    expect(result).toEqual({
      ok: false,
      error: "Você atingiu o limite diário de regenerações. Volte amanhã.",
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(updatePostVariants).not.toHaveBeenCalled();
  });

  it("regenera e registra uso quando há quota", async () => {
    getQuotaStatus.mockResolvedValue({ used: 2, limit: 20, remaining: 18 });

    const result = await regenerateVariantAction("post-1", "Direto ao ponto");

    expect(result).toEqual({ ok: true, content: "novo texto regenerado" });
    expect(getQuotaStatus).toHaveBeenCalledWith("user-1", "regenerate");
    expect(recordUsage).toHaveBeenCalledWith(
      "user-1",
      "regenerate",
      expect.any(Number)
    );
  });
});
