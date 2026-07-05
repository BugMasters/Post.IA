// src/features/feedback/__tests__/feedback.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const postFindFirst = vi.fn((_a: unknown) => Promise.resolve<unknown>(null));
const feedbackCreate = vi.fn((_a: unknown) => Promise.resolve({ id: "f1" }));
const feedbackCount = vi.fn((_a: unknown) => Promise.resolve(0));

vi.mock("@/infra/db/prisma", () => ({
  prisma: {
    post: { findFirst: (a: unknown) => postFindFirst(a) },
    postFeedback: {
      create: (a: unknown) => feedbackCreate(a),
      count: (a: unknown) => feedbackCount(a),
    },
  },
}));

// Evita carregar next-auth no vitest e fixa o usuário autenticado.
vi.mock("@/infra/auth/require-user", () => ({
  requireUser: vi.fn(() => Promise.resolve({ id: "user-1", email: "a@b.c" })),
}));

import { submitFeedbackAction } from "../feedback.actions";

const validInput = {
  postId: "post-1",
  variantLabel: "Direto",
  signal: "liked" as const,
};

describe("submitFeedbackAction", () => {
  beforeEach(() => {
    postFindFirst.mockReset().mockResolvedValue(null);
    feedbackCreate.mockClear();
    feedbackCount.mockReset().mockResolvedValue(0);
  });

  it("recusa feedback em post que não pertence ao usuário", async () => {
    postFindFirst.mockResolvedValueOnce(null);

    const result = await submitFeedbackAction(validInput);

    expect(result).toEqual({ ok: false, error: "Post não encontrado." });
    expect(feedbackCreate).not.toHaveBeenCalled();
    // A checagem de posse precisa escopar por id E userId.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (postFindFirst.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ id: "post-1", userId: "user-1" });
  });

  it("grava feedback do próprio usuário e sinaliza relearn no limiar", async () => {
    postFindFirst.mockResolvedValueOnce({ id: "post-1", userId: "user-1" });
    feedbackCount.mockResolvedValueOnce(3);

    const result = await submitFeedbackAction(validInput);

    expect(result).toEqual({ ok: true, shouldRelearn: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createArg = (feedbackCreate.mock.calls[0] as [any])[0];
    expect(createArg.data.userId).toBe("user-1");
    expect(createArg.data.postId).toBe("post-1");
  });

  it("rejeita input inválido com mensagem de validação", async () => {
    const result = await submitFeedbackAction({
      postId: "",
      variantLabel: "Direto",
      signal: "liked",
    });

    expect(result.ok).toBe(false);
    expect(feedbackCreate).not.toHaveBeenCalled();
  });

  it("não vaza erro interno quando o banco falha", async () => {
    postFindFirst.mockRejectedValueOnce(new Error("connection refused at 10.0.0.5"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await submitFeedbackAction(validInput);

    expect(result).toEqual({ ok: false, error: "Não foi possível salvar o feedback." });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
