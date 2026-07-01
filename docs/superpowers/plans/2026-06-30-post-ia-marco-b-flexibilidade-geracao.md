# Post.IA Marco B — Flexibilidade de geração (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar mais controle na geração — escolher tom/ângulo por request (B1) e regenerar uma única variação isoladamente sem refazer as outras (B2).

**Architecture:** Mantém a arquitetura existente (`src/domain` Zod, `src/features/<feature>` repository+actions+prompts, `src/infra` auth/db/llm, App Router grupo `app/(app)`). B1 são parâmetros por-request injetados no prompt — **sem mudança de schema**. B2 adiciona um update userId-scoped das variantes de um `Post` já salvo e uma action que regenera só o label pedido, reusando o orçamento de variação única já existente. Marco B **não** altera o banco.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript, Prisma 6 (PostgreSQL), Zod 4, Vitest. Provider LLM via `getLlmProvider()`.

## Global Constraints

- Multi-tenant: toda query nova escopada por `userId`; `userId` sempre via `requireUser()`, nunca vindo do client.
- Sem mudança de schema no Marco B (tom/ângulo são por-request, não persistidos; B2 só atualiza `Post.variants` existente).
- LLM via `getLlmProvider()`; thinking off; B2 usa o orçamento de variação única já existente (`EXPANSION_REQUEST_OPTIONS = { maxTokens: 1024, timeoutMs: 60000 }`); tom/ângulo **não** adicionam chamadas.
- Defaults preservam o comportamento atual: tom e ângulo default `AUTOMATICO` → nenhum bloco injetado, geração idêntica à de hoje.
- Resiliência: falha de IA nunca corrompe o post salvo. Em B2, só persiste se a IA retornar texto não-vazio; senão retorna erro e mantém as variantes originais.
- Server Actions começam com `"use server";`. pt-BR com acentuação correta em copy e labels.
- Testes: `npm test` (vitest) verde; `npx tsc --noEmit` limpo; `npm run build` OK.
- Branch de trabalho: `feat/copiloto-posicionamento` (Marco A já mergeado nela).

---

## File Structure

**B1 — Tom/ângulo por geração**
- Modify `src/domain/generate.ts` — opções/schemas/labels de `tone` e `angle`.
- Modify `src/features/generate/generate.prompt.ts` — `buildToneAngleBlock` + `tone`/`angle` em `GeneratePromptInput` + injeção em `buildPrompt`.
- Modify `src/features/generate/generate.actions.ts` — `generatePostsActionSchema` ganha `tone`/`angle` (passam por `validatedInput`).
- Modify `components/generate/generate-form.tsx` — dois `Select` (tom, ângulo).
- Test `src/domain/__tests__/tone-angle.test.ts`, e novos casos em `src/features/generate/__tests__/build-prompt.test.ts`.

**B2 — Regenerar 1 variação**
- Modify `src/features/posts/posts.repository.ts` — `updatePostVariants(userId, postId, variants)`.
- Modify `src/features/generate/generate.prompt.ts` — `buildVariantRegenerationPrompt(...)`.
- Create `src/features/generate/regenerate.actions.ts` — `replaceVariant(...)` + `regenerateVariantAction(postId, label)`.
- Modify `components/generate/variant-card.tsx` — botão "Regenerar".
- Test `src/features/posts/__tests__/posts.repository.test.ts` (caso update), `src/features/generate/__tests__/regenerate.test.ts` (replaceVariant).

---

## Task 1: B1 — Opções de tom e ângulo no domínio

**Files:**
- Modify: `src/domain/generate.ts`
- Test: `src/domain/__tests__/tone-angle.test.ts`

**Interfaces:**
- Produces:
  - `toneOptions = ["AUTOMATICO","DIDATICO","PROVOCADOR","STORYTELLING","DIRETO"] as const`
  - `angleOptions = ["AUTOMATICO","CONTRARIAN","CASO_REAL","PASSO_A_PASSO"] as const`
  - `DEFAULT_TONE = "AUTOMATICO"`, `DEFAULT_ANGLE = "AUTOMATICO"`
  - `toneSchema` (z.enum default AUTOMATICO), `angleSchema` (idem)
  - `type ToneOption`, `type AngleOption`
  - `toneLabels: Record<ToneOption,string>`, `angleLabels: Record<AngleOption,string>` (pt-BR)

