const SNIPPET_LIMIT = 220;

const normalizeSnippet = (value: string, limit = SNIPPET_LIMIT) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
};

const findMatchingBracket = (value: string, startIndex: number) => {
  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = startIndex; i < value.length; i += 1) {
    const char = value[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
};

export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return raw.slice(start, end + 1);
}

export function escapeRawNewlinesInsideStrings(jsonLike: string): string {
  let inString = false;
  let escaped = false;
  let result = "";

  for (let i = 0; i < jsonLike.length; i += 1) {
    const char = jsonLike[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && inString) {
      result += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      result += char;
      inString = !inString;
      continue;
    }

    if (inString && (char === "\n" || char === "\r")) {
      if (char === "\r" && jsonLike[i + 1] === "\n") {
        i += 1;
      }
      result += "\\n";
      continue;
    }

    result += char;
  }

  return result;
}

export function repairMissingCommasInContentLines(raw: string): string {
  const candidate = extractJsonObject(raw);
  const target = candidate ?? raw;

  if (!target.includes("\"content_lines\"")) return target;

  let output = target;
  const keyRegex = /"content_lines"\s*:\s*\[/g;
  let match: RegExpExecArray | null;

  while ((match = keyRegex.exec(output)) !== null) {
    const arrayStart = match.index + match[0].length - 1;
    const arrayEnd = findMatchingBracket(output, arrayStart);

    if (arrayEnd === -1) break;

    const inner = output.slice(arrayStart + 1, arrayEnd);
    const repairedInner = inner
      .replace(/"\s*\n\s*"/g, "\",\n\"")
      .replace(/"\s*"\s*/g, "\", \"");

    output =
      output.slice(0, arrayStart + 1) + repairedInner + output.slice(arrayEnd);
    keyRegex.lastIndex = arrayStart + 1 + repairedInner.length;
  }

  return output;
}

export function repairMissingCommasBetweenStringArrayItems(input: string): string {
  return input
    .replace(/"\s*\n\s*"/g, "\",\n\"")
    .replace(/"\s{2,}"/g, "\", \"")
    .replace(/"\s*"\s*/g, "\", \"");
}

export function safeParseJson<T>(
  raw: string
): { ok: true; value: T; usedRepair: boolean } | { ok: false; reason: string; snippet: string; usedRepair: boolean } {
  const tryParse = (value: string) => {
    const sanitized = escapeRawNewlinesInsideStrings(value);
    try {
      return { ok: true as const, value: JSON.parse(sanitized) as T };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "json_parse_error";
      return { ok: false as const, reason };
    }
  };

  const initial = tryParse(raw);
  if (initial.ok) {
    return { ok: true, value: initial.value, usedRepair: false };
  }

  const candidate = extractJsonObject(raw);
  if (!candidate) {
    return {
      ok: false,
      reason: "json_object_not_found",
      snippet: normalizeSnippet(raw),
      usedRepair: false,
    };
  }

  const repaired = repairMissingCommasBetweenStringArrayItems(candidate);
  const repairedParse = tryParse(repaired);
  if (repairedParse.ok) {
    return { ok: true, value: repairedParse.value, usedRepair: repaired !== candidate };
  }

  return {
    ok: false,
    reason: repairedParse.reason,
    snippet: normalizeSnippet(candidate),
    usedRepair: repaired !== candidate,
  };
}
