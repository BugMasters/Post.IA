import { describe, it, expect } from "vitest";
import {
  toneSchema,
  angleSchema,
  DEFAULT_TONE,
  DEFAULT_ANGLE,
  toneLabels,
  angleLabels,
} from "../generate";

describe("tone/angle schemas", () => {
  it("usa AUTOMATICO como default quando ausente", () => {
    expect(toneSchema.parse(undefined)).toBe(DEFAULT_TONE);
    expect(angleSchema.parse(undefined)).toBe(DEFAULT_ANGLE);
  });

  it("aceita valores válidos", () => {
    expect(toneSchema.parse("PROVOCADOR")).toBe("PROVOCADOR");
    expect(angleSchema.parse("CONTRARIAN")).toBe("CONTRARIAN");
  });

  it("rejeita valores inválidos", () => {
    expect(() => toneSchema.parse("XPTO")).toThrow();
    expect(() => angleSchema.parse("XPTO")).toThrow();
  });

  it("tem label pt-BR para todo valor", () => {
    expect(toneLabels.AUTOMATICO).toBe("Automático");
    expect(angleLabels.PASSO_A_PASSO).toBe("Passo a passo");
  });
});