- [ ] **Step 1: Write the failing test**

```typescript
// src/domain/__tests__/tone-angle.test.ts
import { describe, it, expect } from "vitest";
import {
  toneSchema,
  angleSchema,
  DEFAULT_TONE,
  DEFAULT_ANGLE,
  toneLabels,
  angleLabels,
} from "../generate";

describe("tone/angle schemas", () => {
  it("usa AUTOMATICO como default quando ausente", () => {
    expect(toneSchema.parse(undefined)).toBe(DEFAULT_TONE);
    expect(angleSchema.parse(undefined)).toBe(DEFAULT_ANGLE);
  });

  it("aceita valores válidos", () => {
    expect(toneSchema.parse("PROVOCADOR")).toBe("PROVOCADOR");
    expect(angleSchema.parse("CONTRARIAN")).toBe("CONTRARIAN");
  });

  it("rejeita valores inválidos", () => {
    expect(() => toneSchema.parse("XPTO")).toThrow();
    expect(() => angleSchema.parse("XPTO")).toThrow();
  });

  it("tem label pt-BR para todo valor", () => {
    expect(toneLabels.AUTOMATICO).toBe("Automático");
    expect(angleLabels.PASSO_A_PASSO).toBe("Passo a passo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/__tests__/tone-angle.test.ts`
Expected: FAIL — exports não existem.

- [ ] **Step 3: Implement options/schemas/labels**

Adicionar ao final de `src/domain/generate.ts`:

```typescript
export const toneOptions = [
  "AUTOMATICO",
  "DIDATICO",
  "PROVOCADOR",
  "STORYTELLING",
  "DIRETO",
] as const;
export const angleOptions = [
  "AUTOMATICO",
  "CONTRARIAN",
  "CASO_REAL",
  "PASSO_A_PASSO",
] as const;

export const DEFAULT_TONE = "AUTOMATICO";
export const DEFAULT_ANGLE = "AUTOMATICO";

export const toneSchema = z.enum(toneOptions).default(DEFAULT_TONE);
export const angleSchema = z.enum(angleOptions).default(DEFAULT_ANGLE);

export type ToneOption = z.output<typeof toneSchema>;
export type AngleOption = z.output<typeof angleSchema>;

export const toneLabels: Record<ToneOption, string> = {
  AUTOMATICO: "Automático",
  DIDATICO: "Didático",
  PROVOCADOR: "Provocador",
  STORYTELLING: "Storytelling",
  DIRETO: "Direto",
};

export const angleLabels: Record<AngleOption, string> = {
  AUTOMATICO: "Automático",
  CONTRARIAN: "Contrarian",
  CASO_REAL: "Caso real",
  PASSO_A_PASSO: "Passo a passo",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/__tests__/tone-angle.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/domain/generate.ts src/domain/__tests__/tone-angle.test.ts
git commit -m "feat(generate): tone/angle options in domain (B1)"
```

---

## Task 2: B1 — Bloco de tom/ângulo no prompt

**Files:**
- Modify: `src/features/generate/generate.prompt.ts`
- Test: `src/features/generate/__tests__/build-prompt.test.ts`

**Interfaces:**
- Consumes: `ToneOption`, `AngleOption` de `@/domain/generate` (Task 1).
- Produces:
  - `buildToneAngleBlock(tone: ToneOption, angle: AngleOption): string` — `""` quando ambos `AUTOMATICO`; senão bloco `[TOM_E_ANGULO] ... [/TOM_E_ANGULO]` só com as linhas dos não-automáticos.
  - `GeneratePromptInput` ganha `tone: ToneOption` e `angle: AngleOption`.
  - `buildPrompt` injeta o bloco logo após `buildObjectiveBlock(...)`.

- [ ] **Step 1: Add failing tests**

Acrescentar a `src/features/generate/__tests__/build-prompt.test.ts`:

