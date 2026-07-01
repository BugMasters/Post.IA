import { describe, it, expect } from "vitest";
import { buildRelearnPrompt } from "../relearn.prompts";

describe("buildRelearnPrompt", () => {
  it("inclui memória atual e os sinais", () => {
    const prompt = buildRelearnPrompt("Memória atual", [
      { variantLabel: "Direto", signal: "liked", editedContent: null, note: null },
      { variantLabel: "Técnico", signal: "disliked", editedContent: null, note: "muito seco" },
    ] as any);
    expect(prompt).toContain("Memória atual");
    expect(prompt).toContain("Direto");
    expect(prompt).toContain("muito seco");
    expect(prompt).toContain("GOSTOU");
    expect(prompt).toContain("NÃO GOSTOU");
  });
});
