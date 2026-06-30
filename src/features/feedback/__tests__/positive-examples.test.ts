// src/features/feedback/__tests__/positive-examples.test.ts
import { describe, it, expect, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/infra/db/prisma", () => ({
  prisma: { postFeedback: { findMany: (a: unknown) => findMany(a) } },
}));

import { listPositiveExamples } from "../feedback.repository";

const post = (variants: { label: string; content: string }[]) => ({
  variants,
});

describe("listPositiveExamples", () => {
  it("prioriza more_like_this > edited > liked e respeita o limite", async () => {
    findMany.mockResolvedValueOnce([
      { signal: "liked", variantLabel: "Direto", editedContent: null, createdAt: new Date("2026-06-01"), post: post([{ label: "Direto", content: "conteúdo liked" }]) },
      { signal: "more_like_this", variantLabel: "Storytelling", editedContent: null, createdAt: new Date("2026-06-02"), post: post([{ label: "Storytelling", content: "conteúdo mlt" }]) },
      { signal: "edited", variantLabel: "Técnico", editedContent: "texto editado", createdAt: new Date("2026-06-03"), post: post([{ label: "Técnico", content: "original" }]) },
    ]);

    const result = await listPositiveExamples("u1", 2);

    expect(result).toEqual([
      { label: "Storytelling", content: "conteúdo mlt" },
      { label: "Técnico", content: "texto editado" },
    ]);
  });

  it("escopa por userId e signals positivos", async () => {
    findMany.mockResolvedValueOnce([]);
    await listPositiveExamples("u1", 3);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (findMany.mock.calls[0] as [any])[0];
    expect(arg.where.userId).toBe("u1");
    expect(arg.where.signal.in).toEqual(["more_like_this", "edited", "liked"]);
    expect(arg.include).toEqual({ post: true });
  });

  it("ignora feedback sem conteúdo resolvível", async () => {
    findMany.mockResolvedValueOnce([
      { signal: "liked", variantLabel: "Inexistente", editedContent: null, createdAt: new Date("2026-06-01"), post: post([{ label: "Direto", content: "x" }]) },
    ]);
    const result = await listPositiveExamples("u1", 3);
    expect(result).toEqual([]);
  });
});
