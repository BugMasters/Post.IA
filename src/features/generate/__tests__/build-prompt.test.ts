import { describe, it, expect } from "vitest";
import { buildPositioningBlock } from "../generate.prompt";

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