```typescript
import { buildToneAngleBlock } from "../generate.prompt";

describe("buildToneAngleBlock", () => {
  it("retorna vazio quando ambos automáticos", () => {
    expect(buildToneAngleBlock("AUTOMATICO", "AUTOMATICO")).toBe("");
  });

  it("inclui só o tom quando ângulo é automático", () => {
    const block = buildToneAngleBlock("PROVOCADOR", "AUTOMATICO");
    expect(block).toContain("TOM_E_ANGULO");
    expect(block.toLowerCase()).toContain("provocad");
  });

  it("inclui tom e ângulo quando ambos definidos", () => {
    const block = buildToneAngleBlock("DIDATICO", "PASSO_A_PASSO");
    expect(block.toLowerCase()).toContain("didát");
    expect(block.toLowerCase()).toContain("passo");
  });
});

describe("buildPrompt tom/ângulo", () => {
  const base = {
    theme: "tema",
    format: "TEXT" as const,
    platform: "LINKEDIN" as const,
    objective: "ENSINAR" as const,
    length: "CURTO" as const,
  };
  const profile = { positioningMemory: "memória", ctaPreference: "Comente" } as any;

  it("injeta bloco quando tom != automático", () => {
    const prompt = buildPrompt({ ...base, tone: "PROVOCADOR", angle: "AUTOMATICO" }, profile);
    expect(prompt).toContain("TOM_E_ANGULO");
  });

  it("não injeta bloco quando ambos automáticos", () => {
    const prompt = buildPrompt({ ...base, tone: "AUTOMATICO", angle: "AUTOMATICO" }, profile);
    expect(prompt).not.toContain("TOM_E_ANGULO");
  });
});
```

> Nota: o `import { buildPrompt } from "../generate.prompt";` já existe no arquivo de teste (Marco A). Os objetos `base` aqui incluem `tone`/`angle` porque `GeneratePromptInput` passa a exigi-los.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/generate/__tests__/build-prompt.test.ts`
Expected: FAIL — `buildToneAngleBlock` não existe / `GeneratePromptInput` não tem `tone`/`angle`.

- [ ] **Step 3: Implement block and thread tone/angle**

Em `src/features/generate/generate.prompt.ts`, ampliar o import do domínio (o arquivo já importa de `@/domain/generate`):

```typescript
import {
  getPostCharacterRange,
  type Platform,
  type PostLength,
  type PostObjective,
  type ToneOption,
  type AngleOption,
} from "@/domain/generate";
```

Adicionar os guias e o builder (perto dos outros `build*Block`):

```typescript
const TONE_GUIDANCE: Record<Exclude<ToneOption, "AUTOMATICO">, string> = {
  DIDATICO: "Tom didático: explique com clareza, exemplos e ritmo de quem ensina.",
  PROVOCADOR: "Tom provocador: tese forte, contraponto e leve tensão, sem ofender.",
  STORYTELLING: "Tom de storytelling: comece por uma cena concreta e conduza por narrativa.",
  DIRETO: "Tom direto: vá ao ponto, frases curtas, zero rodeio.",
};

const ANGLE_GUIDANCE: Record<Exclude<AngleOption, "AUTOMATICO">, string> = {
  CONTRARIAN: "Ângulo contrarian: parta de uma visão contra o senso comum e sustente com argumento.",
  CASO_REAL: "Ângulo de caso real: ancore em uma situação concreta e prática.",
  PASSO_A_PASSO: "Ângulo passo a passo: estruture como sequência clara de passos acionáveis.",
};

export function buildToneAngleBlock(tone: ToneOption, angle: AngleOption) {
  const lines: string[] = [];
  if (tone !== "AUTOMATICO") lines.push(TONE_GUIDANCE[tone]);
  if (angle !== "AUTOMATICO") lines.push(ANGLE_GUIDANCE[angle]);
  if (lines.length === 0) return "";
  return ["[TOM_E_ANGULO]", ...lines, "[/TOM_E_ANGULO]"].join("\n");
}
```

Ampliar o tipo de input:

```typescript
export type GeneratePromptInput = {
  theme: string;
  format: GeneratePostFormat;
  platform: Platform;
  objective: PostObjective;
  length: PostLength;
  tone: ToneOption;
  angle: AngleOption;
};
```

Em `buildPrompt`, injetar o bloco logo após `buildObjectiveBlock(input.objective)`. A lista de linhas passa a conter:

```typescript
    buildPositioningBlock(profile),
    fewShotBlock,
    buildPlatformBlock(input.platform),
    buildObjectiveBlock(input.objective),
    buildToneAngleBlock(input.tone, input.angle),
    buildLengthBlock(input.platform, input.length),
