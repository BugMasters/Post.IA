#!/usr/bin/env bash
set -euo pipefail

echo "== Post.IA | Gemini smoke check =="

## .env fallback (model/base url only)
# Se GEMINI_MODEL nao estiver no ambiente, tenta ler do .env (sem expor GEMINI_API_KEY)
if [ -z "${GEMINI_MODEL:-}" ] && [ -f ".env" ]; then
  _m=$(grep -E '^GEMINI_MODEL=' .env | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [ -n "${_m:-}" ]; then export GEMINI_MODEL="$_m"; fi
fi
if [ -z "${GEMINI_BASE_URL:-}" ] && [ -f ".env" ]; then
  _b=$(grep -E '^GEMINI_BASE_URL=' .env | tail -n 1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [ -n "${_b:-}" ]; then export GEMINI_BASE_URL="$_b"; fi
fi

if [ -z "${GEMINI_API_KEY:-}" ] || [ "${#GEMINI_API_KEY}" -le 10 ]; then
  echo "ERRO: GEMINI_API_KEY ausente ou curta demais."
  echo "Defina via:"
  echo '  export GEMINI_API_KEY="SUA_CHAVE_AQUI"'
  echo "ou coloque no .env (NAO COMMITAR)."
  exit 1
fi

USER_GEMINI_MODEL="${GEMINI_MODEL:-}"
export GEMINI_BASE_URL="${GEMINI_BASE_URL:-https://generativelanguage.googleapis.com}"

echo "Model:    ${USER_GEMINI_MODEL:-auto}"
echo "Base URL: $GEMINI_BASE_URL"

echo
echo "== ListModels (sem imprimir key) =="
MODELS_JSON="$(curl -sS "${GEMINI_BASE_URL%/}/v1beta/models?key=${GEMINI_API_KEY}")"
DETECTED_MODEL="$(
  echo "$MODELS_JSON" | jq -r \
    '.models[]? | select(.supportedGenerationMethods | index("generateContent")) | .name' \
    | head -n 1
)"
DETECTED_MODEL="${DETECTED_MODEL#models/}"

if [ -z "${USER_GEMINI_MODEL}" ]; then
  if [ -z "$DETECTED_MODEL" ]; then
    echo "ERRO: Nenhum modelo com generateContent encontrado via ListModels."
    exit 1
  fi
  export GEMINI_MODEL="$DETECTED_MODEL"
else
  export GEMINI_MODEL="$USER_GEMINI_MODEL"
fi

echo "Model efetivo: $GEMINI_MODEL"

echo
echo "== CURL smoke test (sem imprimir key) =="
OUT_FILE="scripts/gemini_out.json"
CURL_URL="${GEMINI_BASE_URL%/}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}"

HTTP_STATUS="$(curl -sS -o "$OUT_FILE" -w "%{http_code}" \
  "$CURL_URL" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Diga ola em uma frase curta."}]}]}' \
)"

echo "HTTP status: $HTTP_STATUS"
if [ "$HTTP_STATUS" = "404" ] && [ -n "$USER_GEMINI_MODEL" ]; then
  echo "Modelo inválido. Rode ListModels e ajuste GEMINI_MODEL"
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
