import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { safeParseJsonFromLlm } from "../src/lib/llm/jsonSanitizer";

type Variant = { label: string; content_lines: string[] };
type Payload = { variants: Variant[] };

const fixturePath = resolve("src/__fixtures__/ollama_bad_json_missing_commas.txt");
const raw = readFileSync(fixturePath, "utf-8");

const parsed = safeParseJsonFromLlm(raw);
let payload: Payload;

if (parsed.ok) {
  payload = parsed.value as Payload;
} else {
  throw new Error(`Parse falhou: ${parsed.error}`);
}

if (!payload || !Array.isArray(payload.variants)) {
  throw new Error("Payload inválido: variants ausente ou malformado.");
}

payload.variants.forEach((variant, index) => {
  if (!variant || typeof variant.label !== "string") {
    throw new Error(`Variant ${index + 1} inválida: label ausente.`);
  }
  if (!Array.isArray(variant.content_lines)) {
    throw new Error(`Variant ${index + 1} inválida: content_lines ausente.`);
  }
});

console.log("OK: fixture parseada com repair e content_lines válido.");