```

> O `.filter(Boolean)` já existente remove o bloco quando ele é `""`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/generate/__tests__/build-prompt.test.ts`
Expected: PASS (todos: buildPositioningBlock + few-shot do Marco A + tom/ângulo).

- [ ] **Step 5: Commit**

```bash
git add src/features/generate/generate.prompt.ts src/features/generate/__tests__/build-prompt.test.ts
git commit -m "feat(generate): tone/angle block in buildPrompt (B1)"
```

---

## Task 3: B1 — Threading de tom/ângulo na action

**Files:**
- Modify: `src/features/generate/generate.actions.ts`

**Interfaces:**
- Consumes: `toneSchema`, `angleSchema` de `@/domain/generate` (Task 1); `GeneratePromptInput` com tom/ângulo (Task 2).
- Produces: `generatePostsActionSchema` aceita `tone`/`angle` (com defaults), e `validatedInput` (passado a `buildPrompt`) carrega os dois.

- [ ] **Step 1: Extend the action schema**

Em `src/features/generate/generate.actions.ts`, ampliar o import do domínio para incluir `toneSchema` e `angleSchema`:

```typescript
import {
  DEFAULT_PLATFORM,
  DEFAULT_POST_LENGTH,
  DEFAULT_POST_OBJECTIVE,
  getPostCharacterRange,
  platformSchema,
  type CharacterRange,
  type Platform,
  postLengthSchema,
  type PostLength,
  postObjectiveSchema,
  type PostObjective,
  toneSchema,
  angleSchema,
} from "@/domain/generate";
```

Acrescentar os campos ao schema:

```typescript
const generatePostsActionSchema = z.object({
  theme: z
    .string()
    .trim()
    .min(3, "Informe um tema com pelo menos 3 caracteres."),
  format: z.enum(generatePostFormatOptions),
  platform: platformSchema.default(DEFAULT_PLATFORM),
  objective: postObjectiveSchema.default(DEFAULT_POST_OBJECTIVE),
  length: postLengthSchema.default(DEFAULT_POST_LENGTH),
  tone: toneSchema,
  angle: angleSchema,
});
```

> `buildPrompt(validatedInput, profile, examples)` já recebe `validatedInput`, que agora inclui `tone`/`angle` — nenhuma outra mudança nesse call site. `buildVariantExpansionPrompt` ignora os campos extras.

- [ ] **Step 2: Type-check + tests**

Run: `npx tsc --noEmit`
Expected: sem erros.
Run: `npm test`
Expected: suíte verde.

- [ ] **Step 3: Commit**

```bash
git add src/features/generate/generate.actions.ts
git commit -m "feat(generate): accept tone/angle in generate action (B1)"
```

---

## Task 4: B1 — Seletores de tom/ângulo no formulário

**Files:**
- Modify: `components/generate/generate-form.tsx`

**Interfaces:**
- Consumes: `toneOptions`, `angleOptions`, `toneLabels`, `angleLabels`, `DEFAULT_TONE`, `DEFAULT_ANGLE`, `ToneOption`, `AngleOption` de `@/domain/generate`; `generatePostsAction` já existente.
- Produces: dois novos `Select` que enviam `tone`/`angle` no payload de `generatePostsAction`.

- [ ] **Step 1: Add state, imports and selects**

Em `components/generate/generate-form.tsx`:

1. Ampliar o import de `@/domain/generate` para incluir:
```typescript
  angleLabels,
  angleOptions,
  DEFAULT_ANGLE,
  DEFAULT_TONE,
  toneLabels,
  toneOptions,
  type AngleOption,
  type ToneOption,
```

2. Adicionar estado (perto dos outros `useState`):
```typescript
  const [tone, setTone] = React.useState<ToneOption>(DEFAULT_TONE);
  const [angle, setAngle] = React.useState<AngleOption>(DEFAULT_ANGLE);
```

3. Incluir `tone` e `angle` no payload da action:
```typescript
      const result = await generatePostsAction({
        theme: trimmedTheme,
        format: formatTranslator[format],
        platform,
        objective,
        length,
        tone,
        angle,
      });
```

