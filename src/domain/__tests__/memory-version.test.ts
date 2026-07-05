import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { memorySourceSchema } from "../memory-version";

describe("memorySourceSchema", () => {
  it("aceita as três origens válidas", () => {
    expect(memorySourceSchema.parse("manual")).toBe("manual");
    expect(memorySourceSchema.parse("relearn")).toBe("relearn");
    expect(memorySourceSchema.parse("onboarding")).toBe("onboarding");
  });

  it("rejeita origem inválida", () => {
    expect(() => memorySourceSchema.parse("xpto")).toThrowError(ZodError);
  });
});
