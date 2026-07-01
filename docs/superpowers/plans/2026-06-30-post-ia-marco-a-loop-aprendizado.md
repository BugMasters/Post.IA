# Post.IA Marco A — Loop de aprendizado (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o loop "feedback → memória melhor" dando ao usuário controle direto do posicionamento, edição inline de variações (vira feedback `edited`) e few-shot dos exemplos que funcionaram na geração.

**Architecture:** Mantém a arquitetura existente — `src/domain` (schemas Zod), `src/features/<feature>` (repository + actions + prompts), `src/infra` (auth/db/llm), App Router no grupo `app/(app)`. Toda query nova é escopada por `userId`. Marco A **não** muda o schema do banco (usa colunas existentes `PostFeedback.editedContent`/`note` e `Post.variants`). Few-shot é contexto adicional de geração e nunca substitui `positioningMemory`.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript, Prisma 6 (PostgreSQL), Zod 4, Vitest, next-auth 5 beta. Provider LLM via `getLlmProvider()`.

## Global Constraints

- Multi-tenant: toda query nova escopada por `userId` (`findFirst`/`findMany`/`where` com `userId`). Nunca confiar em id vindo do client sem escopo.
- Usuário corrente sempre via `requireUser()` de `@/infra/auth/require-user` (nunca receber `userId` como argumento de action exposta ao client).
- LLM via `getLlmProvider()`; thinking off; budgets atuais (não criar chamadas novas no Marco A).
- Resiliência: falha de IA nunca corrompe memória nem perde post salvo. Few-shot vazio → geração normal (sem bloco).
- Few-shot limitado a `N=3` exemplos, com teto de caracteres por exemplo para não estourar tokens.
- Server Actions começam com `"use server";`. Após mutação que afeta página renderizada no servidor, chamar `revalidatePath`.
- Validação com Zod nos mesmos limites do `positioningSeedSchema` (em `src/domain/onboarding.ts`).
- Testes: `npm test` (vitest) deve ficar verde; o projeto roda `npx tsc --noEmit` e `npm run build` como portões finais.
- Mensagens de UI e copy em português (pt-BR), com acentuação correta.
- Branch de trabalho: `feat/copiloto-posicionamento`.

---

## File Structure

**A1 — Editar posicionamento manualmente**
- Modify `src/domain/onboarding.ts` — adicionar `positioningPatchSchema` (patch parcial) + tipo.
- Modify `src/features/positioning/positioning.repository.ts` — adicionar `updatePositioningProfile(userId, patch)`.
- Create `src/features/positioning/positioning.actions.ts` — `updatePositioningProfileAction(patch)`.
- Create `components/positioning/positioning-editor.tsx` — form client de edição.
- Modify `app/(app)/posicionamento/page.tsx` — renderizar o editor com valores atuais.
- Test `src/features/positioning/__tests__/positioning.repository.test.ts`.
- Test `src/domain/__tests__/positioning-patch.test.ts`.

**A2 — Editar variação inline**
- Modify `components/generate/variant-card.tsx` — modo edição (textarea), salvar → feedback `edited`, copiar usa texto editado corrente.

**A3 — Few-shot dos exemplos que funcionaram**
- Modify `src/features/feedback/feedback.repository.ts` — adicionar `listPositiveExamples(userId, limit)`.
- Modify `src/features/generate/generate.prompt.ts` — adicionar `buildFewShotBlock(examples)` e injetar em `buildPrompt`.
- Modify `src/features/generate/generate.actions.ts` — buscar exemplos e passar a `buildPrompt`.
- Test `src/features/feedback/__tests__/positive-examples.test.ts`.
- Test `src/features/generate/__tests__/build-prompt.test.ts` (acrescentar casos do few-shot).

---

## Task 1: A1 — Schema de patch do posicionamento

**Files:**
- Modify: `src/domain/onboarding.ts`
- Test: `src/domain/__tests__/positioning-patch.test.ts`

