# Post.IA — Co-piloto de Posicionamento (Design MVP)

**Data:** 2026-06-28
**Status:** Aprovado para planejamento
**Autor:** Diogo Gulhak (com Claude Code)

---

## 1. Conceito

Post.IA é um co-piloto de conteúdo que **aprende o posicionamento do usuário e melhora a cada uso**.

- **Promessa:** "Posts que soam como você e vendem você — e ficam melhores quanto mais você usa."
- **Público-alvo:** expert solo high-ticket (consultor, médico, advogado, dev sênior). Foco em LinkedIn no MVP.
- **Diferencial central:** memória de posicionamento viva. Concorrentes resetam o contexto a cada prompt; o Post.IA acumula e refina o entendimento da pessoa ao longo do tempo. Isso gera lock-in natural.

### Por que esse diferencial

O mercado de geradores de post com IA é saturado e comoditizado (wrappers de GPT). Diferenciação real só vem de: profundidade num vertical, dado/contexto único, ou workflow. O Post.IA aposta em **contexto único acumulado** — o perfil de posicionamento que evolui — combinado com foco no nicho de experts que precisam de voz de autoridade, não de conteúdo viral genérico.

---

## 2. Escopo

### Dentro do MVP

1. Autenticação real (substitui o `devUser` hardcoded).
2. Onboarding **full conversacional** → cria o perfil de posicionamento inicial.
3. Geração de posts por tema, usando o perfil de posicionamento.
4. Loop de feedback (curti / não curti / "mais assim" / editar) que atualiza o perfil.
5. Salvar posts gerados (histórico) — habilita a memória.
6. Landing page com captura de email (validação de demanda em paralelo).
7. Casca de produto: home real, navegação global, branding, metadata pt-BR.

### Fora do MVP (fase 2+)

- Calibragem periódica por conversa (no MVP entra apenas o aprendizado por feedback).
- Coach de autoridade (score/crítica de posts).
- Repurpose 1→N (uma ideia vira thread, carrossel, post curto, roteiro).
- Agendamento/publicação direta.
- Multi-plataforma além de LinkedIn.

### Restrições

- **IA gratuita apenas.** Gemini API free tier (`gemini-2.5-flash`) no MVP. A abstração `LlmProvider` já existe e permite trocar por Groq, OpenRouter ou Cerebras no futuro sem reescrever.
- **Solo dev.** Objetivo primário: validar se há mercado. Fallback: portfólio que demonstra produto bem pensado.
- **Cota grátis é recurso escasso.** O design precisa ser econômico em chamadas de LLM.

---

## 3. Arquitetura

**Stack:** Next.js 16 (App Router) + Server Actions + Prisma + PostgreSQL + Gemini. Adiciona Auth.js.

**Camadas (mantém o padrão feature-sliced atual):**

- `src/domain/` — tipos e schemas Zod.
- `src/features/<x>/` — server actions + repositories.
- `src/infra/llm/` — provider de LLM (já swappable via interface `LlmProvider`).
- `src/infra/auth/` — configuração Auth.js.
- `app/` — páginas e rotas.

**Mudança-chave de domínio:** os modelos atuais `AuthorProfile` e `Briefing` (ambos rígidos, baseados em selects) são fundidos num único documento vivo, o `PositioningProfile`.

---

## 4. Modelo de dados

### PositioningProfile (1 por usuário)

Documento vivo. O cérebro do diferencial.

- Campos estruturados: nicho, público, oferta, diferencial, tom preferido, CTA preferido. Seed gerado pelo onboarding.
- `positioningMemory` (texto/markdown): o entendimento acumulado da pessoa. A IA lê antes de gerar e reescreve após acumular feedback.

### OnboardingConversation

- Mensagens da conversa de onboarding (multi-turno).
- Estado: em andamento / concluída. Permite retomar conversa parcial.

### Post (geração salva)

- tema, plataforma, tamanho, objetivo, variants (JSON), criadoEm.
- Habilita histórico e memória ("já postei sobre X").

### PostFeedback

- referência ao Post + variantLabel.
- sinal: curti / não curti / editei.
- conteúdoEditado (quando editado), nota curta opcional.
- flag de "já processado pelo aprendizado".
- Alimenta o reaprendizado do `positioningMemory`.

