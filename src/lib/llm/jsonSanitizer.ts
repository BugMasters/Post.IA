import { jsonrepair } from "jsonrepair";

export type JsonParseAttempt =
  | {
      ok: true;
      value: unknown;
      usedRepair: boolean;
      extractedBy: "tags" | "object" | "raw";
    }
  | {
      ok: false;
      error: string;
      extractedBy?: "tags" | "object" | "raw";
      extractedPreview?: string;
    };

function stripCodeFences(input: string) {
  return input.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
}

function normalizeQuotes(input: string) {
  // "Smart" quotes break JSON.
  return input.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
}

function extractBetweenTags(text: string, tag = "JSON") {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = text.match(re);
  return match?.[1]?.trim() ?? null;
}

function extractFirstJsonObject(text: string) {
  // From first "{" to last "}" to cover extra text before/after.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1).trim();
}

export function safeParseJsonFromLlm(rawText: string): JsonParseAttempt {
  const raw = normalizeQuotes(stripCodeFences(rawText || ""));

  const byTags = extractBetweenTags(raw, "JSON");
  const candidateFromTags = byTags ?? null;

  const candidateFromObject = candidateFromTags ? null : extractFirstJsonObject(raw);

  const candidate = (candidateFromTags ?? candidateFromObject ?? raw).trim();
  const extractedBy: JsonParseAttempt["extractedBy"] =
    candidateFromTags ? "tags" : candidateFromObject ? "object" : "raw";

  try {
    return { ok: true, value: JSON.parse(candidate), usedRepair: false, extractedBy };
  } catch (firstError) {
    try {
      const repaired = jsonrepair(candidate);
      return { ok: true, value: JSON.parse(repaired), usedRepair: true, extractedBy };
    } catch (secondError) {
      return {
        ok: false,
        error:
          (secondError as Error)?.message ||
          (firstError as Error)?.message ||
          "Invalid JSON from LLM",
        extractedPreview: candidate.slice(0, 600),
      };
    }
  }
}
