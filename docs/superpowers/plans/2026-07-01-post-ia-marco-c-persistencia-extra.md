# Post.IA Marco C — Persistência extra (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar persistência extra ao co-piloto — rascunhos salvos (C1) e histórico/versão da memória de posicionamento com reverter (C2).

**Architecture:** Segue a arquitetura existente (`src/domain` Zod, `src/features/<feature>` repository+actions, `src/infra`, App Router grupo `app/(app)`). Marco C é o **único** com mudança de schema: dois models novos (`Draft`, `PositioningMemoryVersion`), aplicados via uma migration Prisma. C1 é CRUD userId-scoped de rascunhos. C2 versiona **toda** escrita de `positioningMemory` (onboarding, relearn, edição manual) e permite reverter criando uma nova versão — nunca destrói.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript, Prisma 6 (PostgreSQL local em localhost:5432), Zod 4, Vitest.

## Global Constraints

- Multi-tenant: toda query nova escopada por `userId`; `userId` sempre via `requireUser()`, nunca do client.
- Migrations: gerar via `npx prisma migrate dev --name <nome>` (DB local acessível e up-to-date). O comando aplica o SQL e regenera o client em `src/generated/prisma`. Commitar schema + pasta de migration + client regenerado.
- Reverter memória **cria nova versão** a partir de uma antiga — nunca apaga versões (`source = "manual"`).
- Toda escrita de `positioningMemory` grava uma versão: onboarding (`source "onboarding"`), relearn (`source "relearn"`), edição manual (`source "manual"`).
- Resiliência: falha ao gravar versão não pode impedir a escrita principal da memória nem corromper dados. Versionamento é efeito colateral após a escrita bem-sucedida.
- Server Actions começam com `"use server";`. pt-BR com acentuação correta.
- Testes: `npm test` (vitest) verde; `npx tsc --noEmit` limpo; `npm run build` OK. Repositórios são testados com o mock de `@/infra/db/prisma` já usado no projeto.
- Branch de trabalho: `feat/copiloto-posicionamento`.

---

## File Structure

**Schema/migration (base de C1 + C2)**
- Modify `prisma/schema.prisma` — models `Draft` e `PositioningMemoryVersion` + relações em `User`.
- Create `prisma/migrations/<timestamp>_add_drafts_and_memory_versions/migration.sql` (gerado por `migrate dev`).

**C1 — Rascunhos**
- Create `src/domain/draft.ts` — `draftInputSchema` + tipo.
- Create `src/features/drafts/draft.repository.ts` — `createDraft`, `listDrafts`, `deleteDraft`.
- Create `src/features/drafts/draft.actions.ts` — `createDraftAction`, `deleteDraftAction`.
- Create `components/drafts/draft-list.tsx` — lista client com copiar/excluir.
- Create `app/(app)/rascunhos/page.tsx` — página server que lista.
- Modify `components/generate/variant-card.tsx` — botão "Salvar rascunho".
- Test `src/domain/__tests__/draft.test.ts`, `src/features/drafts/__tests__/draft.repository.test.ts`.

**C2 — Histórico/versão da memória**
- Create `src/domain/memory-version.ts` — `memorySourceSchema` + tipo.
- Create `src/features/positioning/memory-version.repository.ts` — `recordMemoryVersion`, `listMemoryVersions`, `getMemoryVersion`.
- Modify `src/features/onboarding/onboarding.actions.ts` — grava versão `onboarding`.
- Modify `src/features/positioning/relearn.actions.ts` — grava versão `relearn`.
- Modify `src/features/positioning/positioning.actions.ts` — grava versão `manual` quando a memória muda.
- Create `src/features/positioning/memory-version.actions.ts` — `revertMemoryVersionAction`.
- Create `components/positioning/memory-history.tsx` — histórico client com reverter.
- Modify `app/(app)/posicionamento/page.tsx` — renderiza o histórico.
- Test `src/domain/__tests__/memory-version.test.ts`, `src/features/positioning/__tests__/memory-version.repository.test.ts`.

---

