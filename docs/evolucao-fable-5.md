# Usando o Claude Fable 5 para evoluir o Post.IA

> Documento de direção. **Não** troca o motor de IA do produto — o **Gemini continua sendo o runtime** que gera os posts. Este doc é sobre usar o **Claude Fable 5 como copiloto de engenharia** (via Claude Code) — o modelo mais capaz da Anthropic — para elevar o projeto em **Design UI/UX, Segurança, Testes e qualidade geral**.
>
> Data: 2026-07-04. Base: branch `feat/copiloto-posicionamento` (Marcos A+B+C implementados).

---

## 0. Instruções para o Fable 5 (leia primeiro)

Você é o **copiloto de engenharia** deste projeto, não o motor do produto. O Gemini continua gerando os posts; você **melhora o código**. Ao ser acionado com este documento:

1. **Confirme o contexto.** Leia o `CLAUDE.md` do projeto (padrões: Next.js 16 App Router, Prisma multi-tenant escopado por `userId`, Zod em `src/domain`, features em `src/features/<x>`, Vitest, `requireUser()` fora do try/catch, erro pt-BR sem vazar interno). Leia as memórias `post-ia-v2-plano` e `post-ia-licoes-sdd`.

2. **Escolha a frente** que o usuário pediu (UI/UX, Segurança, Testes ou geral). Se ele não especificou, siga a **ordem de prioridade** da seção 8.

3. **Planeje antes de executar.** Para qualquer frente não-trivial: entre em plan mode, use a skill `writing-plans`, apresente o plano, espere aprovação. Rode em `effort: high`/`xhigh`.

4. **Execute via subagent-driven.** Após aprovação, delegue o mecânico a subagents baratos (Haiku/Sonnet) ou ao **Codex** (tarefa fechada + testes — sempre com objetivo, arquivos permitidos/proibidos, testes, critério de aceite, quando parar). Você revisa cada tarefa.

5. **Regras invioláveis do projeto:**
   - Testes **não-vazios** (`.toThrowError(ZodError)` / asserir args, nunca `.toThrow()` pelado).
   - Rodar `npx tsc --noEmit` **depois** de mexer em mocks de teste.
   - **Sem** `import()` dinâmico para escapar de carregar deps no Vitest — extrair lógica pura para `*.helpers.ts` e testar o helper.
   - Cliente Prisma gerado (`src/generated/prisma`) é **gitignored** — nunca `git add`.
   - `requireUser()` **fora** do try/catch; queries escopadas por `userId` (`updateMany`/`deleteMany where {id,userId}`).
   - **Não** trocar o motor de IA do produto (Gemini permanece).

6. **Portões antes de fechar qualquer entrega:** `npm test` verde → `npx tsc --noEmit` 0 → `npm run build` OK → `npx prisma migrate status` up to date (se mexeu em schema).

7. **Fechar a frente:** review whole-branch (`/code-review ultra` ou opus), triagem, e `finishing-a-development-branch`.

**Decisões subjetivas (identidade visual, escopo de produto) são do usuário** — proponha direções concretas (mockups via Artifact), não decida sozinho.

O resto do documento (seções 1-9) é a referência detalhada de cada frente.

---

## 1. Enquadramento

Duas camadas de IA, que não se confundem:

| Camada | Modelo | Papel |
|---|---|---|
| **Runtime do produto** | Gemini 2.5 Flash (`src/infra/llm/gemini.provider.ts`) | Gera as 6 variações de post. **Permanece.** |
| **Copiloto de engenharia** | **Claude Fable 5** (Claude Code) | Constrói, revisa, testa e endurece o código. É sobre isto que este doc trata. |

Por que Fable 5 no desenvolvimento: é o modelo mais capaz para trabalho agêntico de **longo horizonte** — refactors grandes, auditorias de segurança, cobertura de testes, design de UI. Ganho de recall em code review e melhor design de frontend com pouco prompt. Custo alto é aceitável aqui: é ferramenta de dev, não chamada por request de usuário.

**Encaixe no seu workflow atual** (do CLAUDE.md global): "Opus pensa, subagents executam, Claude Code revisa". Fable 5 entra como o cérebro nas tarefas de **maior alavancagem** — planejamento, review whole-branch, auditoria — rodando em `effort: high`/`xhigh`. Subagents mais baratos (Sonnet/Haiku) fazem o trabalho mecânico.

**Codex como subagent executor/testador.** Além dos subagents Claude, o **Codex** entra como executor de tarefa fechada e testador (plugin `codex`, subagent `codex-rescue`). Papel definido pelo CLAUDE.md global: Codex **nunca decide** arquitetura, produto ou escopo — recebe tarefa fechada (objetivo, contexto, arquivos permitidos/proibidos, regras, testes, comandos, critério de aceite, quando parar) e devolve resumo + arquivos alterados + testes + resultado + bloqueios. Bom para: aplicar um refactor já planejado, escrever/rodar uma bateria de testes, segunda opinião de implementação, diagnóstico de bug travado.

