const DEFAULT_MODEL = "gemini-flash-latest";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

const prompt = "Diga olá em uma frase curta.";

const buildApiUrl = (baseUrl, model, apiKey) =>
  `${baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

const main = async () => {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const baseUrl = process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY ausente. Configure no ambiente antes de validar.");
  }

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };

  const response = await fetch(buildApiUrl(baseUrl, model, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    const snippet = bodyText ? bodyText.slice(0, 300) : "(sem corpo)";
    const hint =
      response.status === 403
        ? "Dica: key inválida/restrita ou API não habilitada."
        : "";
    throw new Error(
      `Erro ao chamar o Gemini (status ${response.status}). Corpo: ${snippet}` +
        (hint ? ` ${hint}` : "")
    );
  }

  const payload = await response.json();
  const candidate = payload?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts.map((part) => part?.text).filter(Boolean).join("");

  if (!text) {
    throw new Error("O Gemini não retornou texto.");
  }

  console.log(text.slice(0, 200));
};

main().catch((error) => {
  console.error("Falha ao validar Gemini:", error);
  process.exit(1);
});
