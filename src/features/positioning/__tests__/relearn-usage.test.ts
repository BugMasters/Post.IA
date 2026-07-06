import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
vi.mock("@/infra/auth/require-user", () => ({
  requireUser: () => requireUser(),
}));

const getPositioningProfile = vi.fn();
const updatePositioningMemory = vi.fn();
vi.mock("../positioning.repository", () => ({
  getPositioningProfile: (...a: unknown[]) => getPositioningProfile(...a),
  updatePositioningMemory: (...a: unknown[]) => updatePositioningMemory(...a),
}));

vi.mock("../memory-version.repository", () => ({
  recordMemoryVersion: vi.fn(),
}));

vi.mock("../relearn.prompts", () => ({
  buildRelearnPrompt: () => "prompt",
}));

const listUnprocessedFeedback = vi.fn();
const markFeedbackProcessed = vi.fn();
vi.mock("@/features/feedback/feedback.repository", () => ({
  listUnprocessedFeedback: (...a: unknown[]) => listUnprocessedFeedback(...a),
  markFeedbackProcessed: (...a: unknown[]) => markFeedbackProcessed(...a),
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

import { relearnPositioningAction } from "../relearn.actions";

describe("relearnPositioningAction — registro de uso", () => {
  beforeEach(() => {
    requireUser.mockReset().mockResolvedValue({ id: "user-1" });
    getPositioningProfile
      .mockReset()
      .mockResolvedValue({ positioningMemory: "memória atual" });
    updatePositioningMemory.mockReset().mockResolvedValue(undefined);
    listUnprocessedFeedback.mockReset().mockResolvedValue([{ id: "f1" }]);
    markFeedbackProcessed.mockReset().mockResolvedValue(undefined);
    generateText.mockReset().mockResolvedValue("nova memória");
    recordUsage.mockReset().mockResolvedValue({ id: "e1" });
  });

  it("registra evento relearn após chamada LLM bem-sucedida", async () => {
    const result = await relearnPositioningAction();

    expect(result).toEqual({ ok: true, updated: true });
    expect(recordUsage).toHaveBeenCalledWith(
      "user-1",
      "relearn",
      expect.any(Number)
    );
  });

  it("sem feedbacks não chama LLM nem registra uso", async () => {
    listUnprocessedFeedback.mockResolvedValue([]);

    const result = await relearnPositioningAction();

    expect(result).toEqual({ ok: true, updated: false });
    expect(generateText).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });
});
