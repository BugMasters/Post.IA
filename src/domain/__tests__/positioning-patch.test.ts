import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { positioningPatchSchema } from "../onboarding";

describe("positioningPatchSchema", () => {
  it("aceita patch parcial com um campo", () => {
    const parsed = positioningPatchSchema.parse({ niche: "Dev backend" });
    expect(parsed.niche).toBe("Dev backend");
  });

  it("aceita patch só com positioningMemory", () => {
    const parsed = positioningPatchSchema.parse({ positioningMemory: "Nova memória" });
    expect(parsed.positioningMemory).toBe("Nova memória");
  });

  it("rejeita positioningMemory vazia quando presente", () => {
    expect(() => positioningPatchSchema.parse({ positioningMemory: "" })).toThrowError(ZodError);
  });

  it("rejeita patch vazio", () => {
    expect(() => positioningPatchSchema.parse({})).toThrow("Informe ao menos um campo");
  });
});
