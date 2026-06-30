import { describe, it, expect } from "vitest";
import { buildPositioningBlock, buildFewShotBlock, buildPrompt } from "../generate.prompt";

describe("buildPositioningBlock", () => {
  it("inclui a memória viva", () => {
    const block = buildPositioningBlock({ positioningMemory: "Sou dev sênior, vendo mentoria." } as any);
    expect(block).toContain("Sou dev sênior");
  });

  it("usa fallback quando memória vazia", () => {
    const block = buildPositioningBlock({ positioningMemory: "" } as any);
    expect(block).toContain("não informado");
  });
});

describe("buildFewShotBlock", () => {
  it("retorna vazio sem exemplos", () => {
    expect(buildFewShotBlock([])).toBe("");
  });

  it("inclui os exemplos na voz do usuário", () => {
    const block = buildFewShotBlock([{ label: "Direto", content: "Texto que funcionou." }]);
    expect(block).toContain("EXEMPLOS_NA_VOZ_DO_USUARIO");
    expect(block).toContain("Texto que funcionou.");
  });

  it("trunca exemplos longos", () => {
    const long = "a".repeat(900);
    const block = buildFewShotBlock([{ label: "Direto", content: long }]);
    expect(block.length).toBeLessThan(long.length);
  });
});

describe("buildPrompt few-shot", () => {
  const input = {
    theme: "tema",
    format: "TEXT" as const,
    platform: "LINKEDIN" as const,
    objective: "ENSINAR" as const,
    length: "CURTO" as const,
  };
  const profile = { positioningMemory: "memória", ctaPreference: "Comente" } as any;

  it("injeta bloco quando há exemplos", () => {
    const prompt = buildPrompt(input, profile, [{ label: "Direto", content: "Exemplo bom." }]);
    expect(prompt).toContain("EXEMPLOS_NA_VOZ_DO_USUARIO");
  });

  it("não injeta bloco sem exemplos", () => {
    const prompt = buildPrompt(input, profile, []);
    expect(prompt).not.toContain("EXEMPLOS_NA_VOZ_DO_USUARIO");
  });
});