4. Adicionar um novo grid de 2 colunas com os selects, logo após o grid de Objetivo/Tamanho (mesmo padrão visual dos existentes):
```tsx
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="tone">Tom</Label>
                <Select
                  id="tone"
                  value={tone}
                  onChange={(event) => setTone(event.target.value as ToneOption)}
                >
                  {toneOptions.map((option) => (
                    <option key={option} value={option}>
                      {toneLabels[option]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="angle">Ângulo</Label>
                <Select
                  id="angle"
                  value={angle}
                  onChange={(event) => setAngle(event.target.value as AngleOption)}
                >
                  {angleOptions.map((option) => (
                    <option key={option} value={option}>
                      {angleLabels[option]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/generate/generate-form.tsx
git commit -m "feat(generate): tone/angle selectors in form (B1)"
```

---

## Task 5: B2 — Update userId-scoped das variantes

**Files:**
- Modify: `src/features/posts/posts.repository.ts`
- Test: `src/features/posts/__tests__/posts.repository.test.ts`

**Interfaces:**
- Consumes: `GenerateVariant` de `@/infra/llm/types` (já importado no arquivo).
- Produces: `updatePostVariants(userId: string, postId: string, variants: GenerateVariant[])` — `prisma.post.updateMany({ where: { id: postId, userId }, data: { variants } })`. Usa `updateMany` para garantir o escopo por `userId` (o `update` do Prisma só filtra por campo único).

- [ ] **Step 1: Write the failing test**

Acrescentar a `src/features/posts/__tests__/posts.repository.test.ts` (o arquivo já mocka `@/infra/db/prisma`; adicione `updateMany` ao mock do model `post` e um teste). Use este teste:

```typescript
import { updatePostVariants } from "../posts.repository";

describe("updatePostVariants", () => {
  it("atualiza variantes escopado por userId via updateMany", async () => {
    const variants = [{ label: "Direto", content: "novo" }];
    await updatePostVariants("u1", "p1", variants);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (updateMany.mock.calls.at(-1) as [any])[0];
    expect(arg.where).toEqual({ id: "p1", userId: "u1" });
    expect(arg.data.variants).toEqual(variants);
  });
});
```

