import type { GenerateVariant } from "@/infra/llm/types";

// Substitui apenas a variante cujo label corresponde, preservando as demais.
// Função pura (sem dependências server-only) para ser testável isoladamente.
export function replaceVariant(
  variants: GenerateVariant[],
  label: string,
  content: string
): GenerateVariant[] {
  return variants.map((variant) =>
    variant.label === label ? { ...variant, content } : variant
  );
}
