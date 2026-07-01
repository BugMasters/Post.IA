import { describe, it, expect } from "vitest";
import { replaceVariant } from "../regenerate.helpers";

describe("replaceVariant", () => {
  const variants = [
    { label: "Direto", content: "a" },
    { label: "Técnico", content: "b" },
    { label: "Empático", content: "c" },
  ];

  it("substitui só a variante do label e preserva as outras", () => {
    const out = replaceVariant(variants, "Técnico", "novo");
    expect(out).toEqual([
      { label: "Direto", content: "a" },
      { label: "Técnico", content: "novo" },
      { label: "Empático", content: "c" },
    ]);
  });

  it("não muda nada quando o label não existe", () => {
    const out = replaceVariant(variants, "Inexistente", "novo");
    expect(out).toEqual(variants);
  });
});
