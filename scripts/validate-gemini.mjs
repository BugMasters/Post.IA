#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 30000;

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.error("GEMINI_API_KEY nao esta definida no ambiente.");
  process.exit(1);
}

const baseUrl = (process.env.GEMINI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
const model = (process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL).replace(/^models\//, "");
const timeoutMs = (() => {
  const raw = process.env.GEMINI_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error("GEMINI_TIMEOUT_MS deve ser um numero positivo em milissegundos.");
    process.exit(1);
  }

  return parsed;
})();

const buildError = (status, payload) => {
  const apiMessage = payload?.error?.message ? ` ${payload.error.message}` : "";

  if (status === 401) {
    return `Falha de autenticacao no Gemini (401). Verifique a GEMINI_API_KEY.${apiMessage}`;
  }

  if (status === 403) {
    return `Acesso negado pelo Gemini (403). Verifique permissoes da chave e do projeto.${apiMessage}`;
  }

  if (status === 404) {
    return `Endpoint ou modelo Gemini nao encontrado (404). Revise GEMINI_BASE_URL e GEMINI_MODEL.${apiMessage}`;
  }

  if (status === 429) {
    return `Limite de uso do Gemini atingido (429). Aguarde um pouco e tente novamente.${apiMessage}`;
  }

  if (status >= 500) {
    return `O Gemini esta indisponivel no momento (${status}). Tente novamente em instantes.${apiMessage}`;
  }

  return `Falha ao validar Gemini (${status}).${apiMessage}`;
};

const extractText = (payload) => {
  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("O Gemini respondeu sem texto utilizavel.");
  }

  return text;
};

const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

try {
  const url = new URL(`${baseUrl}/models/${model}:generateContent`);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: 'Responda apenas com "OK".' }],
        },
      ],
    }),
    signal: controller.signal,
  });

  let payload = null;
  const rawText = await response.text();
  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    console.error(buildError(response.status, payload));
    process.exit(1);
  }

  const text = extractText(payload);
  console.log(`Gemini OK (${model}): ${text}`);
} catch (error) {
  if (error instanceof Error && error.name === "AbortError") {
    console.error(`Tempo limite excedido ao validar Gemini (${timeoutMs} ms).`);
    process.exit(1);
  }

  console.error(error instanceof Error ? error.message : "Falha inesperada ao validar Gemini.");
  process.exit(1);
} finally {
  clearTimeout(timeoutId);
}
