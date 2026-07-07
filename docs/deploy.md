# Deploy — Vercel + Neon

## 1. Neon
1. Criar projeto em https://neon.tech (região `sa-east-1` se disponível).
2. Copiar as duas connection strings: **pooled** (→ `DATABASE_URL`) e **direct** (→ `DIRECT_URL`).

## 2. Vercel
1. Importar o repo GitHub em https://vercel.com/new.
2. Framework: Next.js (auto). Build Command (override):
   `npx prisma migrate deploy && npm run build`
3. Environment Variables (Production):
   - `DATABASE_URL` (pooled do Neon)
   - `DIRECT_URL` (direct do Neon)
   - `AUTH_SECRET` (novo: `openssl rand -base64 32` — NÃO reusar o de dev)
   - `AUTH_TRUST_HOST=true`
   - `GEMINI_API_KEY`
   - `DAILY_GENERATION_LIMIT=10`, `DAILY_REGENERATION_LIMIT=20`
   - `LLM_MAX_TIMEOUT_MS=55000` (teto p/ caber no limite de 60s do Hobby)
   - `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (projeto criado em sentry.io)
   - `SENTRY_AUTH_TOKEN` (para source maps)
4. Deploy.

## 3. Convites
Com `DATABASE_URL`/`DIRECT_URL` de prod no shell local:
`npx tsx scripts/generate-invites.ts 10`

## 4. Smoke test (a cada deploy relevante)
1. `/signup` com convite válido → conta criada, cai no onboarding.
2. `/signup` com convite repetido → "Código de convite inválido."
3. Onboarding completo → perfil salvo.
4. `/generate` → 6 variações; contador "1 de 10 gerações hoje".
5. Regenerar 1 variação → funciona.
6. Esgotar quota (ou baixar `DAILY_GENERATION_LIMIT=1` temporariamente) → mensagem de limite.
7. Forçar um erro (rota inexistente autenticada) → evento aparece no Sentry.

## Notas
- Timeout (Vercel Hobby): a função morre em 60s. As páginas que disparam LLM
  (`/generate`, `/onboarding`, `/posicionamento`) já exportam `maxDuration = 60`.
  Definir `LLM_MAX_TIMEOUT_MS=55000` capa TODA chamada LLM abaixo do limite —
  inclusive a geração LONGO (que pede 120s por padrão). Sem esse teto, LONGO é
  morto no meio no Hobby. Nota: `GEMINI_TIMEOUT_MS` sozinho não resolve, porque
  a geração passa timeout explícito por comprimento (o teto tem precedência).
