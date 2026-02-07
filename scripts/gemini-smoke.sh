#!/usr/bin/env bash
set -euo pipefail

echo "== Post.IA | Gemini smoke check =="

if [ -z "${GEMINI_API_KEY:-}" ] || [ "${#GEMINI_API_KEY}" -le 10 ]; then
  echo "ERRO: GEMINI_API_KEY ausente ou curta demais."
  echo "Defina via:"
  echo '  export GEMINI_API_KEY="SUA_CHAVE_AQUI"'
  echo "ou coloque no .env (NAO COMMITAR)."
  exit 1
fi

model="${GEMINI_MODEL:-gemini-flash-latest}"
export GEMINI_BASE_URL="${GEMINI_BASE_URL:-https://generativelanguage.googleapis.com}"

echo "Model:    $model"
echo "Base URL: $GEMINI_BASE_URL"

echo
echo "== ListModels (sem imprimir key) =="
MODELS_JSON="$(curl -sS "${GEMINI_BASE_URL%/}/v1beta/models?key=${GEMINI_API_KEY}")"
echo "Model efetivo: $model"

echo
echo "== CURL smoke test (sem imprimir key) =="
OUT_FILE="scripts/gemini_out.json"
CURL_URL="${GEMINI_BASE_URL%/}/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}"

HTTP_STATUS="$(curl -sS -o "$OUT_FILE" -w "%{http_code}" \
  "$CURL_URL" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Diga ola em uma frase curta."}]}]}' \
)"

echo "HTTP status: $HTTP_STATUS"
if [ "$HTTP_STATUS" = "404" ]; then
  echo "Modelo inválido. Rode ListModels e ajuste GEMINI_MODEL"
fi
if [ "$HTTP_STATUS" = "429" ]; then
  echo "Dica: estourou rate limit/quota; reduzir tokens/chamadas"
fi
echo "Body (primeiros 300 chars):"
head -c 300 "$OUT_FILE" || true
echo

echo
if [ -f "scripts/validate-gemini.mjs" ]; then
  echo "== Node smoke test (scripts/validate-gemini.mjs) =="
  node scripts/validate-gemini.mjs
  echo "OK: validate-gemini.mjs"
else
  echo "INFO: scripts/validate-gemini.mjs nao encontrado, pulando."
fi

echo
echo "== DONE =="
