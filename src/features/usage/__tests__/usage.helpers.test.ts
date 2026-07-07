import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { usageKindSchema } from "@/domain/usage";
import {
  startOfCurrentDaySaoPaulo,
  resolveDailyLimit,
} from "../usage.helpers";

describe("usageKindSchema", () => {
  it("aceita os quatro tipos de uso", () => {
    expect(usageKindSchema.parse("generate")).toBe("generate");
    expect(usageKindSchema.parse("regenerate")).toBe("regenerate");
    expect(usageKindSchema.parse("onboarding")).toBe("onboarding");
    expect(usageKindSchema.parse("relearn")).toBe("relearn");
  });

  it("rejeita tipo desconhecido com ZodError", () => {
    expect(() => usageKindSchema.parse("billing")).toThrowError(ZodError);
  });
});

describe("startOfCurrentDaySaoPaulo", () => {
  it("retorna 00:00 de São Paulo (03:00 UTC) do mesmo dia local", () => {
    // 2026-07-05 15:00 UTC = 2026-07-05 12:00 em SP
    const now = new Date("2026-07-05T15:00:00.000Z");
    expect(startOfCurrentDaySaoPaulo(now).toISOString()).toBe(
      "2026-07-05T03:00:00.000Z"
    );
  });

  it("vira o dia no fuso de SP, não em UTC", () => {
    // 2026-07-05 02:00 UTC = 2026-07-04 23:00 em SP → dia local ainda é 04
    const now = new Date("2026-07-05T02:00:00.000Z");
    expect(startOfCurrentDaySaoPaulo(now).toISOString()).toBe(
      "2026-07-04T03:00:00.000Z"
    );
  });
});

describe("resolveDailyLimit", () => {
  it("usa o valor da env quando é número positivo", () => {
    expect(resolveDailyLimit("25", 10)).toBe(25);
  });

  it("cai no fallback quando env ausente, vazia, negativa ou não-numérica", () => {
    expect(resolveDailyLimit(undefined, 10)).toBe(10);
    expect(resolveDailyLimit("", 10)).toBe(10);
    expect(resolveDailyLimit("-5", 10)).toBe(10);
    expect(resolveDailyLimit("abc", 10)).toBe(10);
  });

  it("trunca valores fracionários", () => {
    expect(resolveDailyLimit("7.9", 10)).toBe(7);
  });
});
