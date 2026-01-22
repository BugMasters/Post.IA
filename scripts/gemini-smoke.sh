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

export GEMINI_MODEL="${GEMINI_MODEL:-gemini-1.5-flash}"
export GEMINI_BASE_URL="${GEMINI_BASE_URL:-https://generativelanguage.googleapis.com}"

echo "Model:    $GEMINI_MODEL"
echo "Base URL: $GEMINI_BASE_URL"

echo
echo "== CURL smoke test (sem imprimir key) =="
OUT_FILE="/tmp/gemini_out.json"
CURL_URL="${GEMINI_BASE_URL%/}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}"

HTTP_STATUS="$(curl -sS -o "$OUT_FILE" -w "%{http_code}" \
  "$CURL_URL" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Diga ola em uma frase curta."}]}]}' \
)"

echo "HTTP status: $HTTP_STATUS"
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
