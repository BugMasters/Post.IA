import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repairMissingCommasInContentLines, safeParseJson } from "../src/lib/llm/jsonSanitize";

type Variant = { label: string; content_lines: string[] };
type Payload = { variants: Variant[] };

const fixturePath = resolve("src/__fixtures__/ollama_bad_json_missing_commas.txt");
const raw = readFileSync(fixturePath, "utf-8");

const parsed = safeParseJson<Payload>(raw);
let payload: Payload;

if (parsed.ok) {
  payload = parsed.value;
} else {
  if (!raw.includes("\"content_lines\"")) {
    throw new Error(`Parse falhou: ${parsed.reason}`);
  }
  const repaired = repairMissingCommasInContentLines(raw);
  const repairedParsed = safeParseJson<Payload>(repaired);
  if (!repairedParsed.ok) {
    throw new Error(`Parse falhou mesmo após repair: ${repairedParsed.reason}`);
  }
  payload = repairedParsed.value;
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
