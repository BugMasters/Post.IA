# Post.IA — Memória viva + opções de geração (v2)

- **Data:** 2026-06-29
- **Execução planejada:** 2026-06-30 (amanhã)
- **Branch base:** `feat/copiloto-posicionamento`
- **Status:** aprovado (ordem A → B → C), aguardando plano de implementação

## Contexto

MVP do co-piloto está funcional: auth, onboarding conversacional,
`positioningMemory`, geração de 6 variantes, feedback e reaprendizado em lote
(N=3). Fixes recentes: `AUTH_SECRET`, thinking desligado no Gemini, token budget
das 6 variantes.

Esta v2 aprofunda o diferencial (memória que evolui e soa como o usuário) e dá
mais controle ao usuário. 7 features, agrupadas em 3 marcos por alavancagem e
custo. Marco A primeiro: fecha o loop "feedback → memória melhor" com pouco
impacto no schema.

## Objetivo

1. Dar controle direto sobre o posicionamento (editar memória/campos).
2. Transformar feedback real (curtidas, edições) em sinal usado na geração
   (few-shot) e versionar a memória.
3. Ampliar opções de geração (tom/ângulo, regenerar variação isolada) e
   persistência (rascunhos).

## Não-objetivos (YAGNI nesta v2)

- Calibração periódica conversacional (Fase 2 separada).
- Agendamento/publicação automática em redes.
- Multi-idioma, multi-conta/time, billing.

---

## Marco A — Loop de aprendizado

**Por quê primeiro:** maior retorno, schema quase pronto
(`PostFeedback.editedContent`/`note` já existem), e materializa o diferencial.

### A1. Editar posicionamento/memória manualmente

- Tela `/posicionamento` ganha modo de edição dos campos do
  `PositioningProfile` (niche, audience, offer, differentiation, tonePreference,
  ctaPreference, positioningMemory).
- **Server action:** `updatePositioningProfileAction(userId-scoped, patch)` com
  validação Zod (mesmos limites do `positioningSeedSchema`).
- **Repository:** estender `positioning.repository.ts` com
  `updatePositioningProfile(userId, patch)` (update parcial).
- **Interface:** form client-side com estado salvo/erro; `revalidatePath`.
- Edição manual **conta como versão** (ver A3): origem `manual`.

### A2. Editar variação inline antes de copiar

- `variant-card.tsx`: alternar para textarea editável; salvar gera feedback
  `signal=edited` com `editedContent` preenchido (reusa
  `submitFeedbackAction`).
- Copiar usa o texto editado corrente.
- O texto editado é a versão preferida → alimenta A3/few-shot.

### A3. Few-shot dos exemplos que funcionaram

- Na geração, antes do prompt, buscar até **N=3** melhores exemplos do usuário:
  prioridade `more_like_this` > `edited` (usa `editedContent`) > `liked`.
- **Repository (feedback):** `listPositiveExamples(userId, limit)` — join
  feedback↔post, retorna `{ label, content }` (preferindo `editedContent`).
- **Prompt:** `buildPositioningBlock` ganha bloco "Exemplos na voz do usuário"
  (somente se houver exemplos). Limitar tamanho total p/ não estourar tokens.
- Few-shot é contexto de geração; **não** substitui `positioningMemory`.

---

## Marco B — Flexibilidade de geração

### B1. Tom/ângulo por geração

- `generate-form.tsx`: seletor opcional de **tom** (ex.: didático, provocador,
  storytelling, direto) e **ângulo** (ex.: contrarian, caso real, passo a passo).
- Domínio: `toneOption`/`angleOption` em `src/domain/generate.ts` com defaults
  "automático" (mantém comportamento atual).
- `buildPrompt` injeta bloco de tom/ângulo quando != automático.
- Sem mudança de schema (parâmetros são por-request, não persistidos).

### B2. Regenerar 1 variação

- `variant-card.tsx`: botão "Regenerar". Chama
  `regenerateVariantAction(postId, label)`.
- **Action:** carrega o post salvo, reusa prompt de variação única (estilo
  `buildVariantExpansionPrompt`), substitui só aquela variante no `Post.variants`
  e persiste. Retorna a nova variante.
- Orçamento de tokens de variação única (já existe `EXPANSION_REQUEST_OPTIONS`).

---

## Marco C — Persistência extra (tabelas novas)

### C1. Rascunhos salvos

- **Schema:** `model Draft { id, userId, postId?, label, content, theme?,
  platform?, createdAt; @@index([userId]) }`.
- Salvar uma variação favorita como rascunho a partir do `variant-card`.
- Tela `/rascunhos` lista e permite copiar/excluir.
- **Repository:** `createDraft`, `listDrafts`, `deleteDraft` (todos userId-scoped).

### C2. Histórico/versão da memória

- **Schema:** `model PositioningMemoryVersion { id, userId, memory, source
  (manual|relearn|onboarding), createdAt; @@index([userId, createdAt]) }`.
- Toda escrita de `positioningMemory` (onboarding, relearn, edição manual)
  grava uma versão.
- Tela `/posicionamento` mostra histórico e permite **reverter** (cria nova
  versão a partir de uma antiga — nunca destrói).
- **Repository:** `recordMemoryVersion`, `listMemoryVersions`,
  `getMemoryVersion`.

---

## Arquitetura / padrões

- Segue o existente: `src/domain` (Zod), `src/features/<feature>` (repository +
  actions + prompts), `src/infra` (auth, db, llm). App Router, grupo `(app)`.
- **Multi-tenant:** toda query nova escopada por `userId` (findFirst/where).
- **LLM:** continua via `getLlmProvider()`; thinking off; budgets atuais.
- **Erros/resiliência:** falha de IA nunca corrompe memória nem perde post
  salvo (mesmo princípio do relearn). Few-shot vazio → geração normal.
- **Custo/cota:** few-shot limitado a 3 exemplos com teto de caracteres;
  regenerar usa orçamento de variação única; tom/ângulo não adiciona chamadas.

## Modelo de dados (deltas)

- A: nenhum campo novo (usa colunas existentes).
- C1: novo model `Draft`.
- C2: novo model `PositioningMemoryVersion`.
- Migrations geradas via `prisma migrate dev` (ou diff+deploy se não
  interativo, como no histórico do projeto).

## Testes

- A3: `listPositiveExamples` (prioridade/limite), bloco few-shot no prompt.
- A1: validação do patch parcial; A2: mapeamento edição→feedback `edited`.
- B1: prompt com/sem tom/ângulo. B2: substituição de 1 variante preserva as
  outras.
- C: versionamento grava em toda escrita; revert cria versão sem destruir.
- Manter suíte verde + `tsc` + `build`.

## Sequência de execução (amanhã, 2026-06-30)

1. Marco A (A1 → A2 → A3) — loop de aprendizado.
2. Marco B (B1 → B2).
3. Marco C (C1 → C2) — inclui migrations.

Cada marco vira tasks no plano de implementação (writing-plans), executadas no
fluxo subagent-driven já usado nesta branch.
