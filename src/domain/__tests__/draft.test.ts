import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { draftInputSchema } from "../draft";

describe("draftInputSchema", () => {
  it("aceita um rascunho mínimo (label + content)", () => {
    const parsed = draftInputSchema.parse({ label: "Direto", content: "Texto do post." });
    expect(parsed.label).toBe("Direto");
    expect(parsed.content).toBe("Texto do post.");
  });

  it("aceita campos opcionais", () => {
    const parsed = draftInputSchema.parse({
      label: "Direto",
      content: "Texto",
      postId: "p1",
      theme: "marca pessoal",
      platform: "LINKEDIN",
    });
    expect(parsed.postId).toBe("p1");
  });

  it("rejeita content vazio", () => {
    expect(() => draftInputSchema.parse({ label: "Direto", content: "" })).toThrowError(ZodError);
  });

  it("rejeita label vazio", () => {
    expect(() => draftInputSchema.parse({ label: "", content: "x" })).toThrowError(ZodError);
  });
});
