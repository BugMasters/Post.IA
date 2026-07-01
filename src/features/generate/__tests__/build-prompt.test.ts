import { describe, it, expect } from "vitest";
import { buildPositioningBlock, buildFewShotBlock, buildPrompt, buildToneAngleBlock } from "../generate.prompt";

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
    tone: "AUTOMATICO" as const,
    angle: "AUTOMATICO" as const,
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

describe("buildToneAngleBlock", () => {
  it("retorna vazio quando ambos automáticos", () => {
    expect(buildToneAngleBlock("AUTOMATICO", "AUTOMATICO")).toBe("");
  });

  it("inclui só o tom quando ângulo é automático", () => {
    const block = buildToneAngleBlock("PROVOCADOR", "AUTOMATICO");
    expect(block).toContain("TOM_E_ANGULO");
    expect(block.toLowerCase()).toContain("provocad");
  });

  it("inclui tom e ângulo quando ambos definidos", () => {
    const block = buildToneAngleBlock("DIDATICO", "PASSO_A_PASSO");
    expect(block.toLowerCase()).toContain("didát");
    expect(block.toLowerCase()).toContain("passo");
  });
});

describe("buildPrompt tom/ângulo", () => {
  const base = {
    theme: "tema",
    format: "TEXT" as const,
    platform: "LINKEDIN" as const,
    objective: "ENSINAR" as const,
    length: "CURTO" as const,
  };
  const profile = { positioningMemory: "memória", ctaPreference: "Comente" } as any;

  it("injeta bloco quando tom != automático", () => {
    const prompt = buildPrompt({ ...base, tone: "PROVOCADOR", angle: "AUTOMATICO" }, profile);
    expect(prompt).toContain("TOM_E_ANGULO");
  });

  it("não injeta bloco quando ambos automáticos", () => {
    const prompt = buildPrompt({ ...base, tone: "AUTOMATICO", angle: "AUTOMATICO" }, profile);
    expect(prompt).not.toContain("TOM_E_ANGULO");
  });
});