---

## 2. Design UI/UX

Stack atual: Next.js 16 + React 19, **shadcn/ui** (`components/ui/*`) + **Tailwind**. Telas: `/dashboard`, `/generate`, `/posts`, `/rascunhos`, `/posicionamento`. Hoje o visual é funcional-cru (componentes shadcn default).

### Como o Fable 5 ajuda
- **Skill `frontend-design`** — direção estética intencional, tipografia, cor, layout que não parece template. Chamar antes de reformular qualquer tela.
- **Artifacts** — gerar mockups HTML navegáveis para comparar direções visuais **antes** de tocar no código. Útil para decidir identidade visual do Post.IA (hoje inexistente).
- **Revisão visual real** — Fable 5 lê screenshots com alta resolução; pode comparar a UI renderizada com um alvo e apontar divergências (a skill `/run` levanta o app).

### Onde aplicar primeiro
1. **Identidade visual** — definir paleta, tipografia e tom próprios (evitar o default cinza/shadcn). Pedir 3-4 direções via Artifact, escolher uma, aplicar.
2. **Fluxo de geração** (`/generate` + `variant-card`) — é o coração do produto. Estados de loading, feedback (👍👎), edição inline e "salvar rascunho" merecem polimento e microinterações.
3. **Onboarding / posicionamento** — primeira impressão; investir em clareza.
4. **Responsividade e acessibilidade** — auditoria de contraste, foco, teclado.

### Como operar
```
/frontend-design  → direção estética
Artifact          → mockup navegável para aprovar antes de codar
subagent-driven   → aplicar tela por tela, com review
```

> Regra: decisão de identidade visual é **do usuário**. Fable 5 propõe direções concretas (mockups), você escolhe.

---

## 3. Segurança

O projeto tem padrões de segurança **bons já estabelecidos** (registrados no `CLAUDE.md` do projeto). Fable 5 serve para **auditar em profundidade** e fechar lacunas.

### Superfícies a auditar
- **Multi-tenancy** — toda query escopada por `userId` via `requireUser()`. Fable 5 pode varrer *todas* as queries Prisma e confirmar que nenhuma vaza dados entre usuários (o padrão `updateMany`/`deleteMany where {id,userId}` — Prisma `update`/`delete` só filtram por chave única).
- **Validação nas bordas** — schemas Zod em `src/domain`. Auditar que **toda** Server Action valida input antes de tocar no banco.
- **Vazamento de erro** — actions usam `console.error` + mensagem pt-BR padrão. Confirmar que nenhuma string de erro interna (stack, SQL, key) chega ao usuário.
- **Segredos** — `GEMINI_API_KEY` e afins só no server; nunca em client component nem em log. Varrer por exposição acidental.
- **Auth guard** — route group `app/(app)` protegido. Confirmar que nenhuma rota sensível escapa do guard.
- **`revalidatePath`** — confirmar que mutações revalidam o cache certo (não mais, não menos).

### Como operar
```
/security-review   → auditoria das mudanças da branch
```
Rodar com Fable 5 em `effort: high`. Para auditoria ampla (não só o diff), pedir varredura direcionada por superfície: "audite todas as queries Prisma quanto a escopo de userId".

> Fable 5 tem safeguards de cibersegurança fortes — auditoria **defensiva** do próprio código é exatamente o caso de uso legítimo.

---

## 4. Testes

Base: Vitest, `vi.mock("@/infra/db/prisma")`. Padrões do projeto: testes **não-vazios**, `requireUser()` fora do try/catch, rodar `tsc` após mexer em mocks.

### Como o Fable 5 ajuda
- **Skill `test-driven-development`** — escrever teste antes da implementação em features novas.
- **Cobrir lacunas** — Fable 5 mapeia caminhos sem teste (branches de erro, edge cases de Zod, cenários multi-tenant) e preenche.
- **Qualidade dos testes** — auditar que os testes existentes **não são vazios** (`.toThrow()` pelado, mocks que não asseguram nada) — foi uma dor recorrente nos Marcos A/B. Fable 5 detecta e corrige.
- **Testes de regressão** — para cada bug achado na auditoria de segurança, um teste que trava o comportamento.

### Onde focar
1. **Actions com escopo de tenant** — teste que uma action de um usuário não altera dado de outro.
2. **Parsers frágeis** — `generate.actions.ts` tem parse de JSON com regex + retry + `expandShortVariants`. Alta complexidade, alto valor de teste. Cobrir os caminhos de falha.
3. **Schemas Zod** — `.toThrowError(ZodError)` com asserção de mensagem, não `.toThrow()`.
4. **Reverter memória / rascunhos** (Marcos C) — garantir que reverter nunca destrói histórico.