## Task 1: Schema + migration dos models novos

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_drafts_and_memory_versions/migration.sql` (via CLI)

**Interfaces:**
- Produces: models Prisma `Draft` e `PositioningMemoryVersion` (client regenerado em `src/generated/prisma`), consumidos por todos os repositórios de C1/C2.

- [ ] **Step 1: Add the models to the schema**

Em `prisma/schema.prisma`, adicionar às relações do model `User` (dentro do bloco `model User { ... }`, junto de `posts`/`feedbacks`):

```prisma
  drafts         Draft[]
  memoryVersions PositioningMemoryVersion[]
```

E adicionar os dois models no fim do arquivo:

```prisma
model Draft {
  id        String   @id @default(cuid())
  userId    String
  postId    String?
  label     String
  content   String
  theme     String?
  platform  String?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model PositioningMemoryVersion {
  id        String   @id @default(cuid())
  userId    String
  memory    String
  source    String
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
}
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_drafts_and_memory_versions`
Expected: cria `prisma/migrations/<timestamp>_add_drafts_and_memory_versions/migration.sql`, aplica ao banco local, e regenera o client. Saída termina com algo como "Your database is now in sync with your schema." e "Generated Prisma Client".

> Se o comando reclamar de ambiente não-interativo ou drift, usar o fallback do histórico do projeto:
> `npx prisma migrate dev --name add_drafts_and_memory_versions --create-only` seguido de `npx prisma migrate deploy` e `npx prisma generate`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros (o client regenerado já expõe `prisma.draft` e `prisma.positioningMemoryVersion`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/generated/prisma
git commit -m "feat(db): add Draft and PositioningMemoryVersion models (C)"
```

---

## Task 2: C1 — Schema de rascunho no domínio

**Files:**
- Create: `src/domain/draft.ts`
- Test: `src/domain/__tests__/draft.test.ts`

**Interfaces:**
- Produces:
  - `draftInputSchema` (Zod): `{ postId?: string; label: string(min1,max80); content: string(min1); theme?: string(max200); platform?: string(max40) }`.
  - `type DraftInput = z.infer<typeof draftInputSchema>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/domain/__tests__/draft.test.ts
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { draftInputSchema } from "../draft";

describe("draftInputSchema", () => {
  it("aceita um rascunho mínimo (label + content)", () => {
    const parsed = draftInputSchema.parse({ label: "Direto", content: "Texto do post." });
    expect(parsed.label).toBe("Direto");
    expect(parsed.content).toBe("Texto do post.");
  });

  it("aceita campos opcionais", () => {
    const parsed = draftInputSchema.parse({
      label: "Direto",
      content: "Texto",
      postId: "p1",
      theme: "marca pessoal",
      platform: "LINKEDIN",
    });
    expect(parsed.postId).toBe("p1");
  });

  it("rejeita content vazio", () => {
    expect(() => draftInputSchema.parse({ label: "Direto", content: "" })).toThrowError(ZodError);
  });

  it("rejeita label vazio", () => {
    expect(() => draftInputSchema.parse({ label: "", content: "x" })).toThrowError(ZodError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/__tests__/draft.test.ts`
Expected: FAIL — `draftInputSchema` não existe.

- [ ] **Step 3: Implement the schema**

```typescript
// src/domain/draft.ts
import { z } from "zod";

export const draftInputSchema = z.object({
  postId: z.string().min(1).optional(),
  label: z.string().min(1, "Informe um rótulo.").max(80),
  content: z.string().min(1, "O rascunho não pode ficar vazio."),
  theme: z.string().max(200).optional(),
  platform: z.string().max(40).optional(),
});
export type DraftInput = z.infer<typeof draftInputSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/__tests__/draft.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/domain/draft.ts src/domain/__tests__/draft.test.ts
git commit -m "feat(drafts): draftInputSchema (C1)"
```

---

## Task 3: C1 — Repositório de rascunhos

**Files:**
- Create: `src/features/drafts/draft.repository.ts`
- Test: `src/features/drafts/__tests__/draft.repository.test.ts`

**Interfaces:**
- Consumes: `DraftInput` (Task 2), `prisma` de `@/infra/db/prisma`.
- Produces:
  - `createDraft(userId: string, input: DraftInput)` → `prisma.draft.create({ data: { userId, ...input } })`.
  - `listDrafts(userId: string)` → `prisma.draft.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })`.
  - `deleteDraft(userId: string, id: string)` → `prisma.draft.deleteMany({ where: { id, userId } })` (deleteMany garante escopo por userId).

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/drafts/__tests__/draft.repository.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn((_a?: unknown) => Promise.resolve({ id: "d1" }));
const findMany = vi.fn((_a?: unknown) => Promise.resolve([]));
const deleteMany = vi.fn((_a?: unknown) => Promise.resolve({ count: 1 }));
vi.mock("@/infra/db/prisma", () => ({
  prisma: {
    draft: {
      create: (a: unknown) => create(a),
      findMany: (a: unknown) => findMany(a),
      deleteMany: (a: unknown) => deleteMany(a),
    },
  },
}));

import { createDraft, listDrafts, deleteDraft } from "../draft.repository";

describe("draft.repository", () => {
  beforeEach(() => {
    create.mockClear();
    findMany.mockClear();
    deleteMany.mockClear();
  });

  it("cria rascunho com userId", async () => {
    await createDraft("u1", { label: "Direto", content: "x" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (create.mock.calls[0] as [any])[0];
    expect(arg.data.userId).toBe("u1");
    expect(arg.data.label).toBe("Direto");
  });

  it("lista escopado por userId, mais recentes primeiro", async () => {
    await listDrafts("u1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (findMany.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("exclui escopado por userId via deleteMany", async () => {
    await deleteDraft("u1", "d1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (deleteMany.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ id: "d1", userId: "u1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/drafts/__tests__/draft.repository.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implement the repository**

```typescript
// src/features/drafts/draft.repository.ts
import { prisma } from "@/infra/db/prisma";
import type { DraftInput } from "@/domain/draft";

export async function createDraft(userId: string, input: DraftInput) {
  return prisma.draft.create({ data: { userId, ...input } });
}

export async function listDrafts(userId: string) {
  return prisma.draft.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteDraft(userId: string, id: string) {
  return prisma.draft.deleteMany({ where: { id, userId } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/drafts/__tests__/draft.repository.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/features/drafts/draft.repository.ts src/features/drafts/__tests__/draft.repository.test.ts
git commit -m "feat(drafts): draft repository userId-scoped (C1)"
```

---

## Task 4: C1 — Actions de rascunho

**Files:**
- Create: `src/features/drafts/draft.actions.ts`

**Interfaces:**
- Consumes: `draftInputSchema` (Task 2), `createDraft`/`deleteDraft` (Task 3), `requireUser`, `revalidatePath`.
- Produces:
  - `createDraftAction(input: unknown): Promise<{ ok: true } | { ok: false; error: string }>`.
  - `deleteDraftAction(id: string): Promise<{ ok: true } | { ok: false; error: string }>`.

- [ ] **Step 1: Create the actions**

```typescript
// src/features/drafts/draft.actions.ts
"use server";

import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/infra/auth/require-user";
import { draftInputSchema } from "@/domain/draft";
import { createDraft, deleteDraft } from "./draft.repository";

export type DraftActionResult = { ok: true } | { ok: false; error: string };

export async function createDraftAction(input: unknown): Promise<DraftActionResult> {
  const user = await requireUser();
  try {
    const parsed = draftInputSchema.parse(input);
    await createDraft(user.id, parsed);
    revalidatePath("/rascunhos");
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    console.error("[createDraftAction] erro ao salvar rascunho:", error);
    return { ok: false, error: "Não foi possível salvar o rascunho." };
  }
}

export async function deleteDraftAction(id: string): Promise<DraftActionResult> {
  const user = await requireUser();
  try {
    await deleteDraft(user.id, id);
    revalidatePath("/rascunhos");
    return { ok: true };
  } catch (error) {
    console.error("[deleteDraftAction] erro ao excluir rascunho:", error);
    return { ok: false, error: "Não foi possível excluir o rascunho." };
  }
}
```

> Nota: `requireUser()` fica **fora** do try para que um `redirect()` de sessão expirada propague (padrão do `generatePostsAction`).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/features/drafts/draft.actions.ts
git commit -m "feat(drafts): create/delete draft actions (C1)"
```

---

## Task 5: C1 — Página /rascunhos + lista

**Files:**
- Create: `components/drafts/draft-list.tsx`
- Create: `app/(app)/rascunhos/page.tsx`

**Interfaces:**
- Consumes: `listDrafts` (Task 3), `deleteDraftAction` (Task 4), componentes UI (`Button`, `Card*`).
- Produces:
  - `DraftList` (client, default export) — recebe `drafts: DraftView[]` onde
    `type DraftView = { id: string; label: string; content: string; theme: string | null; createdAt: string }`; permite copiar e excluir.
  - Página server `/rascunhos`.

- [ ] **Step 1: Create the client list component**

```tsx
// components/drafts/draft-list.tsx
"use client";

import { useState, useTransition } from "react";
import { deleteDraftAction } from "@/features/drafts/draft.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type DraftView = {
  id: string;
  label: string;
  content: string;
  theme: string | null;
  createdAt: string;
};

export default function DraftList({ drafts }: { drafts: DraftView[] }) {
  const [pending, startTransition] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = async (draft: DraftView) => {
    try {
      await navigator.clipboard.writeText(draft.content);
      setCopiedId(draft.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const remove = (id: string) =>
    startTransition(async () => {
      await deleteDraftAction(id);
    });

  if (drafts.length === 0) {
    return <p className="text-sm text-muted-foreground">Você ainda não salvou rascunhos.</p>;
  }

  return (
    <div className="space-y-4">
      {drafts.map((draft) => (
        <Card key={draft.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {draft.label}
              {draft.theme ? ` · ${draft.theme}` : ""} · {draft.createdAt}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="whitespace-pre-wrap text-sm">{draft.content}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => copy(draft)}>
                {copiedId === draft.id ? "Copiado" : "Copiar"}
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => remove(draft.id)}>
                Excluir
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

```tsx
// app/(app)/rascunhos/page.tsx
import { requireUser } from "@/infra/auth/require-user";
import { listDrafts } from "@/features/drafts/draft.repository";
import DraftList from "@/components/drafts/draft-list";

export default async function RascunhosPage() {
  const user = await requireUser();
  const drafts = await listDrafts(user.id);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Rascunhos</h1>
      <DraftList
        drafts={drafts.map((draft) => ({
          id: draft.id,
          label: draft.label,
          content: draft.content,
          theme: draft.theme,
          createdAt: draft.createdAt.toLocaleDateString("pt-BR"),
        }))}
      />
    </main>
  );
}
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add components/drafts/draft-list.tsx "app/(app)/rascunhos/page.tsx"
git commit -m "feat(drafts): /rascunhos page and list (C1)"
```

---

## Task 6: C1 — Botão "Salvar rascunho" no variant-card

**Files:**
- Modify: `components/generate/variant-card.tsx`

**Interfaces:**
- Consumes: `createDraftAction` (Task 4). O card já tem `postId`, `label`, `draft` (texto corrente) e `startTransition`/`pending` (Marcos A/B).
- Produces: botão "Salvar rascunho" que chama `createDraftAction({ postId, label, content: draft })` e sinaliza sucesso/erro curto.

- [ ] **Step 1: Wire the save-draft button**

Em `components/generate/variant-card.tsx`:

1. Importar a action (junto dos outros imports de actions):
```typescript
import { createDraftAction } from "@/features/drafts/draft.actions";
```

2. Adicionar estado de feedback (perto dos outros `useState`):
```typescript
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
```

3. Adicionar o handler (perto de `regenerate`):
```typescript
  const saveDraft = () =>
    startTransition(async () => {
      setDraftError(null);
      const result = await createDraftAction({ postId, label, content: draft });
      if (result.ok) {
        setDraftSaved(true);
        setTimeout(() => setDraftSaved(false), 1500);
      } else {
        setDraftError(result.error);
      }
    });
```

4. Adicionar o botão na linha do modo não-edição (ao lado de "Regenerar"):
```tsx
              <Button size="sm" variant="outline" disabled={pending} onClick={saveDraft}>{draftSaved ? "Salvo" : "Salvar rascunho"}</Button>
```

5. Renderizar o erro perto do `regenError`:
```tsx
        {draftError && <p className="text-xs text-destructive">{draftError}</p>}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add components/generate/variant-card.tsx
git commit -m "feat(drafts): save-draft button on variant card (C1)"
```

---

## Task 7: C2 — Schema de origem da versão

**Files:**
- Create: `src/domain/memory-version.ts`
- Test: `src/domain/__tests__/memory-version.test.ts`

**Interfaces:**
- Produces:
  - `memorySourceSchema = z.enum(["manual","relearn","onboarding"])`.
  - `type MemorySource = z.infer<typeof memorySourceSchema>`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/domain/__tests__/memory-version.test.ts
import { describe, it, expect } from "vitest";
import { memorySourceSchema } from "../memory-version";

describe("memorySourceSchema", () => {
  it("aceita as três origens válidas", () => {
    expect(memorySourceSchema.parse("manual")).toBe("manual");
    expect(memorySourceSchema.parse("relearn")).toBe("relearn");
    expect(memorySourceSchema.parse("onboarding")).toBe("onboarding");
  });

  it("rejeita origem inválida", () => {
    expect(() => memorySourceSchema.parse("xpto")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/__tests__/memory-version.test.ts`
Expected: FAIL — `memorySourceSchema` não existe.

- [ ] **Step 3: Implement the schema**

```typescript
// src/domain/memory-version.ts
import { z } from "zod";

export const memorySourceSchema = z.enum(["manual", "relearn", "onboarding"]);
export type MemorySource = z.infer<typeof memorySourceSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/__tests__/memory-version.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/domain/memory-version.ts src/domain/__tests__/memory-version.test.ts
git commit -m "feat(positioning): memorySourceSchema (C2)"
```

---

## Task 8: C2 — Repositório de versões da memória

**Files:**
- Create: `src/features/positioning/memory-version.repository.ts`
- Test: `src/features/positioning/__tests__/memory-version.repository.test.ts`

**Interfaces:**
- Consumes: `MemorySource` (Task 7), `prisma`.
- Produces:
  - `recordMemoryVersion(userId: string, memory: string, source: MemorySource)` → `prisma.positioningMemoryVersion.create({ data: { userId, memory, source } })`.
  - `listMemoryVersions(userId: string)` → `prisma.positioningMemoryVersion.findMany({ where: { userId }, orderBy: { createdAt: "desc" } })`.
  - `getMemoryVersion(userId: string, id: string)` → `prisma.positioningMemoryVersion.findFirst({ where: { id, userId } })`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/positioning/__tests__/memory-version.repository.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn((_a?: unknown) => Promise.resolve({ id: "v1" }));
const findMany = vi.fn((_a?: unknown) => Promise.resolve([]));
const findFirst = vi.fn((_a?: unknown) => Promise.resolve(null));
vi.mock("@/infra/db/prisma", () => ({
  prisma: {
    positioningMemoryVersion: {
      create: (a: unknown) => create(a),
      findMany: (a: unknown) => findMany(a),
      findFirst: (a: unknown) => findFirst(a),
    },
  },
}));

import {
  recordMemoryVersion,
  listMemoryVersions,
  getMemoryVersion,
} from "../memory-version.repository";

describe("memory-version.repository", () => {
  beforeEach(() => {
    create.mockClear();
    findMany.mockClear();
    findFirst.mockClear();
  });

  it("grava versão com userId, memory e source", async () => {
    await recordMemoryVersion("u1", "minha memória", "relearn");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (create.mock.calls[0] as [any])[0];
    expect(arg.data).toEqual({ userId: "u1", memory: "minha memória", source: "relearn" });
  });

  it("lista escopado por userId, mais recentes primeiro", async () => {
    await listMemoryVersions("u1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (findMany.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
  });

  it("busca uma versão escopada por userId", async () => {
    await getMemoryVersion("u1", "v1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (findFirst.mock.calls[0] as [any])[0];
    expect(arg.where).toEqual({ id: "v1", userId: "u1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/positioning/__tests__/memory-version.repository.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implement the repository**

```typescript
// src/features/positioning/memory-version.repository.ts
import { prisma } from "@/infra/db/prisma";
import type { MemorySource } from "@/domain/memory-version";

export async function recordMemoryVersion(
  userId: string,
  memory: string,
  source: MemorySource
) {
  return prisma.positioningMemoryVersion.create({
    data: { userId, memory, source },
  });
}

export async function listMemoryVersions(userId: string) {
  return prisma.positioningMemoryVersion.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getMemoryVersion(userId: string, id: string) {
  return prisma.positioningMemoryVersion.findFirst({ where: { id, userId } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/positioning/__tests__/memory-version.repository.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/features/positioning/memory-version.repository.ts src/features/positioning/__tests__/memory-version.repository.test.ts
git commit -m "feat(positioning): memory-version repository (C2)"
```

---

## Task 9: C2 — Gravar versão em toda escrita de memória

**Files:**
- Modify: `src/features/onboarding/onboarding.actions.ts`
- Modify: `src/features/positioning/relearn.actions.ts`
- Modify: `src/features/positioning/positioning.actions.ts`

**Interfaces:**
- Consumes: `recordMemoryVersion` (Task 8).
- Produces: cada uma das três escritas de `positioningMemory` grava uma versão após o sucesso — `onboarding`, `relearn`, `manual`. O versionamento é best-effort: um erro ao gravar a versão é logado mas não derruba a ação principal.

- [ ] **Step 1: Version on onboarding finish**

Em `src/features/onboarding/onboarding.actions.ts`, importar:

```typescript
import { recordMemoryVersion } from "@/features/positioning/memory-version.repository";
```

Em `finishOnboardingAction`, logo após `await upsertPositioningProfile(user.id, seed);`:

```typescript
    if (seed.positioningMemory) {
      try {
        await recordMemoryVersion(user.id, seed.positioningMemory, "onboarding");
      } catch (versionError) {
        console.error("[finishOnboardingAction] falha ao versionar memória:", versionError);
      }
    }
```

- [ ] **Step 2: Version on relearn**

Em `src/features/positioning/relearn.actions.ts`, importar:

```typescript
import { recordMemoryVersion } from "./memory-version.repository";
```

Em `relearnPositioningAction`, dentro do bloco `if (newMemory.length > 0) { ... }`, logo após `await updatePositioningMemory(user.id, newMemory);`:

```typescript
      try {
        await recordMemoryVersion(user.id, newMemory, "relearn");
      } catch (versionError) {
        console.error("[relearnPositioningAction] falha ao versionar memória:", versionError);
      }
```

- [ ] **Step 3: Version on manual edit**

Em `src/features/positioning/positioning.actions.ts`, importar:

```typescript
import { recordMemoryVersion } from "./memory-version.repository";
```

Em `updatePositioningProfileAction`, logo após `await updatePositioningProfile(user.id, parsed);` e antes de `revalidatePath(...)`:

```typescript
    if (parsed.positioningMemory) {
      try {
        await recordMemoryVersion(user.id, parsed.positioningMemory, "manual");
      } catch (versionError) {
        console.error("[updatePositioningProfileAction] falha ao versionar memória:", versionError);
      }
    }
```

- [ ] **Step 4: Type-check + tests**

Run: `npx tsc --noEmit`
Expected: sem erros.
Run: `npm test`
Expected: suíte verde (nada regrediu).

- [ ] **Step 5: Commit**

```bash
git add src/features/onboarding/onboarding.actions.ts src/features/positioning/relearn.actions.ts src/features/positioning/positioning.actions.ts
git commit -m "feat(positioning): record memory version on every write (C2)"
```

---

## Task 10: C2 — Action de reverter versão

**Files:**
- Create: `src/features/positioning/memory-version.actions.ts`

**Interfaces:**
- Consumes: `getMemoryVersion` (Task 8), `updatePositioningMemory` de `@/features/positioning/positioning.repository`, `recordMemoryVersion` (Task 8), `requireUser`, `revalidatePath`.
- Produces:
  - `revertMemoryVersionAction(versionId: string): Promise<{ ok: true } | { ok: false; error: string }>` — carrega a versão (escopada por userId), grava a memória dela como atual, e registra uma **nova** versão `source "manual"` (nunca apaga a antiga).

- [ ] **Step 1: Create the revert action**

```typescript
// src/features/positioning/memory-version.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/infra/auth/require-user";
import { updatePositioningMemory } from "./positioning.repository";
import {
  getMemoryVersion,
  recordMemoryVersion,
} from "./memory-version.repository";

export type RevertMemoryResult = { ok: true } | { ok: false; error: string };

export async function revertMemoryVersionAction(
  versionId: string
): Promise<RevertMemoryResult> {
  const user = await requireUser();
  try {
    const version = await getMemoryVersion(user.id, versionId);
    if (!version) {
      return { ok: false, error: "Versão não encontrada." };
    }

    await updatePositioningMemory(user.id, version.memory);
    // Reverter cria uma nova versão a partir da antiga — nunca destrói o histórico.
    try {
      await recordMemoryVersion(user.id, version.memory, "manual");
    } catch (versionError) {
      console.error("[revertMemoryVersionAction] falha ao versionar revert:", versionError);
    }

    revalidatePath("/posicionamento");
    return { ok: true };
  } catch (error) {
    console.error("[revertMemoryVersionAction] erro ao reverter memória:", error);
    return { ok: false, error: "Não foi possível reverter a memória." };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/features/positioning/memory-version.actions.ts
git commit -m "feat(positioning): revertMemoryVersionAction (C2)"
```

---

## Task 11: C2 — Histórico da memória em /posicionamento

**Files:**
- Create: `components/positioning/memory-history.tsx`
- Modify: `app/(app)/posicionamento/page.tsx`

**Interfaces:**
- Consumes: `revertMemoryVersionAction` (Task 10), `listMemoryVersions` (Task 8), componentes UI.
- Produces:
  - `MemoryHistory` (client, default export) — recebe `versions: MemoryVersionView[]` onde
    `type MemoryVersionView = { id: string; memory: string; source: string; createdAt: string }`; cada item mostra origem/data + trecho e um botão "Reverter".
  - Página `/posicionamento` renderiza o histórico abaixo do editor.

- [ ] **Step 1: Create the history component**

```tsx
// components/positioning/memory-history.tsx
"use client";

import { useState, useTransition } from "react";
import { revertMemoryVersionAction } from "@/features/positioning/memory-version.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type MemoryVersionView = {
  id: string;
  memory: string;
  source: string;
  createdAt: string;
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Edição manual",
  relearn: "Reaprendizado",
  onboarding: "Onboarding",
};

export default function MemoryHistory({ versions }: { versions: MemoryVersionView[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const revert = (id: string) =>
    startTransition(async () => {
      setError(null);
      const result = await revertMemoryVersionAction(id);
      if (!result.ok) setError(result.error);
    });

  if (versions.length === 0) {
    return <p className="text-xs text-muted-foreground">Ainda não há histórico de versões.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Histórico da memória</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {versions.map((version) => (
          <div key={version.id} className="space-y-2 border-b border-border/50 pb-3 last:border-0">
            <p className="text-xs text-muted-foreground">
              {SOURCE_LABELS[version.source] ?? version.source} · {version.createdAt}
            </p>
            <p className="whitespace-pre-wrap text-sm line-clamp-4">{version.memory}</p>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => revert(version.id)}>
              Reverter para esta
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Wire the history into the page**

Em `app/(app)/posicionamento/page.tsx`, importar no topo:

```tsx
import { listMemoryVersions } from "@/features/positioning/memory-version.repository";
import MemoryHistory from "@/components/positioning/memory-history";
```

Após obter o `profile` (no bloco com perfil), buscar as versões e renderizar o componente logo abaixo do `PositioningEditor` (antes do parágrafo final). Buscar as versões:

```tsx
  const versions = await listMemoryVersions(user.id);
```

E no JSX, após `<PositioningEditor ... />`:

```tsx
      <MemoryHistory
        versions={versions.map((version) => ({
          id: version.id,
          memory: version.memory,
          source: version.source,
          createdAt: version.createdAt.toLocaleDateString("pt-BR"),
        }))}
      />
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit`
Expected: sem erros.
Run: `npm run build`
Expected: build OK, rota `/rascunhos` e `/posicionamento` presentes.

- [ ] **Step 4: Commit**

```bash
git add components/positioning/memory-history.tsx "app/(app)/posicionamento/page.tsx"
git commit -m "feat(positioning): memory history with revert on /posicionamento (C2)"
```

---

## Task 12: Portões finais do Marco C

**Files:** nenhum (verificação).

- [ ] **Step 1: Suíte de testes**

Run: `npm test`
Expected: todos verdes.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build conclui sem erros; rotas `/rascunhos` e `/posicionamento` listadas.

- [ ] **Step 4: Migration status**

Run: `npx prisma migrate status`
Expected: "Database schema is up to date!" com a migration `add_drafts_and_memory_versions` aplicada.

- [ ] **Step 5: Verificação manual (rota feliz)**

`npm run dev` e validar:
- `/generate`: gerar → "Salvar rascunho" numa variação → aparece em `/rascunhos`; copiar e excluir funcionam.
- `/posicionamento`: editar a memória e salvar → surge uma versão `manual` no histórico; "Reverter para esta" numa versão antiga restaura o texto e cria nova versão (a antiga permanece).

- [ ] **Step 6: Commit final (se houver ajustes)**

```bash
git add -A
git commit -m "chore(marco-c): final gates green (tests + tsc + build + migration)"
```

---

## Self-Review

**1. Spec coverage (Marco C):**
- C1 (rascunhos: model `Draft`; salvar do variant-card; `/rascunhos` lista/copia/exclui; repo `createDraft`/`listDrafts`/`deleteDraft` userId-scoped) → Tasks 1–6. ✅
- C2 (model `PositioningMemoryVersion`; toda escrita de memória grava versão — onboarding/relearn/edição manual; `/posicionamento` mostra histórico e permite reverter criando nova versão sem destruir; repo `recordMemoryVersion`/`listMemoryVersions`/`getMemoryVersion`) → Tasks 1, 7–11. ✅
- Migrations via Prisma → Task 1. ✅
- A versão da edição manual (A1, adiada no Marco A) agora é coberta pelo Task 9 (source `manual`). ✅

**2. Placeholder scan:** Sem TBD/TODO/“add error handling” genérico; todo passo de código mostra o código. ✅

**3. Type consistency:**
- `DraftInput` (Task 2) → `createDraft` (Task 3) → `createDraftAction` (Task 4) → botão (Task 6).
- `MemorySource` (Task 7) → `recordMemoryVersion` (Task 8) → escritas (Task 9) e revert (Task 10).
- `getMemoryVersion`/`updatePositioningMemory`/`recordMemoryVersion` usados consistentemente no revert (Task 10).
- `DraftView`/`MemoryVersionView` definidos nos componentes e alimentados pelas páginas (Tasks 5, 11). ✅

**Observação de execução:** Task 1 roda migration e regenera o client — precisa do Postgres local (localhost:5432) acessível. Se o subagent não conseguir aplicar interativamente, usar o fallback `--create-only` + `migrate deploy` + `generate` descrito no Task 1. Os demais tasks dependem do client regenerado do Task 1 para o `tsc` passar.
