import { describe, it, expect } from "vitest";
import { parseSynthesisPayload } from "@/features/onboarding/onboarding.prompts";

describe("parseSynthesisPayload", () => {
  it("extrai JSON mesmo com cercas de código", () => {
    const raw = '```json\n{"niche":"Dev","audience":"CTOs","offer":"mentoria","differentiation":"x","tonePreference":"direto","ctaPreference":"Direct","positioningMemory":"Resumo vivo."}\n```';
    const seed = parseSynthesisPayload(raw);
    expect(seed.niche).toBe("Dev");
    expect(seed.positioningMemory).toContain("Resumo");
  });

  it("lança erro se positioningMemory vazio", () => {
    const raw = '{"positioningMemory":""}';
    expect(() => parseSynthesisPayload(raw)).toThrow();
  });
});
