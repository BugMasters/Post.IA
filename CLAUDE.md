# CLAUDE.md — Post.IA

Co-piloto de posicionamento para redes sociais. Next.js 16 + IA.

## Stack

- **Next.js 16** App Router + Server Actions.
- **React 19** client components (`"use client"`, `useTransition`).
- **Prisma 6** + PostgreSQL local (`localhost:5432`).
- **Zod 4** para schemas de domínio.
- **Vitest** para testes.
- Route group `app/(app)` é guardado por auth.

## Estrutura de pastas

- `src/domain/<x>.ts` — schemas Zod + tipos inferidos. Toda validação de input vive aqui.
- `src/features/<feature>/` — módulos de feature: `*.repository.ts`, `*.actions.ts`, `*.prompts.ts`, `*.helpers.ts`.
- `src/infra/` — infraestrutura (`db/prisma`, `auth/require-user`, `auth`).
- `components/<área>/` — componentes React.
- `app/(app)/<rota>/page.tsx` — páginas server, autenticadas.

## Regras Prisma / banco

- Cliente gerado fica em `src/generated/prisma` e é **gitignored**. NUNCA `git add` nesse path — é regenerado por `prisma generate`.
- Ao commitar migration: adicionar só `prisma/schema.prisma` e `prisma/migrations`.
- **Multi-tenant:** toda query escopada por `userId` (via `requireUser()`).
- Prisma `update`/`delete` filtram só por campo único. Para escopar por dono, usar **`updateMany`/`deleteMany` com `where { id, userId }`**.
- Marco C adicionou migrations (tabelas `Draft`, `PositioningMemoryVersion`); rodar `npx prisma migrate dev`.

## Regras de Server Actions

- `requireUser()` fica **FORA do try/catch** — assim `redirect()` (`NEXT_REDIRECT`) propaga em vez de ser engolido.
- Em erro: `console.error(...)` + retornar mensagem padrão pt-BR. **Nunca vazar** a string de erro interna pro usuário.
- Revalidar rota afetada com `revalidatePath("/rota")`.
- Operações que nunca destroem histórico (ex: reverter memória) criam nova versão a partir da antiga.

## Regras de teste (Vitest)

- Mockar DB com `vi.mock("@/infra/db/prisma")`.
- Testes **não podem ser vazios**: usar `.toThrowError(ZodError)` ou assertar mensagem/args da call, não `.toThrow()` pelado.
- `beforeEach` com `mockClear`/`mockReset`.
- **Rodar `npx tsc --noEmit` depois de qualquer task que mexa em mocks de teste** (lição do B-T5: mock mal tipado passou no vitest mas quebrou o tsc).
- **Sem hack de `import()` dinâmico** dentro de action pra escapar de carregar next-auth no vitest. Extrair a lógica pura pra `*.helpers.ts` e testar o helper (lição do B-T7).

## Portões antes de fechar marco

`npm test` (todos verdes) → `npx tsc --noEmit` (0 erros) → `npm run build` (OK) → `npx prisma migrate status` (up to date, se mexeu em schema).

## Workflow

Execução por **Subagent-Driven Development** (skill `superpowers:subagent-driven-development`): task-brief → implementer (modelo escalado: haiku mecânico, sonnet integração/UI, opus review final) → review-package → task-reviewer → fix → ledger em `.superpowers/sdd/progress.md` → marcar completo. Review whole-branch (opus) no fim do marco.

Ferramentas ausentes na máquina: `gh` CLI não instalado — PRs criados manualmente via link do GitHub.
