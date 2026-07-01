# Post.IA

Co-piloto de conteúdo que **aprende seu posicionamento e melhora a cada uso**.
Gera posts que soam como você — e vendem você. Sem texto genérico de IA.

Voltado para o expert solo high-ticket (consultor, médico, advogado, dev sênior)
com foco em LinkedIn. O diferencial é uma `positioningMemory` viva: a IA captura
seu posicionamento no onboarding conversacional e o refina a partir do seu
feedback nos posts gerados.

## Stack

- **Next.js 16** (App Router, Server Actions, React 19)
- **Prisma 6** + **PostgreSQL**
- **Auth.js v5** (`next-auth@beta`) — Credentials + JWT, sem adapter
- **Zod 4** para validação
- **Tailwind CSS 4** + shadcn/ui
- **Vitest** para testes
- LLM via abstração `LlmProvider` (padrão: **Gemini** free tier; trocável por
  Groq / OpenRouter / Cerebras sem mudar o app)

## Setup

### 1. Pré-requisitos

- Node 20+
- pnpm
- Docker (para o Postgres local) ou um Postgres acessível

### 2. Banco

```bash
docker compose up -d db
```

Sobe um Postgres em `localhost:5432` (db/usuário/senha: `postia`).

### 3. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

| Variável         | Descrição                                                        |
| ---------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`   | Conexão Postgres. Local: `postgresql://postia:postia@localhost:5432/postia?schema=public` |
| `LLM_PROVIDER`   | Provedor de LLM (`gemini`)                                       |
| `GEMINI_API_KEY` | Chave do Gemini (free tier em [aistudio.google.com](https://aistudio.google.com)) |
| `GEMINI_MODEL`   | Modelo (padrão `gemini-2.5-flash`)                               |
| `AUTH_SECRET`    | Segredo do Auth.js. Gere com `npx auth secret`                  |

### 4. Dependências + schema

```bash
pnpm install
pnpm prisma migrate deploy   # aplica as migrations
pnpm prisma generate         # gera o client (output: src/generated/prisma)
```

> Para criar novas migrations em desenvolvimento: `pnpm prisma migrate dev`.

### 5. Rodar

```bash
pnpm dev
```

Abra [http://localhost:3000](http://localhost:3000).

Se o Turbopack quebrar por cache corrompido, use o fallback estável:

```bash
pnpm dev:stable
```

## Comandos

| Comando                   | O que faz                          |
| ------------------------- | ---------------------------------- |
| `pnpm dev`                | Servidor de desenvolvimento        |
| `pnpm build`              | Build de produção                  |
| `pnpm start`              | Servir build de produção           |
| `pnpm test`               | Roda a suíte de testes (Vitest)    |
| `pnpm lint`               | ESLint                             |
| `pnpm exec tsc --noEmit`  | Checagem de tipos                  |

## Fluxo do produto

1. **Signup** — cria conta (e-mail + senha).
2. **Onboarding conversacional** — chat multi-turno em que a IA entende seu
   nicho, público, oferta e tom. Ao final, sintetiza sua `positioningMemory`.
3. **Gerar** — a partir de um tema, a IA produz 6 variações de post alinhadas ao
   seu posicionamento.
4. **Feedback** — você marca 👍 / 👎 / "Mais assim" / edição nas variações.
5. **Memória evolui** — a cada 3 sinais de feedback, a IA reaprende em lote e
   atualiza sua `positioningMemory`. Os próximos posts ficam mais com a sua cara.

A landing pública captura interessados via waitlist enquanto a base de usuários é
validada.

## Arquitetura

- `app/` — rotas (App Router). Grupo `(app)` = área autenticada.
- `src/domain/` — schemas Zod e tipos de domínio.
- `src/features/` — lógica por feature (auth, onboarding, positioning, generate,
  posts, feedback, waitlist): repositories + server actions + prompts.
- `src/infra/` — auth, db (Prisma), llm (provider abstrato).
- Multi-tenant: toda query é escopada por `userId`.