> Ajuste o bloco `vi.mock("@/infra/db/prisma", ...)` do arquivo para que `prisma.post` exponha também `updateMany: (a) => updateMany(a)` e declare `const updateMany = vi.fn(() => Promise.resolve({ count: 1 }));` junto dos outros `vi.fn()` no topo. Se o arquivo tiver vários testes sem reset, adicione/reuse o `updateMany.mock.calls.at(-1)` (último call) como acima para evitar dependência de índice.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/posts/__tests__/posts.repository.test.ts`
Expected: FAIL — `updatePostVariants` não existe.

- [ ] **Step 3: Implement the repository function**

Adicionar a `src/features/posts/posts.repository.ts`:

```typescript
export async function updatePostVariants(
  userId: string,
  postId: string,
  variants: GenerateVariant[]
) {
  return prisma.post.updateMany({
    where: { id: postId, userId },
    data: { variants },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/posts/__tests__/posts.repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/posts/posts.repository.ts src/features/posts/__tests__/posts.repository.test.ts
git commit -m "feat(posts): updatePostVariants userId-scoped (B2)"
```

---

## Task 6: B2 — Prompt de regeneração de variação única

**Files:**
- Modify: `src/features/generate/generate.prompt.ts`
- Test: `src/features/generate/__tests__/build-prompt.test.ts`

**Interfaces:**
- Consumes: `PositioningProfile` (type), `buildPlatformBlock`, `buildObjectiveBlock`, `buildLengthBlock`, `buildPositioningBlock`, `FORMAT_DESCRIPTIONS`, `getPostCharacterRange`, `GeneratePostFormat` — todos já no arquivo.
- Produces:
  ```typescript
  buildVariantRegenerationPrompt(args: {
    input: { theme: string; format: GeneratePostFormat; platform: Platform; objective: PostObjective; length: PostLength };
    profile: Pick<PositioningProfile, "positioningMemory">;
    cta: string;
    label: string;
    currentContent: string;
  }): string
  ```
  Gera uma **nova versão** da variação `label` (não expansão), respeitando posicionamento, plataforma, objetivo, tamanho e CTA. Retorna instrução para a IA devolver só o texto final.

- [ ] **Step 1: Write the failing test**

Acrescentar a `src/features/generate/__tests__/build-prompt.test.ts`:

```typescript
import { buildVariantRegenerationPrompt } from "../generate.prompt";

describe("buildVariantRegenerationPrompt", () => {
  it("inclui label, posicionamento e CTA, e pede nova versão", () => {
    const prompt = buildVariantRegenerationPrompt({
      input: { theme: "tema", format: "TEXT", platform: "LINKEDIN", objective: "ENSINAR", length: "CURTO" },
      profile: { positioningMemory: "memória do usuário" } as any,
      cta: "Comente aqui",
      label: "Direto",
      currentContent: "texto atual",
    });
    expect(prompt).toContain("Direto");
    expect(prompt).toContain("memória do usuário");
    expect(prompt).toContain("Comente aqui");
    expect(prompt.toLowerCase()).toContain("nova versão");
    expect(prompt).toContain("texto atual");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/generate/__tests__/build-prompt.test.ts`
Expected: FAIL — `buildVariantRegenerationPrompt` não existe.

- [ ] **Step 3: Implement the prompt builder**

Adicionar a `src/features/generate/generate.prompt.ts`:

```typescript
export function buildVariantRegenerationPrompt({
  input,
  profile,
  cta,
  label,
  currentContent,
}: {
  input: {
    theme: string;
    format: GeneratePostFormat;
    platform: Platform;
    objective: PostObjective;
    length: PostLength;
  };
  profile: Pick<PositioningProfile, "positioningMemory">;
  cta: string;
  label: string;
  currentContent: string;
}) {
  const characterRange = getPostCharacterRange(input.platform, input.length);
  return [
    "Você vai gerar uma NOVA VERSÃO de uma única variação, mantendo o label e o ângulo central, mas com texto novo e diferente do atual.",
    `Tema base: ${input.theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[input.format]}`,
    buildPositioningBlock(profile),
    buildPlatformBlock(input.platform),
    buildObjectiveBlock(input.objective),
    buildLengthBlock(input.platform, input.length),
    `Label da variação: ${label}`,
    `Faixa obrigatória: ${characterRange.min}-${characterRange.max} caracteres.`,
    `CTA final obrigatório: ${cta}.`,
    "Mantenha o texto em português, pronto para publicação e fiel ao posicionamento.",
    "Retorne APENAS o texto final da variação, sem JSON, sem comentários e sem título extra.",
    "[VARIACAO_ATUAL]",
    currentContent,
    "[/VARIACAO_ATUAL]",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/generate/__tests__/build-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/generate/generate.prompt.ts src/features/generate/__tests__/build-prompt.test.ts
git commit -m "feat(generate): buildVariantRegenerationPrompt (B2)"
```

---

## Task 7: B2 — Action de regenerar 1 variação

**Files:**
- Create: `src/features/generate/regenerate.actions.ts`
- Test: `src/features/generate/__tests__/regenerate.test.ts`

**Interfaces:**
- Consumes: `getPost`, `updatePostVariants` (Task 5) de `@/features/posts/posts.repository`; `getPositioningProfile` de `@/features/positioning/positioning.repository`; `buildVariantRegenerationPrompt` (Task 6); `getLlmProvider`, `requireUser`; `GenerateVariant` de `@/infra/llm/types`; tipos `Platform/PostObjective/PostLength` de `@/domain/generate`.
- Produces:
  - `replaceVariant(variants: GenerateVariant[], label: string, content: string): GenerateVariant[]` — pura; substitui só o item com `label` correspondente, preserva os demais.
  - `regenerateVariantAction(postId: string, label: string): Promise<RegenerateVariantResult>` onde
    `type RegenerateVariantResult = { ok: true; content: string } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing test (pure helper)**

```typescript
// src/features/generate/__tests__/regenerate.test.ts
import { describe, it, expect } from "vitest";
import { replaceVariant } from "../regenerate.actions";

describe("replaceVariant", () => {
  const variants = [
    { label: "Direto", content: "a" },
    { label: "Técnico", content: "b" },
    { label: "Empático", content: "c" },
  ];

  it("substitui só a variante do label e preserva as outras", () => {
    const out = replaceVariant(variants, "Técnico", "novo");
    expect(out).toEqual([
      { label: "Direto", content: "a" },
      { label: "Técnico", content: "novo" },
      { label: "Empático", content: "c" },
    ]);
  });

  it("não muda nada quando o label não existe", () => {
    const out = replaceVariant(variants, "Inexistente", "novo");
    expect(out).toEqual(variants);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/generate/__tests__/regenerate.test.ts`
Expected: FAIL — módulo/`replaceVariant` não existe.

- [ ] **Step 3: Implement the action module**

```typescript
// src/features/generate/regenerate.actions.ts
"use server";

import { requireUser } from "@/infra/auth/require-user";
import { getLlmProvider } from "@/infra/llm";
import type { LlmRequestOptions } from "@/infra/llm/provider";
import type { GenerateVariant } from "@/infra/llm/types";
import {
  type Platform,
  type PostLength,
  type PostObjective,
} from "@/domain/generate";
import { getPost, updatePostVariants } from "@/features/posts/posts.repository";
import { getPositioningProfile } from "@/features/positioning/positioning.repository";
import { buildVariantRegenerationPrompt } from "./generate.prompt";

export type RegenerateVariantResult =
  | { ok: true; content: string }
  | { ok: false; error: string };

const REGENERATE_REQUEST_OPTIONS: LlmRequestOptions = {
  maxTokens: 1024,
  timeoutMs: 60000,
};

const cleanText = (raw: string) =>
  raw.replace(/```(?:json)?/gi, "").trim();

const safeField = (value: string | undefined | null, fallback: string) =>
  value?.trim() || fallback;

export function replaceVariant(
  variants: GenerateVariant[],
  label: string,
  content: string
): GenerateVariant[] {
  return variants.map((variant) =>
    variant.label === label ? { ...variant, content } : variant
  );
}

export async function regenerateVariantAction(
  postId: string,
  label: string
): Promise<RegenerateVariantResult> {
  try {
    const user = await requireUser();
    const post = await getPost(user.id, postId);
    if (!post) {
      return { ok: false, error: "Post não encontrado." };
    }

    const profile = await getPositioningProfile(user.id);
    if (!profile) {
      return { ok: false, error: "Conclua seu onboarding antes de regenerar." };
    }

    const variants = post.variants as GenerateVariant[];
    const target = variants.find((variant) => variant.label === label);
    if (!target) {
      return { ok: false, error: "Variação não encontrada." };
    }

    const provider = getLlmProvider();
    const cta = safeField(profile.ctaPreference, "CTA respeitosa");
    const prompt = buildVariantRegenerationPrompt({
      input: {
        theme: post.theme,
        format: "TEXT",
        platform: post.platform as Platform,
        objective: post.objective as PostObjective,
        length: post.length as PostLength,
      },
      profile,
      cta,
      label,
      currentContent: target.content,
    });

    const newContent = cleanText(
      await provider.generateText(prompt, REGENERATE_REQUEST_OPTIONS)
    );
    if (!newContent) {
      return { ok: false, error: "A IA não retornou texto. Tente novamente." };
    }

    const newVariants = replaceVariant(variants, label, newContent);
    await updatePostVariants(user.id, postId, newVariants);
    return { ok: true, content: newContent };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao regenerar a variação.";
    return { ok: false, error: message };
  }
}
```

> `format` não é persistido no `Post`, então a regeneração assume `"TEXT"` (default seguro). Tom/ângulo não são persistidos e por isso não entram na regeneração — comportamento `AUTOMATICO`.

- [ ] **Step 4: Run test + type-check**

Run: `npx vitest run src/features/generate/__tests__/regenerate.test.ts`
Expected: PASS (2 testes).
Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/features/generate/regenerate.actions.ts src/features/generate/__tests__/regenerate.test.ts
git commit -m "feat(generate): regenerateVariantAction (B2)"
```

---

## Task 8: B2 — Botão "Regenerar" no variant-card

**Files:**
- Modify: `components/generate/variant-card.tsx`

**Interfaces:**
- Consumes: `regenerateVariantAction` (Task 7).
- Produces: botão "Regenerar" no card que chama `regenerateVariantAction(postId, label)` e, no sucesso, atualiza o texto exibido (`draft`) com a nova variação. Em erro, mostra mensagem curta.

- [ ] **Step 1: Add regenerate wiring to the card**

Em `components/generate/variant-card.tsx`:

1. Importar a action (junto dos outros imports de actions):
```typescript
import { regenerateVariantAction } from "@/features/generate/regenerate.actions";
```

2. Adicionar estado de erro de regeneração (perto dos outros `useState`):
```typescript
  const [regenError, setRegenError] = useState<string | null>(null);
```

3. Adicionar o handler (perto de `saveEdit`):
```typescript
  const regenerate = () =>
    startTransition(async () => {
      setRegenError(null);
      const result = await regenerateVariantAction(postId, label);
      if (result.ok) {
        setDraft(result.content);
        setEditing(false);
      } else {
        setRegenError(result.error);
      }
    });
```

4. Adicionar o botão "Regenerar" na linha de botões do modo não-edição (ao lado de "Editar"):
```tsx
            <Button size="sm" variant="outline" disabled={pending} onClick={regenerate}>Regenerar</Button>
```

5. Renderizar o erro logo abaixo dos botões (antes de fechar o `CardContent`):
```tsx
        {regenError && <p className="text-xs text-destructive">{regenError}</p>}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/generate/variant-card.tsx
git commit -m "feat(generate): regenerate button on variant card (B2)"
```

---

## Task 9: Portões finais do Marco B

**Files:** nenhum (verificação).

- [ ] **Step 1: Suíte de testes**

Run: `npm test`
Expected: todos verdes.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build conclui sem erros.

- [ ] **Step 4: Verificação manual (rota feliz)**

`npm run dev` e validar:
- `/generate`: escolher Tom = Provocador e Ângulo = Contrarian, gerar — saída reflete o tom/ângulo; com ambos Automático, comportamento idêntico ao atual.
- Em um card, clicar "Regenerar" → só aquela variação muda; as outras 5 permanecem; "Copiar" usa o texto regenerado.

- [ ] **Step 5: Commit final (se houver ajustes)**

```bash
git add -A
git commit -m "chore(marco-b): final gates green (tests + tsc + build)"
```

---

## Self-Review

**1. Spec coverage (Marco B):**
- B1 (tom/ângulo por geração, defaults "automático" preservam comportamento, `buildPrompt` injeta bloco quando != automático, sem schema) → Tasks 1–4. ✅
- B2 (botão "Regenerar", action carrega post salvo, reusa prompt de variação única, substitui só aquela variante e persiste, orçamento de variação única) → Tasks 5–8. ✅

**2. Placeholder scan:** Sem TBD/TODO/“add error handling” genérico; todo passo de código mostra o código. ✅

**3. Type consistency:**
- `ToneOption`/`AngleOption` definidos na Task 1, usados em Tasks 2–4.
- `GeneratePromptInput` ganha `tone`/`angle` na Task 2; a action (Task 3) passa `validatedInput` com esses campos; o form (Task 4) envia `tone`/`angle`.
- `updatePostVariants(userId, postId, variants)` definido na Task 5, consumido na Task 7.
- `buildVariantRegenerationPrompt` (Task 6) consumido na Task 7 com a mesma assinatura.
- `replaceVariant`/`regenerateVariantAction`/`RegenerateVariantResult` (Task 7) consumidos na Task 8. ✅

**Observação:** o teste de `build-prompt.test.ts` ganha objetos `base` com `tone`/`angle` (Task 2) porque `GeneratePromptInput` passa a exigi-los — os testes do Marco A que chamam `buildPrompt` sem tom/ângulo precisam receber os dois campos. Os testes do Marco A de `buildPrompt` few-shot usam um `input` literal; ao rodar a Task 2, atualize esses literais para incluir `tone: "AUTOMATICO", angle: "AUTOMATICO"` (já refletido nos novos casos). Sinalizar ao implementador da Task 2 que ajuste os literais existentes de `buildPrompt` no mesmo arquivo para compilar.
