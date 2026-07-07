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

- `requireUser()` fica **FORA do try/catch** — assim `redirect()` (`NEXT_REDIRECT`) propaga em vez de ser engolido. (Auditoria 2026-07-05 corrigiu 5 actions antigas que violavam isso — não reintroduzir.)
- Em erro: `console.error(...)` + retornar mensagem padrão pt-BR. **Nunca vazar** `error.message` interno pro usuário (Prisma/conexão/stack). Exceções permitidas: mensagens de `ZodError` (são pt-BR e escritas para o usuário) e erros de negócio conhecidos comparados **por igualdade exata** (ex: "Email já cadastrado." no signup).
- **Posse antes de gravar referência:** se a action recebe um id de recurso (ex: `postId` no feedback), verificar que o recurso pertence ao usuário (`getPost(user.id, id)`) ANTES de gravar. Gravar referência sem checar posse permitiu (bug corrigido) injetar conteúdo de outro usuário no few-shot.
- **Cap em todo texto livre de usuário:** toda action que recebe string livre valida com schema Zod com `.max(...)` (ex: `onboardingMessageSchema` max 2000). Sem cap = payload gigante no banco + custo de LLM.
- Revalidar rota afetada com `revalidatePath("/rota")`.
- Operações que nunca destroem histórico (ex: reverter memória) criam nova versão a partir da antiga.

## Regras de auth/guard

- O guard é **por página**: toda página em `app/(app)` chama `requireUser()` no topo. NÃO existe guard no layout — página nova sem `requireUser()` fica pública. Checar isso em todo review de página nova.
- Login: NextAuth Credentials + bcrypt (`auth.config.ts`); sessão JWT com `token.id`.

## Regras de teste (Vitest)

- Mockar DB com `vi.mock("@/infra/db/prisma")`.
- Testes **não podem ser vazios**: usar `.toThrowError(ZodError)` ou assertar mensagem/args da call, não `.toThrow()` pelado.
- `beforeEach` com `mockClear`/`mockReset`.
- **Rodar `npx tsc --noEmit` depois de qualquer task que mexa em mocks de teste** (lição do B-T5: mock mal tipado passou no vitest mas quebrou o tsc).
- **Sem hack de `import()` dinâmico** dentro de action pra escapar de carregar next-auth no vitest. Extrair a lógica pura pra `*.helpers.ts` e testar o helper (lição do B-T7).

## Identidade visual — "Tinta & Papel"

O app é o papel, a voz do usuário é a tinta, a IA anota à caneta azul. Aplicada em 2026-07-05 (branch `feat/identidade-visual`).

- **Tokens** (`app/globals.css`): papel `#F5F4F0` (background), tinta `#24272B` (foreground/primary), caneta `#2743C7` (`--pen` → utilitários `text-pen`/`border-pen`/`bg-pen`; também `--ring` e `--accent-foreground`), pauta `#D8D6CE` (border/input), card branco. `--radius: 0.375rem`. Bloco `.dark` pronto, sem toggle.
- **Fontes** (`app/layout.tsx` via `next/font`): Newsreader itálica = `--font-display` (classe `font-display`, usada em títulos/logo/"voz"); Public Sans = `--font-sans` (corpo/UI).
- **Padrões de aplicação:** h1 = `font-display text-3xl italic font-medium tracking-tight`; metadados/labels de IA = kicker `text-[11px] uppercase tracking-[0.12em] text-pen`; anotações/histórico = marginalia `border-l-2 border-pen pl-3` + fonte itálica; link ativo do nav = `border-b-2 border-pen` (`components/layout/main-nav.tsx`).
- **Regras:** usar SEMPRE tokens semânticos (`bg-background`, `text-muted-foreground`, `text-destructive`, `text-pen`) — nunca cor hardcoded (`text-red-600` etc.). A caneta é a única cor de destaque; não introduzir segundo acento. Erros = `text-destructive`; confirmações = `text-pen`.
- Follow-ups registrados: toggle dark, microinterações, onboarding editorial, favicon/OG.

## Portões antes de fechar marco

`npm test` (todos verdes) → `npx tsc --noEmit` (0 erros) → `npm run build` (OK) → `npx prisma migrate status` (up to date, se mexeu em schema).

## Workflow

Execução por **Subagent-Driven Development** (skill `superpowers:subagent-driven-development`): task-brief → implementer (modelo escalado: haiku mecânico, sonnet integração/UI, opus review final) → review-package → task-reviewer → fix → ledger em `.superpowers/sdd/progress.md` → marcar completo. Review whole-branch (opus) no fim do marco.

Ferramentas ausentes na máquina: `gh` CLI não instalado — PRs criados manualmente via link do GitHub.
