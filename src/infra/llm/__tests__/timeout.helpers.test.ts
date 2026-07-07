import { describe, it, expect } from "vitest";
import { applyTimeoutCeiling } from "../timeout.helpers";

describe("applyTimeoutCeiling", () => {
  it("sem teto (env indefinida) retorna o valor original", () => {
    expect(applyTimeoutCeiling(120000, undefined)).toBe(120000);
  });

  it("sem teto (env vazia/espaços) retorna o valor original", () => {
    expect(applyTimeoutCeiling(120000, "   ")).toBe(120000);
  });

  it("capa quando o valor excede o teto", () => {
    expect(applyTimeoutCeiling(120000, "55000")).toBe(55000);
  });

  it("mantém o valor quando abaixo do teto", () => {
    expect(applyTimeoutCeiling(30000, "55000")).toBe(30000);
  });

  it("ignora teto inválido (não numérico)", () => {
    expect(applyTimeoutCeiling(120000, "abc")).toBe(120000);
  });

  it("ignora teto <= 0", () => {
    expect(applyTimeoutCeiling(120000, "0")).toBe(120000);
    expect(applyTimeoutCeiling(120000, "-1")).toBe(120000);
  });
});
