import type { GeneratePostFormat } from "./types";

export const EXPECTED_VARIANT_LABELS = [
  "Direto",
  "Storytelling",
  "Engraçado",
  "Autoridade",
  "Técnico",
  "Empático",
] as const;

export const VARIANT_TEMPLATE = `{
  "variants": [
    {"label":"Direto","content_lines":["..."]},
    {"label":"Storytelling","content_lines":["..."]},
    {"label":"Engraçado","content_lines":["..."]},
    {"label":"Autoridade","content_lines":["..."]},
    {"label":"Técnico","content_lines":["..."]},
    {"label":"Empático","content_lines":["..."]}
  ]
}`;

export const FORMAT_DESCRIPTIONS: Record<GeneratePostFormat, string> = {
  TEXT: "post completo com começo/meio/fim",
  PHOTO_TEXT: "legenda completa, conectando a imagem ao contexto do tema",
  PHOTO: "legenda direta com ritmo mais ágil",
};
