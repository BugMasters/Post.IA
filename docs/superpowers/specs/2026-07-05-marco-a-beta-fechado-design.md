# Marco A — Beta fechado em produção

> Spec de design. Data: 2026-07-05. Base: branch `feat/identidade-visual` (v2 + identidade + auditoria de segurança).
>
> Roadmap de produto aprovado pelo usuário: **A (beta fechado) → B (SaaS pago) → C (modo agência)**. Este spec cobre só o Marco A.

## Objetivo

Colocar o Post.IA no ar para usuários convidados, com custo de LLM controlado e visibilidade de erros. Validar o produto antes de cobrar.

**Critério de sucesso:** um convidado recebe um código, cria conta em produção, faz onboarding, gera posts dentro da quota diária — e qualquer erro em produção aparece num painel de monitoramento.

## Decisões tomadas

| Decisão | Escolha | Racional |
|---|---|---|
| Hosting | **Vercel + Neon** (Postgres serverless) | Deploy por git push, free tier cobre beta, zero manutenção de servidor. |
| Acesso ao beta | **Código de convite** no signup | Controle total de quem entra; simples de implementar. |
| Email transacional | **Adiado para o Marco B** | Convite fechado torna verificação de email redundante; Resend entra no B junto com billing. Reset de senha no beta = manual (admin) + troca de senha logado. |
| Motor de IA | **Gemini permanece** | Regra do projeto (`docs/evolucao-fable-5.md`). |

## Pré-requisito (antes de qualquer task do marco)

Fechar a branch `feat/identidade-visual`: rodar review whole-branch pendente do Marco C, decidir integração via `finishing-a-development-branch`, merge em `main`. Marco A parte de `main` atualizada, em branch nova (`feat/marco-a-beta`).

## Escopo — 4 frentes

### A1. Quota de uso por usuário

O gap mais crítico: hoje qualquer conta gera posts ilimitados na chave Gemini.

- **Modelo novo `UsageEvent`**: `id`, `userId`, `kind` (`"generate" | "regenerate" | "onboarding" | "relearn"`), `durationMs` (Int, nullable — latência da chamada LLM, usada em A4), `createdAt`. Index `[userId, createdAt]`. Migration.
- **Domain**: `usageKindSchema` (Zod) em `src/domain/usage.ts`.
- **Feature `src/features/usage/`**: `usage.repository.ts` (`recordUsage`, `countUsageSince(userId, since, kinds)`) + `usage.helpers.ts` (lógica pura de janela diária, testável sem mock de next-auth).
- **Limites via env** (com defaults no código): `DAILY_GENERATION_LIMIT` (default 10 — cada geração = 6 variações), `DAILY_REGENERATION_LIMIT` (default 20). Onboarding/relearn registram evento mas não têm limite próprio no beta (são naturalmente raros); registrar já deixa o dado pronto para o Marco B.
- **Enforcement nas actions**: `generatePostAction` e `regenerateVariantAction` checam quota **depois** de `requireUser()` e **antes** de chamar o Gemini. Estouro → mensagem pt-BR padrão ("Você atingiu o limite diário de gerações. Volte amanhã."). Registro do evento acontece após sucesso da chamada.
- **Janela diária**: dia-calendário em `America/Sao_Paulo` (helper puro converte "agora" para início do dia; testes cobrem virada de dia).
- **UI**: contador discreto na tela `/generate` ("X de 10 gerações hoje") usando o kicker da identidade (`text-pen`); estado de quota estourada com mensagem clara.
- **Testes**: helper de janela diária; action bloqueia no limite (mock repo); action de outro usuário não consome quota do primeiro (escopo de tenant); evento só registrado em sucesso.

### A2. Signup por código de convite

- **Modelo novo `InviteCode`**: `id`, `code` (`@unique`), `createdAt`, `usedById` (nullable), `usedAt` (nullable). Migration. (O modelo `WaitlistEntry` existente permanece intocado — pode alimentar a lista de convidados manualmente.)
- **Domain**: `signupSchema` ganha campo `inviteCode` (string, `.min(1).max(64)`).
- **Feature auth**: `signupAction` valida código **existente e não usado** dentro da mesma transação que cria o usuário (`prisma.$transaction` com `updateMany where { code, usedById: null }` retornando count — count 0 = código inválido/corrida perdida → aborta). Mensagem de erro de negócio exata: `"Código de convite inválido."` (permitida como exceção de igualdade exata, padrão do CLAUDE.md).
- **Geração de códigos**: script `scripts/generate-invites.ts` (rodado via `npx tsx`, local, com `DATABASE_URL` de prod) que insere N códigos aleatórios (formato curto legível, ex. `PIA-XXXX-XXXX`) e imprime. Sem UI de admin no beta.
- **UI**: campo "Código de convite" no formulário de signup.
- **Testes**: código válido consome e cria conta; código já usado rejeita; código inexistente rejeita; corrida (count 0) não cria usuário.