### WaitlistEntry

- email + criadoEm. Captura da landing.

---

## 5. Fluxos

### Fluxo de novo usuário

```
Landing → Signup → Onboarding (conversa) → PositioningProfile criado
→ Gerar 1º post → Feedback → (acumula 3 sinais) → memória evolui → próxima geração melhora
```

### Onboarding full conversacional

- Chat multi-turno. A IA conduz 4-6 perguntas encadeadas, adaptando pela resposta anterior.
- Limite de 6 turnos (proteção de cota).
- Tom de conversa, não formulário. Ex.: "Me conta o que você faz e pra quem", "Cola 1-2 posts ou textos seus" (opcional, seed de voz).
- Estado da conversa salvo a cada turno (retomável se falhar).
- Ao final, a IA sintetiza o `positioningMemory` inicial. A pessoa revisa e ajusta.
- A engine de chat é reaproveitável na calibragem periódica da fase 2.

### Geração + feedback (loop de retenção)

```
Gerar:    positioningMemory + tema → Gemini → 6 variants → salva Post
Feedback: usuário marca/edita um variant → salva PostFeedback
Aprender: SÓ quando acumula N sinais novos (N=3) → 1 chamada Gemini
          reescreve positioningMemory → próxima geração melhora
```

- Cada variant tem: copiar, 👍/👎, "mais assim", editar.
- Editar é o sinal mais forte (a IA compara o antes/depois).
- O reaprendizado roda em lote, nunca por clique — economiza cota.

---

## 6. Telas

| Tela | Acesso | Função |
|---|---|---|
| Landing | público | Promessa + captura de email/CTA cadastro |
| Login/Signup | público | Auth.js |
| Onboarding | 1ª vez | Conversa → monta PositioningProfile inicial |
| Dashboard | logado | Estado atual, atalho gerar, posts recentes |
| Gerar | logado | Tema + opções → 6 variants → feedback inline |
| Histórico | logado | Posts salvos, filtra/relê |
| Posicionamento | logado | Vê/edita a memória viva |

Header global liga todas as telas logadas.

---

## 7. Erros e resiliência

- Erros de LLM (timeout, 429/cota, parse falho): já tratados em `gemini.provider.ts` e no retry de `generate.actions.ts`. Mantidos.
- Onboarding: se a IA falhar no meio, a conversa parcial é salva e retomável. Nunca perde o que a pessoa digitou.
- Aprendizado em lote: se a reanalise falhar, mantém o `positioningMemory` anterior. Nunca corrompe o perfil.

---

## 8. Custo e cota (crítico no MVP)

- Reaprendizado em lote (N=3 sinais), nunca por clique.
- Cap de geração por usuário/dia (anti-abuso + protege cota grátis).
- Onboarding limitado a 6 turnos.
- Log simples de chamadas de LLM para acompanhar consumo.

⚠️ O loop de aprendizado multiplica as chamadas (gerar + reanalisar). Com vários usuários testando, a cota free tier pode estourar. O design em lote mitiga isso.

---

## 9. Testes

- `buildVariantList` / parser de variantes — frágil e crítico. Teste unitário.
- Síntese de `positioningMemory` — testar que feedback altera o perfil (LLM mockado).
- Schemas Zod (onboarding e geração).
- UI não é testada exaustivamente no MVP (YAGNI).
- Stack: Vitest.

---

## 10. Segurança mínima

- Auth.js protege rotas logadas.
- Toda query filtra por `userId` (multi-tenant correto desde o início).
- Validação Zod em toda server action.

---

## 11. Limpeza de dívida (junto com o MVP)

- Remover `mockGenerator.ts` (código morto, era do modo pré-Gemini).
- Substituir `devUser.ts` por auth real.
- Corrigir `layout.tsx`: metadata e `lang="pt-BR"`, branding Post.IA.
- Substituir a home template do Next por landing real.

---

## 12. Roadmap pós-MVP

1. Calibragem periódica por conversa (completa o "ambos" do aprendizado).
2. Coach de autoridade (score + crítica).
3. Repurpose 1→N.
4. Multi-plataforma (Instagram já tem base no domínio).
5. Agendamento/publicação (avaliar custo da API do LinkedIn).