**Interfaces:**
- Consumes: `positioningSeedSchema` (já existe em `src/domain/onboarding.ts`).
- Produces: `positioningPatchSchema` (Zod) e `type PositioningPatch`. Patch parcial: todos os campos opcionais; quando `positioningMemory` vem presente, deve ter `min(1)`; demais campos seguem os limites do seed (string). O objeto vazio `{}` é inválido (pelo menos 1 campo).

- [ ] **Step 1: Write the failing test**

```typescript
// src/domain/__tests__/positioning-patch.test.ts
import { describe, it, expect } from "vitest";
import { positioningPatchSchema } from "../onboarding";

describe("positioningPatchSchema", () => {
  it("aceita patch parcial com um campo", () => {
    const parsed = positioningPatchSchema.parse({ niche: "Dev backend" });
    expect(parsed.niche).toBe("Dev backend");
  });

  it("aceita patch só com positioningMemory", () => {
    const parsed = positioningPatchSchema.parse({ positioningMemory: "Nova memória" });
    expect(parsed.positioningMemory).toBe("Nova memória");
  });

  it("rejeita positioningMemory vazia quando presente", () => {
    expect(() => positioningPatchSchema.parse({ positioningMemory: "" })).toThrow();
  });

  it("rejeita patch vazio", () => {
    expect(() => positioningPatchSchema.parse({})).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/__tests__/positioning-patch.test.ts`
Expected: FAIL — `positioningPatchSchema` não exportado.

- [ ] **Step 3: Implement the schema**

Adicionar ao final de `src/domain/onboarding.ts`:

```typescript
export const positioningPatchSchema = z
  .object({
    niche: z.string(),
    audience: z.string(),
    offer: z.string(),
    differentiation: z.string(),
    tonePreference: z.string(),
    ctaPreference: z.string(),
    positioningMemory: z.string().min(1, "A memória não pode ficar vazia."),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });
export type PositioningPatch = z.infer<typeof positioningPatchSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/__tests__/positioning-patch.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/domain/onboarding.ts src/domain/__tests__/positioning-patch.test.ts
git commit -m "feat(positioning): add positioningPatchSchema for manual edits"
```

---

## Task 2: A1 — Repository update parcial do perfil

**Files:**
- Modify: `src/features/positioning/positioning.repository.ts`
- Test: `src/features/positioning/__tests__/positioning.repository.test.ts`

**Interfaces:**
- Consumes: `PositioningPatch` (Task 1).
- Produces: `updatePositioningProfile(userId: string, patch: PositioningPatch)` — chama `prisma.positioningProfile.update({ where: { userId }, data: patch })`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/positioning/__tests__/positioning.repository.test.ts
import { describe, it, expect, vi } from "vitest";

const update = vi.fn((_a: unknown) => Promise.resolve({ id: "pp1" }));
vi.mock("@/infra/db/prisma", () => ({
  prisma: { positioningProfile: { update: (a: unknown) => update(a) } },
}));

import { updatePositioningProfile } from "../positioning.repository";