### A3. Deploy — Vercel + Neon

- **Neon**: criar projeto, obter `DATABASE_URL` (pooled) e `DIRECT_URL` (para migrations). Schema ganha `directUrl = env("DIRECT_URL")` no datasource.
- **Vercel**: conectar repo GitHub, build command padrão. `prisma generate` no `postinstall` (ou build script), `prisma migrate deploy` como passo de build/release.
- **Env de produção**: `DATABASE_URL`, `DIRECT_URL`, `GEMINI_API_KEY`, `AUTH_SECRET` (novo, gerado), `GEMINI_MODEL`/`GEMINI_TIMEOUT_MS` (opcionais), limites de quota.
- **`.env.example`** no repo documentando todas as vars (sem valores).
- **Checagem de runtime**: nada no código pode assumir filesystem local ou processo persistente (revisar; app já é stateless — sessão JWT).
- **Smoke test pós-deploy**: signup com convite → onboarding → geração. Manual, roteiro no PR.

### A4. Observabilidade mínima

- **Sentry** (`@sentry/nextjs`): erros server + client, source maps via Vercel. DSN por env; sem DSN local = desligado (dev não polui).
- **Custo LLM visível**: o `UsageEvent` de A1 já dá contagem de chamadas por dia/usuário e latência (`durationMs`). Consulta manual no Neon basta no beta — sem dashboard próprio.
- **Log estruturado nas actions**: manter padrão atual (`console.error` + mensagem pt-BR); Sentry captura o objeto de erro completo server-side. Nenhuma mudança na regra "nunca vazar erro interno pro usuário".

## Fora de escopo (registrado para B e C)

- **Marco B (SaaS pago):** Stripe + planos + limites por plano, landing page, Resend (verificação de email, reset de senha, recibos), deletar conta self-service (LGPD), termos/privacidade.
- **Marco C (modo agência):** multi-perfil por conta, export/agendamento de posts, operação para clientes.
- Dark mode toggle, microinterações e demais follow-ups visuais (lista no CLAUDE.md).

## Arquitetura e padrões (invariantes do projeto)

- Toda validação nova em `src/domain/*.ts` (Zod), features em `src/features/<x>/`, repos escopados por `userId`.
- `requireUser()` fora do try/catch; erros pt-BR sem vazar interno; `updateMany`/`deleteMany where {id, userId}`.
- Migrations: commitar só `prisma/schema.prisma` + `prisma/migrations`; nunca `src/generated/prisma`.
- Testes não-vazios; `npx tsc --noEmit` após mexer em mocks; lógica pura em `*.helpers.ts`.
- Portões de fechamento: `npm test` → `tsc --noEmit` → `npm run build` → `prisma migrate status`.

## Ordem de execução sugerida

1. Pré-requisito: fechar/mergear `feat/identidade-visual`.
2. A1 quota (maior risco de custo — primeiro).
3. A2 convite.
4. A4 Sentry + duração no evento.
5. A3 deploy (por último: sobe já com quota + convite ativos).
6. Smoke test em produção + convidar primeiros usuários.

## Riscos

| Risco | Mitigação |
|---|---|
| Migration em Neon diverge do local | `DIRECT_URL` + `prisma migrate deploy` no release; `migrate status` no portão. |
| Corrida no uso do convite | Consumo via `updateMany` condicional dentro de transação; count 0 aborta. |
| Quota burlável por relógio | Janela calculada server-side em tz fixa; nenhum input do cliente. |
| Vercel cold start + timeout Gemini (120s default) | Ajustar `maxDuration` da rota/action de geração; se necessário reduzir `GEMINI_TIMEOUT_MS` em prod. |
| Free tier Neon/Vercel estourar | Beta pequeno (convites); UsageEvent dá visibilidade de volume. |