### Como operar
```
/tdd (test-driven-development)  → features novas
subagent-driven                 → cobrir lacunas, tarefa por tarefa
```
Regra do projeto: rodar `npx tsc --noEmit` **depois** de qualquer task que mexa em mocks (lição B-T5); extrair lógica pura para `*.helpers.ts` e testar o helper, **sem** `import()` dinâmico (lição B-T7).

---

## 5. Projeto de modo geral

### 5.1 Code review profundo
`/code-review ultra` — review multi-agente na nuvem da branch inteira, com Fable 5. Melhor recall de bugs reais que modelos anteriores. Usar antes de fechar cada marco (você já faz review whole-branch; Fable 5 eleva o teto).

### 5.2 Refactor de alta alavancagem
O parse frágil em `generate.actions.ts` (metade do arquivo é para domar texto livre do Gemini) é candidato a refactor guiado por Fable 5 — extrair, simplificar, cobrir de teste, **sem** trocar o modelo do produto.

### 5.3 Planejamento
Skill `writing-plans` + Fable 5 em effort alto para planejar marcos grandes. Depois, executar via subagent-driven com modelos mais baratos.

### 5.4 Documentação viva
Manter `CLAUDE.md` do projeto e as memórias (`post-ia-v2-plano`, `post-ia-licoes-sdd`) atualizados — Fable 5 é bom em escrever/atualizar memória e aprender com o próprio trabalho.

### 5.5 Consistência de arquitetura
Auditar aderência aos padrões: features em `src/features/<x>`, domain em `src/domain`, infra em `src/infra`, actions com `requireUser` fora do try. Fable 5 aponta desvios.

---

## 6. Como operacionalizar (resumo prático)

| Objetivo | Ferramenta | Modelo/effort |
|---|---|---|
| Direção visual | skill `frontend-design` + Artifact | Fable 5, `high` |
| Auditoria de segurança | `/security-review` | Fable 5, `high` |
| Cobertura de testes | skill `test-driven-development` + subagent-driven | Fable 5 planeja, Sonnet/Haiku executam |
| Review de branch | `/code-review ultra` | Fable 5 (nuvem) |
| Planejar marco grande | skill `writing-plans` | Fable 5, `xhigh` |
| Trabalho mecânico | subagents Claude | Haiku/Sonnet |
| Executar tarefa fechada / testar | subagent **Codex** (`codex-rescue`) | Codex |
| Diagnóstico de bug travado / 2ª opinião | subagent **Codex** | Codex |

**Divisão de trabalho:** Fable 5 pensa/planeja/audita/revisa (alta alavancagem, effort alto). Subagents executam o mecânico — Claude (Haiku/Sonnet) e **Codex** para tarefa fechada + testes. Você (Claude Code) revisa e decide. Igual ao seu workflow global — só com o cérebro mais capaz nos pontos que importam.

> **Contrato do Codex** (CLAUDE.md global): toda tarefa entregue ao Codex leva objetivo, contexto, arquivos permitidos/proibidos, regras, testes, comandos, critério de aceite e quando parar. Codex devolve resumo, arquivos alterados, testes, comandos executados, resultado, erros e bloqueios. Ele executa e testa — não decide arquitetura nem escopo.

---

## 7. Riscos e limites

| Risco | Mitigação |
|---|---|
| Fable 5 é caro por token | Usar só em alta alavancagem (plano, review, auditoria). Mecânico vai para Sonnet/Haiku. |
| Turnos longos | Fable 5 é deliberado; dar a spec completa no primeiro turno, rodar em effort alto, acompanhar de forma assíncrona. |
| Over-engineering | Instrução explícita: só o que a tarefa pede, sem abstração especulativa. |
| Mudança de identidade visual é subjetiva | Decisão é do usuário; Fable 5 propõe mockups concretos, você escolhe. |
| Escopo de auditoria vago | Pedir por superfície ("todas as queries Prisma", "toda action valida input?"), não "audite tudo". |

---

## 8. Próximos passos sugeridos

1. **Identidade visual** — `/frontend-design` + Artifact com 3-4 direções para o Post.IA. (maior impacto percebido)
2. **Auditoria de segurança** — `/security-review` da branch atual + varredura multi-tenant das queries Prisma.
3. **Cobertura de testes** — mapear lacunas (parse de geração, escopo de tenant, reverter memória) e preencher via subagent-driven.
4. **`/code-review ultra`** — antes de fechar a v2.
5. Manter portões: `npm test` verde, `npx tsc --noEmit` 0, `npm run build` OK.

---

## 9. Resumo

Fable 5 **não** substitui o Gemini no produto. Entra como **copiloto de engenharia** de topo, nos pontos de maior alavancagem: definir identidade visual (UI/UX), auditar segurança em profundidade (multi-tenant, validação, vazamento de erro, segredos), fechar lacunas de teste e revisar a branch inteira. Divisão: Fable 5 pensa e audita em effort alto; subagents Claude (Haiku/Sonnet) e **Codex** (tarefa fechada + testes) executam; você decide. Mesmo workflow de sempre, com o cérebro mais capaz onde vale a pena.