describe("updatePositioningProfile", () => {
  it("aplica patch parcial escopado por userId", async () => {
    await updatePositioningProfile("u1", { niche: "Dev backend" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (update.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.data).toEqual({ niche: "Dev backend" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/positioning/__tests__/positioning.repository.test.ts`
Expected: FAIL — `updatePositioningProfile` não existe.

- [ ] **Step 3: Implement the repository function**

Adicionar a `src/features/positioning/positioning.repository.ts` (importar o tipo no topo):

```typescript
import type { PositioningPatch } from "@/domain/onboarding";
```

```typescript
export async function updatePositioningProfile(userId: string, patch: PositioningPatch) {
  return prisma.positioningProfile.update({
    where: { userId },
    data: patch,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/positioning/__tests__/positioning.repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/positioning/positioning.repository.ts src/features/positioning/__tests__/positioning.repository.test.ts
git commit -m "feat(positioning): add updatePositioningProfile partial update"
```

---

## Task 3: A1 — Server action de edição do posicionamento

**Files:**
- Create: `src/features/positioning/positioning.actions.ts`
- Test: nenhum unitário dedicado (action fina: valida + repo + revalidate; coberta por Task 1/2 + verificação manual). Type-check cobre a integração.

**Interfaces:**
- Consumes: `positioningPatchSchema` (Task 1), `updatePositioningProfile` (Task 2), `requireUser`, `revalidatePath`.
- Produces: `updatePositioningProfileAction(patch: unknown): Promise<UpdatePositioningResult>` onde
  `type UpdatePositioningResult = { ok: true } | { ok: false; error: string }`.

- [ ] **Step 1: Create the action**

```typescript
// src/features/positioning/positioning.actions.ts
"use server";

import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/infra/auth/require-user";
import { positioningPatchSchema } from "@/domain/onboarding";
import { updatePositioningProfile } from "./positioning.repository";

export type UpdatePositioningResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updatePositioningProfileAction(
  patch: unknown
): Promise<UpdatePositioningResult> {
  try {
    const parsed = positioningPatchSchema.parse(patch);
    const user = await requireUser();
    await updatePositioningProfile(user.id, parsed);
    revalidatePath("/posicionamento");
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    const message = error instanceof Error ? error.message : "Erro ao salvar posicionamento.";
    return { ok: false, error: message };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/features/positioning/positioning.actions.ts
git commit -m "feat(positioning): add updatePositioningProfileAction"
```

---

## Task 4: A1 — Editor de posicionamento na UI

**Files:**
- Create: `components/positioning/positioning-editor.tsx`
- Modify: `app/(app)/posicionamento/page.tsx`

**Interfaces:**
- Consumes: `updatePositioningProfileAction` (Task 3), tipo `PositioningProfile` de `@/generated/prisma`, componentes UI existentes (`Button`, `Card*`, `Input`, `Label`, `Textarea`).
- Produces: `PositioningEditor` (default export) — recebe `profile` com os 7 campos e expõe form de edição.

- [ ] **Step 1: Create the client editor component**

```tsx
// components/positioning/positioning-editor.tsx
"use client";

import { useState, useTransition } from "react";
import { updatePositioningProfileAction } from "@/features/positioning/positioning.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EditableProfile = {
  niche: string;
  audience: string;
  offer: string;
  differentiation: string;
  tonePreference: string;
  ctaPreference: string;
  positioningMemory: string;
};

const FIELD_LABELS: Record<keyof EditableProfile, string> = {
  niche: "Nicho",
  audience: "Público",
  offer: "Oferta",
  differentiation: "Diferenciação",
  tonePreference: "Tom preferido",
  ctaPreference: "CTA preferida",
  positioningMemory: "Memória viva",
};

export default function PositioningEditor({ profile }: { profile: EditableProfile }) {
  const [form, setForm] = useState<EditableProfile>(profile);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const setField = (key: keyof EditableProfile, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () =>
    startTransition(async () => {
      setError(null);
      const result = await updatePositioningProfileAction(form);
      if (result.ok) {
        setSaved(true);
      } else {
        setError(result.error);
      }
    });

  const shortFields: (keyof EditableProfile)[] = [
    "niche",
    "audience",
    "offer",
    "differentiation",
    "tonePreference",
    "ctaPreference",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Editar posicionamento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {shortFields.map((key) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={key}>{FIELD_LABELS[key]}</Label>
            <Input
              id={key}
              value={form[key]}
              onChange={(event) => setField(key, event.target.value)}
            />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor="positioningMemory">{FIELD_LABELS.positioningMemory}</Label>
          <Textarea
            id="positioningMemory"
            rows={8}
            value={form.positioningMemory}
            onChange={(event) => setField("positioningMemory", event.target.value)}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {saved && <p className="text-xs text-muted-foreground">Salvo.</p>}
        <Button disabled={pending} onClick={handleSave}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Wire the editor into the page**

Substituir o corpo de retorno "com perfil" em `app/(app)/posicionamento/page.tsx` para incluir o editor (manter o card "Memória viva" como leitura rápida, adicionar o editor abaixo). Importar no topo:

```tsx
import PositioningEditor from "@/components/positioning/positioning-editor";
```

Bloco de retorno com perfil:

```tsx
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Seu posicionamento</h1>
      <PositioningEditor
        profile={{
          niche: profile.niche,
          audience: profile.audience,
          offer: profile.offer,
          differentiation: profile.differentiation,
          tonePreference: profile.tonePreference,
          ctaPreference: profile.ctaPreference,
          positioningMemory: profile.positioningMemory,
        }}
      />
      <p className="text-xs text-muted-foreground">
        A memória também atualiza sozinha conforme você dá feedback nos posts.
      </p>
    </main>
  );
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add components/positioning/positioning-editor.tsx "app/(app)/posicionamento/page.tsx"
git commit -m "feat(positioning): manual editor on /posicionamento (A1)"
```

---

## Task 5: A2 — Editar variação inline antes de copiar

**Files:**
- Modify: `components/generate/variant-card.tsx`

**Interfaces:**
- Consumes: `submitFeedbackAction` (já existe; aceita `signal: "edited"` + `editedContent`), `relearnPositioningAction`, `Textarea`.
- Produces: comportamento — variant-card mantém um `draft` editável; "Copiar" usa o `draft` corrente; "Salvar edição" envia feedback `signal="edited"` com `editedContent=draft`.

- [ ] **Step 1: Rewrite variant-card with inline edit**

```tsx
// components/generate/variant-card.tsx
"use client";

import { useState, useTransition } from "react";
import { submitFeedbackAction } from "@/features/feedback/feedback.actions";
import { relearnPositioningAction } from "@/features/positioning/relearn.actions";
import type { FeedbackSignal } from "@/domain/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export default function VariantCard({
  postId,
  label,
  content,
}: {
  postId: string;
  label: string;
  content: string;
}) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState<FeedbackSignal | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  const react = (signal: FeedbackSignal) =>
    startTransition(async () => {
      const result = await submitFeedbackAction({ postId, variantLabel: label, signal });
      if (result.ok) {
        setSent(signal);
        if (result.shouldRelearn) await relearnPositioningAction();
      }
    });

  const saveEdit = () =>
    startTransition(async () => {
      const result = await submitFeedbackAction({
        postId,
        variantLabel: label,
        signal: "edited",
        editedContent: draft,
      });
      if (result.ok) {
        setSent("edited");
        setEditing(false);
        if (result.shouldRelearn) await relearnPositioningAction();
      }
    });

  const handleCopyClick = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{label}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <Textarea
            rows={8}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{draft}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={handleCopyClick}>{copied ? "Copiado" : "Copiar"}</Button>
          {editing ? (
            <>
              <Button size="sm" disabled={pending} onClick={saveEdit}>Salvar edição</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => { setDraft(content); setEditing(false); }}>Cancelar</Button>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(true)}>Editar</Button>
          )}
          <Button size="sm" variant={sent === "liked" ? "default" : "outline"} disabled={pending} onClick={() => react("liked")}>👍</Button>
          <Button size="sm" variant={sent === "disliked" ? "default" : "outline"} disabled={pending} onClick={() => react("disliked")}>👎</Button>
          <Button size="sm" variant={sent === "more_like_this" ? "default" : "outline"} disabled={pending} onClick={() => react("more_like_this")}>Mais assim</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/generate/variant-card.tsx
git commit -m "feat(generate): inline edit on variant card -> feedback edited (A2)"
```

---

## Task 6: A3 — Repository de exemplos positivos

**Files:**
- Modify: `src/features/feedback/feedback.repository.ts`
- Test: `src/features/feedback/__tests__/positive-examples.test.ts`

**Interfaces:**
- Consumes: `prisma.postFeedback.findMany` com `include: { post: true }`.
- Produces: `listPositiveExamples(userId: string, limit: number): Promise<PositiveExample[]>` onde
  `type PositiveExample = { label: string; content: string }`.
  Regras: considera apenas `signal` em `["more_like_this", "edited", "liked"]`; prioridade `more_like_this` > `edited` > `liked`, desempate por `createdAt` desc; retorna no máximo `limit` itens; `content` = `editedContent` quando presente (caso `edited`), senão o `content` da variante do post cujo `label` casa com `variantLabel`; ignora itens sem conteúdo resolvível.

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/feedback/__tests__/positive-examples.test.ts
import { describe, it, expect, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@/infra/db/prisma", () => ({
  prisma: { postFeedback: { findMany: (a: unknown) => findMany(a) } },
}));

import { listPositiveExamples } from "../feedback.repository";

const post = (variants: { label: string; content: string }[]) => ({
  variants,
});

describe("listPositiveExamples", () => {
  it("prioriza more_like_this > edited > liked e respeita o limite", async () => {
    findMany.mockResolvedValueOnce([
      { signal: "liked", variantLabel: "Direto", editedContent: null, createdAt: new Date("2026-06-01"), post: post([{ label: "Direto", content: "conteúdo liked" }]) },
      { signal: "more_like_this", variantLabel: "Storytelling", editedContent: null, createdAt: new Date("2026-06-02"), post: post([{ label: "Storytelling", content: "conteúdo mlt" }]) },
      { signal: "edited", variantLabel: "Técnico", editedContent: "texto editado", createdAt: new Date("2026-06-03"), post: post([{ label: "Técnico", content: "original" }]) },
    ]);

    const result = await listPositiveExamples("u1", 2);

    expect(result).toEqual([
      { label: "Storytelling", content: "conteúdo mlt" },
      { label: "Técnico", content: "texto editado" },
    ]);
  });

  it("escopa por userId e signals positivos", async () => {
    findMany.mockResolvedValueOnce([]);
    await listPositiveExamples("u1", 3);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (findMany.mock.calls[0] as [any])[0];
    expect(arg.where.userId).toBe("u1");
    expect(arg.where.signal.in).toEqual(["more_like_this", "edited", "liked"]);
    expect(arg.include).toEqual({ post: true });
  });

  it("ignora feedback sem conteúdo resolvível", async () => {
    findMany.mockResolvedValueOnce([
      { signal: "liked", variantLabel: "Inexistente", editedContent: null, createdAt: new Date("2026-06-01"), post: post([{ label: "Direto", content: "x" }]) },
    ]);
    const result = await listPositiveExamples("u1", 3);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/feedback/__tests__/positive-examples.test.ts`
Expected: FAIL — `listPositiveExamples` não existe.

- [ ] **Step 3: Implement listPositiveExamples**

Adicionar a `src/features/feedback/feedback.repository.ts`:

```typescript
export type PositiveExample = { label: string; content: string };

const POSITIVE_SIGNALS = ["more_like_this", "edited", "liked"] as const;
const SIGNAL_RANK: Record<string, number> = {
  more_like_this: 0,
  edited: 1,
  liked: 2,
};

export async function listPositiveExamples(
  userId: string,
  limit: number
): Promise<PositiveExample[]> {
  const rows = await prisma.postFeedback.findMany({
    where: { userId, signal: { in: [...POSITIVE_SIGNALS] } },
    include: { post: true },
    orderBy: { createdAt: "desc" },
  });

  const ranked = [...rows].sort((a, b) => {
    const rank = (SIGNAL_RANK[a.signal] ?? 99) - (SIGNAL_RANK[b.signal] ?? 99);
    if (rank !== 0) return rank;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const examples: PositiveExample[] = [];
  for (const row of ranked) {
    if (examples.length >= limit) break;
    const content = resolveExampleContent(row);
    if (content) examples.push({ label: row.variantLabel, content });
  }
  return examples;
}

type FeedbackWithPost = {
  signal: string;
  variantLabel: string;
  editedContent: string | null;
  post: { variants: unknown };
};

function resolveExampleContent(row: FeedbackWithPost): string | null {
  if (row.signal === "edited" && row.editedContent?.trim()) {
    return row.editedContent.trim();
  }
  const variants = row.post?.variants;
  if (Array.isArray(variants)) {
    const match = variants.find(
      (v): v is { label: string; content: string } =>
        typeof v === "object" &&
        v !== null &&
        (v as { label?: unknown }).label === row.variantLabel &&
        typeof (v as { content?: unknown }).content === "string"
    );
    if (match && match.content.trim()) return match.content.trim();
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/feedback/__tests__/positive-examples.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/features/feedback/feedback.repository.ts src/features/feedback/__tests__/positive-examples.test.ts
git commit -m "feat(feedback): listPositiveExamples for few-shot (A3)"
```

---

## Task 7: A3 — Bloco few-shot no prompt

**Files:**
- Modify: `src/features/generate/generate.prompt.ts`
- Test: `src/features/generate/__tests__/build-prompt.test.ts`

**Interfaces:**
- Consumes: `PositiveExample` de `@/features/feedback/feedback.repository` (Task 6).
- Produces:
  - `buildFewShotBlock(examples: PositiveExample[]): string` — string vazia `""` se `examples` vazio; senão bloco `[EXEMPLOS_NA_VOZ_DO_USUARIO] ... [/EXEMPLOS_NA_VOZ_DO_USUARIO]`, cada exemplo truncado a `FEW_SHOT_CHAR_CAP = 500` caracteres.
  - `buildPrompt(input, profile, examples?: PositiveExample[])` — quando `examples` não vazio, injeta o bloco logo após `buildPositioningBlock`. Few-shot é contexto, não substitui o posicionamento.

- [ ] **Step 1: Add failing tests**

Acrescentar a `src/features/generate/__tests__/build-prompt.test.ts`:

```typescript
import { buildFewShotBlock, buildPrompt } from "../generate.prompt";

describe("buildFewShotBlock", () => {
  it("retorna vazio sem exemplos", () => {
    expect(buildFewShotBlock([])).toBe("");
  });

  it("inclui os exemplos na voz do usuário", () => {
    const block = buildFewShotBlock([{ label: "Direto", content: "Texto que funcionou." }]);
    expect(block).toContain("EXEMPLOS_NA_VOZ_DO_USUARIO");
    expect(block).toContain("Texto que funcionou.");
  });

  it("trunca exemplos longos", () => {
    const long = "a".repeat(900);
    const block = buildFewShotBlock([{ label: "Direto", content: long }]);
    expect(block.length).toBeLessThan(long.length);
  });
});

describe("buildPrompt few-shot", () => {
  const input = {
    theme: "tema",
    format: "TEXT" as const,
    platform: "LINKEDIN" as const,
    objective: "ENSINAR" as const,
    length: "CURTO" as const,
  };
  const profile = { positioningMemory: "memória", ctaPreference: "Comente" } as any;

  it("injeta bloco quando há exemplos", () => {
    const prompt = buildPrompt(input, profile, [{ label: "Direto", content: "Exemplo bom." }]);
    expect(prompt).toContain("EXEMPLOS_NA_VOZ_DO_USUARIO");
  });

  it("não injeta bloco sem exemplos", () => {
    const prompt = buildPrompt(input, profile, []);
    expect(prompt).not.toContain("EXEMPLOS_NA_VOZ_DO_USUARIO");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/generate/__tests__/build-prompt.test.ts`
Expected: FAIL — `buildFewShotBlock` não existe / `buildPrompt` não aceita 3º argumento.

- [ ] **Step 3: Implement buildFewShotBlock and extend buildPrompt**

Em `src/features/generate/generate.prompt.ts`, importar o tipo no topo:

```typescript
import type { PositiveExample } from "@/features/feedback/feedback.repository";
```

Adicionar antes de `buildPrompt`:

```typescript
export const FEW_SHOT_CHAR_CAP = 500;

export function buildFewShotBlock(examples: PositiveExample[]) {
  if (examples.length === 0) return "";
  const lines = examples.map((ex, index) => {
    const text = ex.content.length > FEW_SHOT_CHAR_CAP
      ? `${ex.content.slice(0, FEW_SHOT_CHAR_CAP)}…`
      : ex.content;
    return `Exemplo ${index + 1} (${ex.label}):\n${text}`;
  });
  return [
    "[EXEMPLOS_NA_VOZ_DO_USUARIO]",
    "Use o estilo e a voz destes textos que o usuário aprovou ou editou. Não copie o conteúdo, apenas a voz.",
    ...lines,
    "[/EXEMPLOS_NA_VOZ_DO_USUARIO]",
  ].join("\n");
}
```

Alterar a assinatura e o corpo de `buildPrompt` para aceitar exemplos opcionais e injetar o bloco após o posicionamento:

```typescript
export const buildPrompt = (
  input: GeneratePromptInput,
  profile: Pick<PositioningProfile, "positioningMemory" | "ctaPreference">,
  examples: PositiveExample[] = []
) => {
  const cta = safeField(profile.ctaPreference, "CTA respeitosa");
  const characterRange = getPostCharacterRange(input.platform, input.length);

  const avoidSummary = BASE_AVOIDANCES.join(", ");
  const fewShotBlock = buildFewShotBlock(examples);

  return [
    "Você é um redator experiente focado em redes sociais B2B/B2C.",
    "Use apenas os dados abaixo como contexto e não repita os nomes dos campos do posicionamento nos textos finais.",
    `Tema base: ${input.theme}`,
    `Formato solicitado: ${FORMAT_DESCRIPTIONS[input.format]}`,
    buildPositioningBlock(profile),
    fewShotBlock,
    buildPlatformBlock(input.platform),
    buildObjectiveBlock(input.objective),
    buildLengthBlock(input.platform, input.length),
    `Evite: ${avoidSummary}.`,
    `Labels exigidos: ${EXPECTED_VARIANT_LABELS.join(", ")}. Mantenha essa ordem.`,
    'Retorne APENAS JSON válido com estrutura { "variants": [ { "label": "...", "content": "..." }, ... ] }.',
    `Cada post deve ser em português, pronto para publicação, e ficar preferencialmente entre ${characterRange.min} e ${characterRange.max} caracteres.`,
    "Respeite as regras de plataforma, objetivo e tamanho descritas nos blocos acima.",
    `A última linha deve repetir exatamente o CTA sugerido: ${cta}.`,
    'Não invente dados, não use clichês como "transforme sua vida" ou "ninguém te conta", nem jargões, textão, coach vibes, polêmica ou CTA agressivo.',
    "O conteúdo deve evitar mencionar diretamente os campos do posicionamento e não pode trazer claims não fornecidas.",
    "O gancho, a estrutura e o CTA não podem usar clichês ou figuras de autoridade exageradas.",
  ]
    .filter(Boolean)
    .join("\n");
};
```

> Nota: o `.filter(Boolean)` já remove o `fewShotBlock` quando ele é `""`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/generate/__tests__/build-prompt.test.ts`
Expected: PASS (todos, incluindo os 2 originais de `buildPositioningBlock`).

- [ ] **Step 5: Commit**

```bash
git add src/features/generate/generate.prompt.ts src/features/generate/__tests__/build-prompt.test.ts
git commit -m "feat(generate): few-shot block in buildPrompt (A3)"
```

---

## Task 8: A3 — Buscar exemplos na geração

**Files:**
- Modify: `src/features/generate/generate.actions.ts`

**Interfaces:**
- Consumes: `listPositiveExamples` (Task 6), `buildPrompt` com 3º argumento (Task 7).
- Produces: `generatePostsAction` passa até `FEW_SHOT_LIMIT = 3` exemplos do usuário a `buildPrompt`. Falha ao buscar exemplos **não** quebra a geração (fallback para `[]`).

- [ ] **Step 1: Import and fetch examples**

Em `src/features/generate/generate.actions.ts`, adicionar import:

```typescript
import { listPositiveExamples } from "@/features/feedback/feedback.repository";
```

Adicionar constante perto dos outros budgets:

```typescript
const FEW_SHOT_LIMIT = 3;
```

Após obter `profile` (logo antes de `const provider = getLlmProvider();`), buscar exemplos com fallback resiliente:

```typescript
  let examples: Awaited<ReturnType<typeof listPositiveExamples>> = [];
  try {
    examples = await listPositiveExamples(user.id, FEW_SHOT_LIMIT);
  } catch (error) {
    console.error("[generatePostsAction] falha ao buscar exemplos few-shot:", error);
  }
```

Alterar a construção do prompt para incluir os exemplos:

```typescript
  const prompt = buildPrompt(validatedInput, profile, examples);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: PASS (toda a suíte).

- [ ] **Step 4: Commit**

```bash
git add src/features/generate/generate.actions.ts
git commit -m "feat(generate): feed few-shot examples into generation (A3)"
```

---

## Task 9: Portões finais do Marco A

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

Run: `npm run dev` e validar:
- `/posicionamento`: editar um campo + memória, salvar, recarregar → persistiu.
- `/generate`: gerar, editar uma variação inline, "Salvar edição" (vira feedback `edited`), "Copiar" usa o texto editado.
- Após ≥3 feedbacks, gerar de novo e confirmar nos logs/saída que o bloco `EXEMPLOS_NA_VOZ_DO_USUARIO` aparece quando há exemplos.

- [ ] **Step 5: Commit final (se houver ajustes)**

```bash
git add -A
git commit -m "chore(marco-a): final gates green (tests + tsc + build)"
```

---

## Self-Review

**1. Spec coverage (Marco A):**
- A1 (editar posicionamento/memória) → Tasks 1–4 (schema, repo, action, UI). ✅ Origem `manual` como "versão" fica para o Marco C (C2 cria `PositioningMemoryVersion`); o spec lista versionamento em C, então não é gap do Marco A.
- A2 (editar variação inline → feedback `edited`, copiar usa texto editado) → Task 5. ✅
- A3 (few-shot `more_like_this` > `edited` > `liked`, repo + bloco no prompt + uso na geração, teto de tokens, few-shot vazio → normal) → Tasks 6–8. ✅

**2. Placeholder scan:** Sem TBD/TODO/"add error handling" genérico; todo passo de código mostra o código. ✅

**3. Type consistency:** `PositioningPatch` (Task 1) usado em Tasks 2–3. `PositiveExample` definido em Task 6, consumido em Tasks 7–8. `buildPrompt` ganha 3º arg opcional em Task 7 e é chamado com ele em Task 8 (compatível com chamadas existentes). `updatePositioningProfileAction`/`UpdatePositioningResult` consistentes entre Tasks 3 e 4. ✅

**Observação de escopo:** O spec diz que a edição manual "conta como versão (ver A3)" — mas o model `PositioningMemoryVersion` é criado só no Marco C2. Este plano cobre A1–A3 do Marco A; o versionamento da edição manual entra junto do C2. Sinalizar ao executar para não duplicar.
