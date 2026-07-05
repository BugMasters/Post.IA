# Marco A — Beta Fechado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar o Post.IA em produção para beta fechado: quota diária de uso por usuário, signup por código de convite, deploy Vercel + Neon e Sentry.

**Architecture:** Dois modelos novos (`UsageEvent`, `InviteCode`). Quota é checada nas actions de geração ANTES de chamar o Gemini e registrada APÓS sucesso. Convite é consumido atomicamente na mesma transação que cria o usuário. Sentry via `instrumentation.ts` (desligado sem DSN). Deploy documentado em checklist (setup Vercel/Neon é manual, do usuário).

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 6 + PostgreSQL, Zod 4, Vitest, @sentry/nextjs.

**Spec:** `docs/superpowers/specs/2026-07-05-marco-a-beta-fechado-design.md`

**Pré-requisito (fora deste plano):** branch `feat/identidade-visual` fechada e mergeada em `main`. Este plano executa em branch nova `feat/marco-a-beta` a partir de `main`.

## Global Constraints

- `requireUser()` SEMPRE fora do try/catch (NEXT_REDIRECT deve propagar).
- Erros para o usuário: mensagem pt-BR padrão; NUNCA vazar `error.message` interno. Exceções: mensagens de ZodError e erros de negócio conhecidos comparados por igualdade exata.
- Toda query Prisma escopada por `userId`; `updateMany`/`deleteMany` com `where { id, userId }` para escopar por dono.
- NUNCA `git add src/generated/prisma` (gitignored). Migrations: commitar só `prisma/schema.prisma` + `prisma/migrations`.
- Testes não-vazios: assertar mensagem/args, nunca `.toThrow()` pelado.
- Rodar `npx tsc --noEmit` depois de qualquer task que mexa em mocks de teste.
- Sem `import()` dinâmico para escapar de deps no Vitest; lógica pura em `*.helpers.ts`.
- Mensagens de negócio exatas usadas neste plano: `"Código de convite inválido."`, `"Você atingiu o limite diário de gerações. Volte amanhã."`, `"Você atingiu o limite diário de regenerações. Volte amanhã."`
- Defaults de quota: `DAILY_GENERATION_LIMIT=10`, `DAILY_REGENERATION_LIMIT=20`. Janela = dia-calendário em America/Sao_Paulo (offset fixo -03:00, Brasil não tem mais horário de verão).
- Portões finais: `npm test` → `npx tsc --noEmit` → `npm run build` → `npx prisma migrate status`.

---

### Task 1: Schema Prisma — `UsageEvent` + `InviteCode`

**Files:**
- Modify: `prisma/schema.prisma`
- Create (gerado): `prisma/migrations/<timestamp>_usage_event_invite_code/`

**Interfaces:**
- Produces: modelos `prisma.usageEvent` (campos `id`, `userId`, `kind`, `durationMs`, `createdAt`) e `prisma.inviteCode` (campos `id`, `code` único, `createdAt`, `usedById`, `usedAt`) para Tasks 3, 8 e 10.

- [ ] **Step 1: Adicionar modelos ao schema**

Em `prisma/schema.prisma`, adicionar ao `model User` (dentro do bloco de relações existente, após `memoryVersions`):

```prisma
  usageEvents    UsageEvent[]
  invitesUsed    InviteCode[]
```

Adicionar ao fim do arquivo:

```prisma
model UsageEvent {
  id         String   @id @default(cuid())
  userId     String
  kind       String
  durationMs Int?
  createdAt  DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, kind, createdAt])
}

model InviteCode {
  id        String    @id @default(cuid())
  code      String    @unique
  createdAt DateTime  @default(now())
  usedById  String?
  usedAt    DateTime?

  usedBy User? @relation(fields: [usedById], references: [id], onDelete: SetNull)
}
```

- [ ] **Step 2: Gerar migration**

Run: `npx prisma migrate dev --name usage_event_invite_code`
Expected: migration criada e aplicada; `prisma generate` roda junto.

- [ ] **Step 3: Verificar status**

Run: `npx prisma migrate status`
Expected: "Database schema is up to date!"

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): UsageEvent and InviteCode models (A1/A2)"
```

---

### Task 2: Domain de uso + helpers puros de quota

**Files:**
- Create: `src/domain/usage.ts`
- Create: `src/features/usage/usage.helpers.ts`
- Test: `src/features/usage/__tests__/usage.helpers.test.ts`

**Interfaces:**
- Produces: `usageKindSchema` / tipo `UsageKind` (`"generate" | "regenerate" | "onboarding" | "relearn"`); `startOfCurrentDaySaoPaulo(now: Date): Date`; `resolveDailyLimit(raw: string | undefined, fallback: number): number`. Usados nas Tasks 3 e 4.

- [ ] **Step 1: Escrever testes que falham**

Criar `src/features/usage/__tests__/usage.helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { usageKindSchema } from "@/domain/usage";
import {
  startOfCurrentDaySaoPaulo,
  resolveDailyLimit,
} from "../usage.helpers";

describe("usageKindSchema", () => {
  it("aceita os quatro tipos de uso", () => {
    expect(usageKindSchema.parse("generate")).toBe("generate");
    expect(usageKindSchema.parse("regenerate")).toBe("regenerate");
    expect(usageKindSchema.parse("onboarding")).toBe("onboarding");
    expect(usageKindSchema.parse("relearn")).toBe("relearn");
  });

  it("rejeita tipo desconhecido com ZodError", () => {
    expect(() => usageKindSchema.parse("billing")).toThrowError(ZodError);
  });
});

describe("startOfCurrentDaySaoPaulo", () => {
  it("retorna 00:00 de São Paulo (03:00 UTC) do mesmo dia local", () => {
    // 2026-07-05 15:00 UTC = 2026-07-05 12:00 em SP
    const now = new Date("2026-07-05T15:00:00.000Z");
    expect(startOfCurrentDaySaoPaulo(now).toISOString()).toBe(
      "2026-07-05T03:00:00.000Z"
    );
  });

  it("vira o dia no fuso de SP, não em UTC", () => {
    // 2026-07-05 02:00 UTC = 2026-07-04 23:00 em SP → dia local ainda é 04
    const now = new Date("2026-07-05T02:00:00.000Z");
    expect(startOfCurrentDaySaoPaulo(now).toISOString()).toBe(
      "2026-07-04T03:00:00.000Z"
    );
  });
});

describe("resolveDailyLimit", () => {
  it("usa o valor da env quando é número positivo", () => {
    expect(resolveDailyLimit("25", 10)).toBe(25);
  });

  it("cai no fallback quando env ausente, vazia, negativa ou não-numérica", () => {
    expect(resolveDailyLimit(undefined, 10)).toBe(10);
    expect(resolveDailyLimit("", 10)).toBe(10);
    expect(resolveDailyLimit("-5", 10)).toBe(10);
    expect(resolveDailyLimit("abc", 10)).toBe(10);
  });

  it("trunca valores fracionários", () => {
    expect(resolveDailyLimit("7.9", 10)).toBe(7);
  });
});
```

- [ ] **Step 2: Rodar teste, confirmar falha**

Run: `npx vitest run src/features/usage/__tests__/usage.helpers.test.ts`
Expected: FAIL — módulos `@/domain/usage` e `../usage.helpers` não existem.

- [ ] **Step 3: Implementar domain e helpers**

Criar `src/domain/usage.ts`:

```ts
import { z } from "zod";

export const usageKindSchema = z.enum([
  "generate",
  "regenerate",
  "onboarding",
  "relearn",
]);

export type UsageKind = z.infer<typeof usageKindSchema>;
```

Criar `src/features/usage/usage.helpers.ts`:

```ts
// Brasil aboliu o horário de verão em 2019; São Paulo é UTC-3 fixo.
const SAO_PAULO_UTC_OFFSET_MS = -3 * 60 * 60 * 1000;

export function startOfCurrentDaySaoPaulo(now: Date): Date {
  const local = new Date(now.getTime() + SAO_PAULO_UTC_OFFSET_MS);
  const startLocalUtcMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate()
  );
  return new Date(startLocalUtcMs - SAO_PAULO_UTC_OFFSET_MS);
}

export function resolveDailyLimit(
  raw: string | undefined,
  fallback: number
): number {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}
```

- [ ] **Step 4: Rodar teste, confirmar verde**

Run: `npx vitest run src/features/usage/__tests__/usage.helpers.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add src/domain/usage.ts src/features/usage/usage.helpers.ts src/features/usage/__tests__/usage.helpers.test.ts
git commit -m "feat(usage): usage kind schema and pure quota helpers (A1)"
```

---

### Task 3: Repository de uso + status de quota

**Files:**
- Create: `src/features/usage/usage.repository.ts`
- Test: `src/features/usage/__tests__/usage.repository.test.ts`

**Interfaces:**
- Consumes: `UsageKind`, `startOfCurrentDaySaoPaulo`, `resolveDailyLimit` (Task 2); `prisma.usageEvent` (Task 1).
- Produces: `recordUsage(userId: string, kind: UsageKind, durationMs?: number)`; `countUsageToday(userId: string, kind: UsageKind): Promise<number>`; `getQuotaStatus(userId: string, kind: "generate" | "regenerate"): Promise<{ used: number; limit: number; remaining: number }>`. Usados nas Tasks 4, 5 e 6.

- [ ] **Step 1: Escrever testes que falham**

Criar `src/features/usage/__tests__/usage.repository.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const create = vi.fn();
const count = vi.fn();

vi.mock("@/infra/db/prisma", () => ({
  prisma: {
    usageEvent: {
      create: (a: unknown) => create(a),
      count: (a: unknown) => count(a),
    },
  },
}));

import {
  recordUsage,
  countUsageToday,
  getQuotaStatus,
} from "../usage.repository";

describe("usage.repository", () => {
  beforeEach(() => {
    create.mockReset();
    count.mockReset();
    vi.useFakeTimers();
    // 12:00 em SP
    vi.setSystemTime(new Date("2026-07-05T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.DAILY_GENERATION_LIMIT;
  });

  it("recordUsage grava evento escopado ao usuário com durationMs", async () => {
    create.mockResolvedValue({ id: "e1" });
    await recordUsage("user-1", "generate", 1234);
    expect(create).toHaveBeenCalledWith({
      data: { userId: "user-1", kind: "generate", durationMs: 1234 },
    });
  });

  it("countUsageToday conta só o usuário, o kind e o dia local de SP", async () => {
    count.mockResolvedValue(3);
    const result = await countUsageToday("user-1", "generate");
    expect(result).toBe(3);
    expect(count).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        kind: "generate",
        createdAt: { gte: new Date("2026-07-05T03:00:00.000Z") },
      },
    });
  });

  it("getQuotaStatus usa DAILY_GENERATION_LIMIT da env", async () => {
    process.env.DAILY_GENERATION_LIMIT = "5";
    count.mockResolvedValue(5);
    const status = await getQuotaStatus("user-1", "generate");
    expect(status).toEqual({ used: 5, limit: 5, remaining: 0 });
  });

  it("getQuotaStatus usa default 10 para generate sem env", async () => {
    count.mockResolvedValue(2);
    const status = await getQuotaStatus("user-1", "generate");
    expect(status).toEqual({ used: 2, limit: 10, remaining: 8 });
  });

  it("remaining nunca fica negativo", async () => {
    count.mockResolvedValue(99);
    const status = await getQuotaStatus("user-1", "generate");
    expect(status.remaining).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar teste, confirmar falha**

Run: `npx vitest run src/features/usage/__tests__/usage.repository.test.ts`
Expected: FAIL — `../usage.repository` não existe.

- [ ] **Step 3: Implementar repository**

Criar `src/features/usage/usage.repository.ts`:

```ts
import { prisma } from "@/infra/db/prisma";
import type { UsageKind } from "@/domain/usage";
import {
  resolveDailyLimit,
  startOfCurrentDaySaoPaulo,
} from "./usage.helpers";

const QUOTA_ENV: Record<
  "generate" | "regenerate",
  { envVar: string; fallback: number }
> = {
  generate: { envVar: "DAILY_GENERATION_LIMIT", fallback: 10 },
  regenerate: { envVar: "DAILY_REGENERATION_LIMIT", fallback: 20 },
};

export async function recordUsage(
  userId: string,
  kind: UsageKind,
  durationMs?: number
) {
  return prisma.usageEvent.create({
    data: { userId, kind, durationMs: durationMs ?? null },
  });
}

export async function countUsageToday(userId: string, kind: UsageKind) {
  return prisma.usageEvent.count({
    where: {
      userId,
      kind,
      createdAt: { gte: startOfCurrentDaySaoPaulo(new Date()) },
    },
  });
}

export async function getQuotaStatus(
  userId: string,
  kind: "generate" | "regenerate"
) {
  const { envVar, fallback } = QUOTA_ENV[kind];
  const limit = resolveDailyLimit(process.env[envVar], fallback);
  const used = await countUsageToday(userId, kind);
  return { used, limit, remaining: Math.max(0, limit - used) };
}
```

Nota: `durationMs: durationMs ?? null` — se o teste do Step 1 falhar por diferença `undefined` vs `null` no primeiro assert, ajustar o assert do teste para `durationMs: 1234` como está (o call passa 1234; o caso `null` não é assertado).

- [ ] **Step 4: Rodar teste, confirmar verde**

Run: `npx vitest run src/features/usage/__tests__/usage.repository.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: tsc (task mexeu em mocks)**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 6: Commit**

```bash
git add src/features/usage/usage.repository.ts src/features/usage/__tests__/usage.repository.test.ts
git commit -m "feat(usage): usage repository with daily quota status (A1)"
```

---

### Task 4: Quota na `generatePostsAction`

**Files:**
- Modify: `src/features/generate/generate.actions.ts`
- Test: `src/features/generate/__tests__/generate-quota.test.ts`

**Interfaces:**
- Consumes: `getQuotaStatus`, `recordUsage` (Task 3).
- Produces: `generatePostsAction` retorna `{ ok: false, error: "Você atingiu o limite diário de gerações. Volte amanhã." }` quando `remaining === 0`, sem chamar o LLM; registra `recordUsage(user.id, "generate", durationMs)` após sucesso (best-effort).

- [ ] **Step 1: Escrever testes que falham**

Criar `src/features/generate/__tests__/generate-quota.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
vi.mock("@/infra/auth/require-user", () => ({
  requireUser: () => requireUser(),
}));

const getPositioningProfile = vi.fn();
vi.mock("@/features/positioning/positioning.repository", () => ({
  getPositioningProfile: (...a: unknown[]) => getPositioningProfile(...a),
}));

const listPositiveExamples = vi.fn();
vi.mock("@/features/feedback/feedback.repository", () => ({
  listPositiveExamples: (...a: unknown[]) => listPositiveExamples(...a),
}));

const savePost = vi.fn();
vi.mock("@/features/posts/posts.repository", () => ({
  savePost: (...a: unknown[]) => savePost(...a),
}));

const generateText = vi.fn();
vi.mock("@/infra/llm", () => ({
  getLlmProvider: () => ({
    generateText: (...a: unknown[]) => generateText(...a),
  }),
}));

const getQuotaStatus = vi.fn();
const recordUsage = vi.fn();
vi.mock("@/features/usage/usage.repository", () => ({
  getQuotaStatus: (...a: unknown[]) => getQuotaStatus(...a),
  recordUsage: (...a: unknown[]) => recordUsage(...a),
}));

import { generatePostsAction } from "../generate.actions";
import { EXPECTED_VARIANT_LABELS } from "../generate.prompt";

const PROFILE = {
  niche: "n",
  audience: "a",
  offer: "o",
  differentiation: "d",
  tonePreference: "t",
  ctaPreference: "c",
  positioningMemory: "m",
};

const validLlmResponse = JSON.stringify({
  variants: EXPECTED_VARIANT_LABELS.map((label) => ({
    label,
    content: "conteúdo válido para publicação. ".repeat(40),
  })),
});

describe("generatePostsAction — quota diária", () => {
  beforeEach(() => {
    requireUser.mockReset().mockResolvedValue({ id: "user-1" });
    getPositioningProfile.mockReset().mockResolvedValue(PROFILE);
    listPositiveExamples.mockReset().mockResolvedValue([]);
    savePost.mockReset().mockResolvedValue({ id: "post-1" });
    generateText.mockReset().mockResolvedValue(validLlmResponse);
    getQuotaStatus.mockReset();
    recordUsage.mockReset().mockResolvedValue({ id: "e1" });
  });

  it("bloqueia sem chamar o LLM quando quota esgotada", async () => {
    getQuotaStatus.mockResolvedValue({ used: 10, limit: 10, remaining: 0 });

    const result = await generatePostsAction({ theme: "tema", format: "TEXT" });

    expect(result).toEqual({
      ok: false,
      error: "Você atingiu o limite diário de gerações. Volte amanhã.",
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(savePost).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("gera e registra uso com duração quando há quota", async () => {
    getQuotaStatus.mockResolvedValue({ used: 1, limit: 10, remaining: 9 });

    const result = await generatePostsAction({ theme: "tema", format: "TEXT" });

    expect(result.ok).toBe(true);
    expect(getQuotaStatus).toHaveBeenCalledWith("user-1", "generate");
    expect(recordUsage).toHaveBeenCalledWith(
      "user-1",
      "generate",
      expect.any(Number)
    );
  });

  it("falha do registro de uso não derruba a geração", async () => {
    getQuotaStatus.mockResolvedValue({ used: 1, limit: 10, remaining: 9 });
    recordUsage.mockRejectedValue(new Error("db down"));

    const result = await generatePostsAction({ theme: "tema", format: "TEXT" });

    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar teste, confirmar falha**

Run: `npx vitest run src/features/generate/__tests__/generate-quota.test.ts`
Expected: FAIL — action ainda não checa quota (primeiro teste falha; `generateText` foi chamado).

- [ ] **Step 3: Implementar quota na action**

Em `src/features/generate/generate.actions.ts`:

Adicionar import (junto aos imports de features):

```ts
import { getQuotaStatus, recordUsage } from "@/features/usage/usage.repository";
```

Adicionar constante (junto às outras mensagens):

```ts
const QUOTA_EXCEEDED_MESSAGE =
  "Você atingiu o limite diário de gerações. Volte amanhã.";
```

Dentro de `generatePostsAction`, logo após `const user = await requireUser();` e ANTES de `getPositioningProfile`:

```ts
  const quota = await getQuotaStatus(user.id, "generate");
  if (quota.remaining <= 0) {
    return { ok: false, error: QUOTA_EXCEEDED_MESSAGE };
  }
```

Logo após a linha `const generationRequestOptions = ...` (antes de `runPrompt`), adicionar:

```ts
  const startedAt = Date.now();
  const recordGenerationUsage = async () => {
    try {
      await recordUsage(user.id, "generate", Date.now() - startedAt);
    } catch (usageError) {
      console.error(
        "[generatePostsAction] falha ao registrar uso:",
        usageError
      );
    }
  };
```

Nos DOIS caminhos de sucesso (o `return { ok: true, ... }` do fluxo normal e o do retry), adicionar `await recordGenerationUsage();` na linha imediatamente ANTES do `return { ok: true, ... }`.

- [ ] **Step 4: Rodar testes, confirmar verde**

Run: `npx vitest run src/features/generate/__tests__/generate-quota.test.ts`
Expected: PASS (3 testes).

Run: `npx vitest run`
Expected: todos os testes do projeto verdes (nenhuma regressão).

- [ ] **Step 5: tsc (task mexeu em mocks)**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 6: Commit**

```bash
git add src/features/generate/generate.actions.ts src/features/generate/__tests__/generate-quota.test.ts
git commit -m "feat(usage): daily quota gate on post generation (A1)"
```

---

### Task 5: Quota na `regenerateVariantAction`

**Files:**
- Modify: `src/features/generate/regenerate.actions.ts`
- Test: `src/features/generate/__tests__/regenerate-quota.test.ts`

**Interfaces:**
- Consumes: `getQuotaStatus`, `recordUsage` (Task 3).
- Produces: `regenerateVariantAction` retorna `{ ok: false, error: "Você atingiu o limite diário de regenerações. Volte amanhã." }` quando `remaining === 0`, sem chamar o LLM; registra `recordUsage(user.id, "regenerate", durationMs)` após sucesso (best-effort).

- [ ] **Step 1: Escrever testes que falham**

Criar `src/features/generate/__tests__/regenerate-quota.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
vi.mock("@/infra/auth/require-user", () => ({
  requireUser: () => requireUser(),
}));

const getPost = vi.fn();
const updatePostVariants = vi.fn();
vi.mock("@/features/posts/posts.repository", () => ({
  getPost: (...a: unknown[]) => getPost(...a),
  updatePostVariants: (...a: unknown[]) => updatePostVariants(...a),
}));

const getPositioningProfile = vi.fn();
vi.mock("@/features/positioning/positioning.repository", () => ({
  getPositioningProfile: (...a: unknown[]) => getPositioningProfile(...a),
}));

const generateText = vi.fn();
vi.mock("@/infra/llm", () => ({
  getLlmProvider: () => ({
    generateText: (...a: unknown[]) => generateText(...a),
  }),
}));

const getQuotaStatus = vi.fn();
const recordUsage = vi.fn();
vi.mock("@/features/usage/usage.repository", () => ({
  getQuotaStatus: (...a: unknown[]) => getQuotaStatus(...a),
  recordUsage: (...a: unknown[]) => recordUsage(...a),
}));

import { regenerateVariantAction } from "../regenerate.actions";

const PROFILE = {
  niche: "n",
  audience: "a",
  offer: "o",
  differentiation: "d",
  tonePreference: "t",
  ctaPreference: "c",
  positioningMemory: "m",
};

const POST = {
  id: "post-1",
  theme: "tema",
  platform: "LINKEDIN",
  objective: "AUTORIDADE",
  length: "CURTO",
  variants: [{ label: "Direto ao ponto", content: "texto atual" }],
};

describe("regenerateVariantAction — quota diária", () => {
  beforeEach(() => {
    requireUser.mockReset().mockResolvedValue({ id: "user-1" });
    getPost.mockReset().mockResolvedValue(POST);
    updatePostVariants.mockReset().mockResolvedValue(undefined);
    getPositioningProfile.mockReset().mockResolvedValue(PROFILE);
    generateText.mockReset().mockResolvedValue("novo texto regenerado");
    getQuotaStatus.mockReset();
    recordUsage.mockReset().mockResolvedValue({ id: "e1" });
  });

  it("bloqueia sem chamar o LLM quando quota esgotada", async () => {
    getQuotaStatus.mockResolvedValue({ used: 20, limit: 20, remaining: 0 });

    const result = await regenerateVariantAction("post-1", "Direto ao ponto");

    expect(result).toEqual({
      ok: false,
      error: "Você atingiu o limite diário de regenerações. Volte amanhã.",
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(updatePostVariants).not.toHaveBeenCalled();
  });

  it("regenera e registra uso quando há quota", async () => {
    getQuotaStatus.mockResolvedValue({ used: 2, limit: 20, remaining: 18 });

    const result = await regenerateVariantAction("post-1", "Direto ao ponto");

    expect(result).toEqual({ ok: true, content: "novo texto regenerado" });
    expect(getQuotaStatus).toHaveBeenCalledWith("user-1", "regenerate");
    expect(recordUsage).toHaveBeenCalledWith(
      "user-1",
      "regenerate",
      expect.any(Number)
    );
  });
});
```

- [ ] **Step 2: Rodar teste, confirmar falha**

Run: `npx vitest run src/features/generate/__tests__/regenerate-quota.test.ts`
Expected: FAIL — action ainda não checa quota.

- [ ] **Step 3: Implementar quota na action**

Em `src/features/generate/regenerate.actions.ts`:

Adicionar import:

```ts
import { getQuotaStatus, recordUsage } from "@/features/usage/usage.repository";
```

Adicionar constante (junto a `DEFAULT_REGENERATE_ERROR`):

```ts
const REGENERATE_QUOTA_MESSAGE =
  "Você atingiu o limite diário de regenerações. Volte amanhã.";
```

Dentro do `try`, como PRIMEIRA instrução (antes de `getPost`):

```ts
    const quota = await getQuotaStatus(user.id, "regenerate");
    if (quota.remaining <= 0) {
      return { ok: false, error: REGENERATE_QUOTA_MESSAGE };
    }
    const startedAt = Date.now();
```

Após `await updatePostVariants(user.id, postId, newVariants);` e antes do `return { ok: true, content: newContent };`:

```ts
    try {
      await recordUsage(user.id, "regenerate", Date.now() - startedAt);
    } catch (usageError) {
      console.error(
        "[regenerateVariantAction] falha ao registrar uso:",
        usageError
      );
    }
```

- [ ] **Step 4: Rodar testes, confirmar verde**

Run: `npx vitest run src/features/generate/__tests__/regenerate-quota.test.ts`
Expected: PASS (2 testes).

Run: `npx vitest run`
Expected: suite inteira verde.

- [ ] **Step 5: tsc (task mexeu em mocks)**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 6: Commit**

```bash
git add src/features/generate/regenerate.actions.ts src/features/generate/__tests__/regenerate-quota.test.ts
git commit -m "feat(usage): daily quota gate on variant regeneration (A1)"
```

---

### Task 6: Contador de quota na tela `/generate`

**Files:**
- Modify: `app/(app)/generate/page.tsx`

**Interfaces:**
- Consumes: `getQuotaStatus` (Task 3).

- [ ] **Step 1: Exibir contador**

Em `app/(app)/generate/page.tsx`:

Adicionar import:

```tsx
import { getQuotaStatus } from "@/features/usage/usage.repository";
```

Dentro de `GeneratePage`, após `const profile = ...`:

```tsx
  const quota = profile ? await getQuotaStatus(user.id, "generate") : null;
```

No JSX, dentro da `<div className="space-y-1">` do cabeçalho, após o `<p>` existente:

```tsx
        {quota ? (
          <p className="text-[11px] uppercase tracking-[0.12em] text-pen">
            {quota.used} de {quota.limit} gerações hoje
          </p>
        ) : null}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build OK, rota `/generate` compila.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/generate/page.tsx"
git commit -m "feat(usage): daily quota counter on generate page (A1)"
```

---

### Task 7: Campo `inviteCode` no schema de signup

**Files:**
- Modify: `src/domain/auth.ts`
- Test: `src/domain/__tests__/auth.test.ts` (criar se não existir)

**Interfaces:**
- Produces: `signupSchema` passa a exigir `inviteCode: string` (trim, min 1, max 64). `SignupValues` ganha o campo. Usado nas Tasks 8 e 9.

- [ ] **Step 1: Escrever testes que falham**

Criar `src/domain/__tests__/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { signupSchema } from "@/domain/auth";

const BASE = {
  name: "Diogo",
  email: "a@a.com",
  password: "12345678",
};

describe("signupSchema — inviteCode", () => {
  it("aceita signup com código de convite", () => {
    const parsed = signupSchema.parse({ ...BASE, inviteCode: " PIA-AB12 " });
    expect(parsed.inviteCode).toBe("PIA-AB12");
  });

  it("rejeita signup sem código de convite", () => {
    expect(() => signupSchema.parse(BASE)).toThrowError(ZodError);
  });

  it("rejeita código vazio com mensagem pt-BR", () => {
    try {
      signupSchema.parse({ ...BASE, inviteCode: "  " });
      expect.unreachable("deveria ter lançado ZodError");
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues[0].message).toBe(
        "Informe o código de convite."
      );
    }
  });
});
```

- [ ] **Step 2: Rodar teste, confirmar falha**

Run: `npx vitest run src/domain/__tests__/auth.test.ts`
Expected: FAIL — `inviteCode` não existe no schema.

- [ ] **Step 3: Implementar**

Em `src/domain/auth.ts`, adicionar ao `signupSchema` (após `password`):

```ts
  inviteCode: z
    .string()
    .trim()
    .min(1, "Informe o código de convite.")
    .max(64, "Código de convite muito longo."),
```

- [ ] **Step 4: Rodar teste, confirmar verde**

Run: `npx vitest run src/domain/__tests__/auth.test.ts`
Expected: PASS (3 testes).

Nota: entre esta task e a Task 8, `npx tsc --noEmit` acusa erro em `components/auth/signup-form.tsx` (chamada da action sem `inviteCode`). Esperado — a Task 8 corrige. NÃO rodar o portão de tsc nesta task.

- [ ] **Step 5: Commit**

```bash
git add src/domain/auth.ts src/domain/__tests__/auth.test.ts
git commit -m "feat(auth): require invite code in signup schema (A2)"
```

---

### Task 8: Consumo atômico do convite no signup

**Files:**
- Modify: `src/features/auth/auth.repository.ts`
- Modify: `src/features/auth/auth.actions.ts`
- Test: `src/features/auth/__tests__/auth.repository.test.ts`

**Interfaces:**
- Consumes: `signupSchema` com `inviteCode` (Task 7); `prisma.inviteCode` (Task 1).
- Produces: `createUserWithPassword(email, password, inviteCode, name?)` — cria usuário e consome convite na mesma transação; lança `Error("Código de convite inválido.")` se código inexistente ou já usado. `signupAction` repassa `inviteCode` e expõe essa mensagem por igualdade exata.

- [ ] **Step 1: Atualizar testes (falham primeiro)**

Substituir o conteúdo de `src/features/auth/__tests__/auth.repository.test.ts` por:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const userCreate = vi.fn();
const inviteUpdateMany = vi.fn();

vi.mock("@/infra/db/prisma", () => {
  const tx = {
    user: { create: (a: unknown) => userCreate(a) },
    inviteCode: { updateMany: (a: unknown) => inviteUpdateMany(a) },
  };
  return {
    prisma: {
      user: { findUnique: (a: unknown) => findUnique(a) },
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});

import { createUserWithPassword } from "../auth.repository";

describe("createUserWithPassword", () => {
  beforeEach(() => {
    findUnique.mockReset();
    userCreate.mockReset();
    inviteUpdateMany.mockReset();
  });

  it("rejeita email já cadastrado", async () => {
    findUnique.mockResolvedValue({ id: "u1" });
    await expect(
      createUserWithPassword("a@a.com", "12345678", "PIA-AB12", "A")
    ).rejects.toThrow(/já cadastrado/i);
  });

  it("salva senha como hash, nunca em texto puro", async () => {
    findUnique.mockResolvedValue(null);
    userCreate.mockImplementation(async ({ data }: any) => ({
      id: "u1",
      email: data.email,
    }));
    inviteUpdateMany.mockResolvedValue({ count: 1 });

    await createUserWithPassword("a@a.com", "segredo123", "PIA-AB12", "A");

    const passed = userCreate.mock.calls[0][0].data.passwordHash as string;
    expect(passed).not.toBe("segredo123");
    expect(passed.length).toBeGreaterThan(20);
  });

  it("consome o convite só se ainda não usado (updateMany condicional)", async () => {
    findUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "u1", email: "a@a.com" });
    inviteUpdateMany.mockResolvedValue({ count: 1 });

    await createUserWithPassword("a@a.com", "12345678", "PIA-AB12", "A");

    expect(inviteUpdateMany).toHaveBeenCalledWith({
      where: { code: "PIA-AB12", usedById: null },
      data: { usedById: "u1", usedAt: expect.any(Date) },
    });
  });

  it("rejeita convite inválido ou já usado (count 0) com mensagem exata", async () => {
    findUnique.mockResolvedValue(null);
    userCreate.mockResolvedValue({ id: "u1", email: "a@a.com" });
    inviteUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      createUserWithPassword("a@a.com", "12345678", "PIA-USADO", "A")
    ).rejects.toThrow("Código de convite inválido.");
  });
});
```

- [ ] **Step 2: Rodar teste, confirmar falha**

Run: `npx vitest run src/features/auth/__tests__/auth.repository.test.ts`
Expected: FAIL — assinatura antiga não recebe `inviteCode`.

- [ ] **Step 3: Implementar repository**

Substituir o conteúdo de `src/features/auth/auth.repository.ts` por:

```ts
import bcrypt from "bcryptjs";
import { prisma } from "@/infra/db/prisma";

export async function createUserWithPassword(
  email: string,
  password: string,
  inviteCode: string,
  name?: string
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("Email já cadastrado.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Criação do usuário e consumo do convite são atômicos: se o código for
  // inválido ou outra requisição consumi-lo antes (count 0), a transação
  // reverte e o usuário não é criado.
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name, passwordHash },
      select: { id: true, email: true },
    });

    const consumed = await tx.inviteCode.updateMany({
      where: { code: inviteCode, usedById: null },
      data: { usedById: user.id, usedAt: new Date() },
    });

    if (consumed.count === 0) {
      throw new Error("Código de convite inválido.");
    }

    return user;
  });
}
```

- [ ] **Step 4: Atualizar a action**

Em `src/features/auth/auth.actions.ts`:

Trocar a chamada do repository:

```ts
    await createUserWithPassword(
      input.email,
      input.password,
      input.inviteCode,
      input.name
    );
```

No bloco de erros de negócio conhecidos, trocar a condição existente por:

```ts
    const KNOWN_BUSINESS_ERRORS = [
      "Email já cadastrado.",
      "Código de convite inválido.",
    ];
    if (error instanceof Error && KNOWN_BUSINESS_ERRORS.includes(error.message)) {
      return { ok: false, error: error.message };
    }
```

- [ ] **Step 5: Atualizar a chamada no formulário (mantém o tsc verde)**

Em `components/auth/signup-form.tsx`, dentro de `onSubmit`, após a leitura de `password`:

```tsx
    const inviteCode = String(formData.get("inviteCode") ?? "");
```

E trocar a chamada da action:

```tsx
      const result = await signupAction({ name, email, password, inviteCode });
```

(O campo visual entra na Task 9; sem ele, `formData.get` retorna `null` → `inviteCode` vira `""` → o schema rejeita com mensagem pt-BR. Comportamento intermediário são e seguro.)

- [ ] **Step 6: Rodar suite inteira, confirmar verde**

Run: `npx vitest run`
Expected: todos verdes.

- [ ] **Step 7: tsc (task mexeu em mocks)**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 8: Commit**

```bash
git add src/features/auth/auth.repository.ts src/features/auth/auth.actions.ts src/features/auth/__tests__/auth.repository.test.ts components/auth/signup-form.tsx
git commit -m "feat(auth): atomic invite code consumption on signup (A2)"
```

---

### Task 9: Campo de convite no formulário de signup

**Files:**
- Modify: `components/auth/signup-form.tsx`

**Interfaces:**
- Consumes: `signupAction` aceitando `inviteCode` (Task 8 — a chamada da action e a leitura do `formData` já foram atualizadas lá; esta task adiciona só o campo visual).

- [ ] **Step 1: Adicionar campo**

Em `components/auth/signup-form.tsx`, no JSX, após o `<div>` do campo senha e antes do parágrafo de erro:

```tsx
      <div className="space-y-1">
        <Label htmlFor="inviteCode">Código de convite</Label>
        <Input id="inviteCode" name="inviteCode" required />
      </div>
```

- [ ] **Step 2: Verificar build e tipos**

Run: `npx tsc --noEmit`
Expected: 0 erros.

Run: `npm run build`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add components/auth/signup-form.tsx
git commit -m "feat(auth): invite code field on signup form (A2)"
```

---

### Task 10: Script gerador de convites

**Files:**
- Create: `scripts/generate-invites.ts`

**Interfaces:**
- Consumes: `prisma.inviteCode` (Task 1).
- Produces: script CLI — `npx tsx scripts/generate-invites.ts [N]` insere N códigos (default 10) e imprime no stdout.

- [ ] **Step 1: Criar script**

Criar `scripts/generate-invites.ts`:

```ts
/**
 * Gera códigos de convite para o beta fechado.
 *
 * Uso: npx tsx scripts/generate-invites.ts [quantidade]
 * (usa o DATABASE_URL do ambiente — apontar para prod para gerar convites reais)
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma";

// Sem 0/O/1/I para o código ser fácil de digitar.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomSegment(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function buildCode(): string {
  return `PIA-${randomSegment(4)}-${randomSegment(4)}`;
}

async function main() {
  const count = Math.max(1, Number(process.argv[2]) || 10);
  const prisma = new PrismaClient();

  try {
    const codes = Array.from({ length: count }, buildCode);
    await prisma.inviteCode.createMany({
      data: codes.map((code) => ({ code })),
      skipDuplicates: true,
    });
    console.log(`${codes.length} convites gerados:`);
    for (const code of codes) {
      console.log(`  ${code}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Falha ao gerar convites:", error);
  process.exit(1);
});
```

- [ ] **Step 2: Testar contra o banco local**

Run: `npx tsx scripts/generate-invites.ts 2`
Expected: imprime "2 convites gerados:" + 2 códigos no formato `PIA-XXXX-XXXX`. Verificar no banco: `npx prisma studio` ou aceitar o stdout como evidência.

- [ ] **Step 3: tsc**

Run: `npx tsc --noEmit`
Expected: 0 erros. (Se o tsc reclamar do script fora do escopo do projeto, adicionar `scripts` ao `include` do `tsconfig.json` OU — mais simples — confirmar que o tsconfig já cobre `scripts/**` e seguir.)

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-invites.ts
git commit -m "feat(auth): invite code generator script (A2)"
```

---

### Task 11: Sentry (observabilidade)

**Files:**
- Create: `instrumentation.ts` (raiz)
- Create: `instrumentation-client.ts` (raiz)
- Create: `sentry.server.config.ts` (raiz)
- Create: `sentry.edge.config.ts` (raiz)
- Modify: `next.config.ts`

**Interfaces:**
- Produces: erros server e client capturados no Sentry quando `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` definidos; sem DSN = desligado (dev limpo).

- [ ] **Step 1: Instalar**

Run: `pnpm add @sentry/nextjs` (lockfile do projeto é `pnpm-lock.yaml`)
Expected: dependência adicionada sem erros.

- [ ] **Step 2: Criar configs**

Criar `sentry.server.config.ts`:

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  enabled: Boolean(process.env.SENTRY_DSN),
});
```

Criar `sentry.edge.config.ts`:

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
  enabled: Boolean(process.env.SENTRY_DSN),
});
```

Criar `instrumentation.ts`:

```ts
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
```

Criar `instrumentation-client.ts`:

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

- [ ] **Step 3: Envolver next.config**

Substituir o conteúdo de `next.config.ts` (hoje é um config vazio) por:

```ts
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

// Upload de source maps só acontece quando SENTRY_AUTH_TOKEN existe (CI/Vercel).
export default withSentryConfig(nextConfig, {
  silent: true,
});
```

- [ ] **Step 4: Verificar que dev/build seguem limpos sem DSN**

Run: `npm run build`
Expected: build OK, sem warnings de DSN.

Run: `npx vitest run`
Expected: suite verde (Sentry não interfere nos testes).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml instrumentation.ts instrumentation-client.ts sentry.server.config.ts sentry.edge.config.ts next.config.ts
git commit -m "feat(observability): Sentry via instrumentation, disabled without DSN (A4)"
```

---

### Task 12: Preparação de deploy — `directUrl`, `.env.example`, checklist

**Files:**
- Modify: `prisma/schema.prisma` (datasource)
- Modify: `package.json` (script `postinstall`)
- Create: `.env.example`
- Create: `docs/deploy.md`

**Interfaces:**
- Produces: projeto deployável na Vercel com Neon; checklist manual em `docs/deploy.md`.

- [ ] **Step 1: `directUrl` no datasource**

Em `prisma/schema.prisma`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

Adicionar ao `.env` local (NÃO commitar): `DIRECT_URL` com o mesmo valor do `DATABASE_URL` local.

- [ ] **Step 2: `postinstall` para gerar Prisma Client no deploy**

Em `package.json`, adicionar a `scripts`:

```json
    "postinstall": "prisma generate",
```

- [ ] **Step 3: Criar `.env.example`**

```bash
# Banco (local: docker-compose; prod: Neon — DATABASE_URL pooled, DIRECT_URL direta)
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/postia"
DIRECT_URL="postgresql://USER:PASSWORD@localhost:5432/postia"

# Auth (gerar com: npx auth secret  ou  openssl rand -base64 32)
AUTH_SECRET=""

# Gemini (runtime do produto)
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-2.5-flash"
# GEMINI_BASE_URL=""
# GEMINI_TIMEOUT_MS="120000"

# Quotas diárias do beta (defaults no código: 10 / 20)
DAILY_GENERATION_LIMIT="10"
DAILY_REGENERATION_LIMIT="20"

# Sentry (vazio = desligado)
SENTRY_DSN=""
NEXT_PUBLIC_SENTRY_DSN=""
# SENTRY_AUTH_TOKEN=""  # só no CI/Vercel, para source maps
```

Conferir os nomes contra o `.env` real do projeto (sem copiar valores) — se houver var usada no código e ausente aqui, adicionar.

- [ ] **Step 4: Escrever `docs/deploy.md`**

```markdown
# Deploy — Vercel + Neon

## 1. Neon
1. Criar projeto em https://neon.tech (região `sa-east-1` se disponível).
2. Copiar as duas connection strings: **pooled** (→ `DATABASE_URL`) e **direct** (→ `DIRECT_URL`).

## 2. Vercel
1. Importar o repo GitHub em https://vercel.com/new.
2. Framework: Next.js (auto). Build Command (override):
   `npx prisma migrate deploy && npm run build`
3. Environment Variables (Production):
   - `DATABASE_URL` (pooled do Neon)
   - `DIRECT_URL` (direct do Neon)
   - `AUTH_SECRET` (novo: `openssl rand -base64 32` — NÃO reusar o de dev)
   - `GEMINI_API_KEY`
   - `DAILY_GENERATION_LIMIT=10`, `DAILY_REGENERATION_LIMIT=20`
   - `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (projeto criado em sentry.io)
   - `SENTRY_AUTH_TOKEN` (para source maps)
4. Deploy.

## 3. Convites
Com `DATABASE_URL`/`DIRECT_URL` de prod no shell local:
`npx tsx scripts/generate-invites.ts 10`

## 4. Smoke test (a cada deploy relevante)
1. `/signup` com convite válido → conta criada, cai no onboarding.
2. `/signup` com convite repetido → "Código de convite inválido."
3. Onboarding completo → perfil salvo.
4. `/generate` → 6 variações; contador "1 de 10 gerações hoje".
5. Regenerar 1 variação → funciona.
6. Esgotar quota (ou baixar `DAILY_GENERATION_LIMIT=1` temporariamente) → mensagem de limite.
7. Forçar um erro (rota inexistente autenticada) → evento aparece no Sentry.

## Notas
- Timeout: geração LONGO usa até 120s. Em plano Vercel Hobby o limite de
  Server Action é menor — se estourar, reduzir `GEMINI_TIMEOUT_MS` e/ou
  configurar `maxDuration` na rota que dispara a action.
```

- [ ] **Step 5: Validar local**

Run: `npx prisma migrate status`
Expected: up to date (com `DIRECT_URL` no `.env` local).

Run: `npm run build`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma package.json .env.example docs/deploy.md
git commit -m "chore(deploy): directUrl, postinstall generate, env example, deploy checklist (A3)"
```

---

### Task 13: Registrar uso de LLM em onboarding e relearn

**Files:**
- Modify: `src/features/onboarding/onboarding.actions.ts`
- Modify: `src/features/positioning/relearn.actions.ts`
- Test: `src/features/onboarding/__tests__/onboarding-usage.test.ts`
- Test: `src/features/positioning/__tests__/relearn-usage.test.ts`

**Interfaces:**
- Consumes: `recordUsage` (Task 3).
- Produces: toda chamada LLM de onboarding/relearn gera `UsageEvent` (kinds `"onboarding"` / `"relearn"`), best-effort (falha no registro nunca derruba a action). Sem limite no beta — o dado fica pronto para o Marco B.

- [ ] **Step 1: Escrever testes que falham**

Criar `src/features/onboarding/__tests__/onboarding-usage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
vi.mock("@/infra/auth/require-user", () => ({
  requireUser: () => requireUser(),
}));

const getOnboarding = vi.fn();
const saveOnboarding = vi.fn();
vi.mock("../onboarding.repository", () => ({
  getOnboarding: (...a: unknown[]) => getOnboarding(...a),
  saveOnboarding: (...a: unknown[]) => saveOnboarding(...a),
}));

vi.mock("../onboarding.prompts", () => ({
  buildNextQuestionPrompt: () => "prompt",
  buildMemorySynthesisPrompt: () => "prompt",
  parseSynthesisPayload: () => ({ positioningMemory: "" }),
}));

vi.mock("@/features/positioning/positioning.repository", () => ({
  upsertPositioningProfile: vi.fn(),
}));

vi.mock("@/features/positioning/memory-version.repository", () => ({
  recordMemoryVersion: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const generateText = vi.fn();
vi.mock("@/infra/llm", () => ({
  getLlmProvider: () => ({
    generateText: (...a: unknown[]) => generateText(...a),
  }),
}));

const recordUsage = vi.fn();
vi.mock("@/features/usage/usage.repository", () => ({
  recordUsage: (...a: unknown[]) => recordUsage(...a),
}));

import { advanceOnboardingAction } from "../onboarding.actions";

describe("advanceOnboardingAction — registro de uso", () => {
  beforeEach(() => {
    requireUser.mockReset().mockResolvedValue({ id: "user-1" });
    getOnboarding.mockReset().mockResolvedValue(null);
    saveOnboarding.mockReset().mockResolvedValue(undefined);
    generateText.mockReset().mockResolvedValue("Qual seu nicho?");
    recordUsage.mockReset().mockResolvedValue({ id: "e1" });
  });

  it("registra evento onboarding após chamada LLM bem-sucedida", async () => {
    const result = await advanceOnboardingAction("minha mensagem");

    expect(result.ok).toBe(true);
    expect(recordUsage).toHaveBeenCalledWith(
      "user-1",
      "onboarding",
      expect.any(Number)
    );
  });

  it("falha no registro não derruba a action", async () => {
    recordUsage.mockRejectedValue(new Error("db down"));

    const result = await advanceOnboardingAction("minha mensagem");

    expect(result.ok).toBe(true);
  });
});
```

Criar `src/features/positioning/__tests__/relearn-usage.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUser = vi.fn();
vi.mock("@/infra/auth/require-user", () => ({
  requireUser: () => requireUser(),
}));

const getPositioningProfile = vi.fn();
const updatePositioningMemory = vi.fn();
vi.mock("../positioning.repository", () => ({
  getPositioningProfile: (...a: unknown[]) => getPositioningProfile(...a),
  updatePositioningMemory: (...a: unknown[]) => updatePositioningMemory(...a),
}));

vi.mock("../memory-version.repository", () => ({
  recordMemoryVersion: vi.fn(),
}));

vi.mock("../relearn.prompts", () => ({
  buildRelearnPrompt: () => "prompt",
}));

const listUnprocessedFeedback = vi.fn();
const markFeedbackProcessed = vi.fn();
vi.mock("@/features/feedback/feedback.repository", () => ({
  listUnprocessedFeedback: (...a: unknown[]) => listUnprocessedFeedback(...a),
  markFeedbackProcessed: (...a: unknown[]) => markFeedbackProcessed(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const generateText = vi.fn();
vi.mock("@/infra/llm", () => ({
  getLlmProvider: () => ({
    generateText: (...a: unknown[]) => generateText(...a),
  }),
}));

const recordUsage = vi.fn();
vi.mock("@/features/usage/usage.repository", () => ({
  recordUsage: (...a: unknown[]) => recordUsage(...a),
}));

import { relearnPositioningAction } from "../relearn.actions";

describe("relearnPositioningAction — registro de uso", () => {
  beforeEach(() => {
    requireUser.mockReset().mockResolvedValue({ id: "user-1" });
    getPositioningProfile
      .mockReset()
      .mockResolvedValue({ positioningMemory: "memória atual" });
    updatePositioningMemory.mockReset().mockResolvedValue(undefined);
    listUnprocessedFeedback.mockReset().mockResolvedValue([{ id: "f1" }]);
    markFeedbackProcessed.mockReset().mockResolvedValue(undefined);
    generateText.mockReset().mockResolvedValue("nova memória");
    recordUsage.mockReset().mockResolvedValue({ id: "e1" });
  });

  it("registra evento relearn após chamada LLM bem-sucedida", async () => {
    const result = await relearnPositioningAction();

    expect(result).toEqual({ ok: true, updated: true });
    expect(recordUsage).toHaveBeenCalledWith(
      "user-1",
      "relearn",
      expect.any(Number)
    );
  });

  it("sem feedbacks não chama LLM nem registra uso", async () => {
    listUnprocessedFeedback.mockResolvedValue([]);

    const result = await relearnPositioningAction();

    expect(result).toEqual({ ok: true, updated: false });
    expect(generateText).not.toHaveBeenCalled();
    expect(recordUsage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar testes, confirmar falha**

Run: `npx vitest run src/features/onboarding/__tests__/onboarding-usage.test.ts src/features/positioning/__tests__/relearn-usage.test.ts`
Expected: FAIL — `recordUsage` nunca é chamado.

- [ ] **Step 3: Implementar registro nas actions**

Em `src/features/onboarding/onboarding.actions.ts`:

Adicionar import:

```ts
import { recordUsage } from "@/features/usage/usage.repository";
```

Adicionar helper no topo do arquivo (após a constante `READY`):

```ts
const recordOnboardingUsage = async (userId: string, durationMs: number) => {
  try {
    await recordUsage(userId, "onboarding", durationMs);
  } catch (usageError) {
    console.error("[onboarding] falha ao registrar uso:", usageError);
  }
};
```

Em `advanceOnboardingAction`, envolver a chamada LLM existente:

```ts
    const llmStartedAt = Date.now();
    const rawResponse = (await provider.generateText(buildNextQuestionPrompt(messages), {
      maxTokens: 256,
      timeoutMs: 30000,
    })).trim();
    await recordOnboardingUsage(user.id, Date.now() - llmStartedAt);
```

Em `finishOnboardingAction`, envolver a chamada LLM existente:

```ts
    const llmStartedAt = Date.now();
    const raw = await provider.generateText(buildMemorySynthesisPrompt(messages), {
      maxTokens: 700,
      timeoutMs: 60000,
    });
    await recordOnboardingUsage(user.id, Date.now() - llmStartedAt);
```

Em `src/features/positioning/relearn.actions.ts`:

Adicionar import:

```ts
import { recordUsage } from "@/features/usage/usage.repository";
```

Envolver a chamada LLM existente:

```ts
    const llmStartedAt = Date.now();
    const newMemory = (
      await provider.generateText(buildRelearnPrompt(profile.positioningMemory, feedbacks), {
        maxTokens: 700,
        timeoutMs: 60000,
      })
    ).trim();
    try {
      await recordUsage(user.id, "relearn", Date.now() - llmStartedAt);
    } catch (usageError) {
      console.error("[relearnPositioningAction] falha ao registrar uso:", usageError);
    }
```

- [ ] **Step 4: Rodar testes, confirmar verde**

Run: `npx vitest run src/features/onboarding/__tests__/onboarding-usage.test.ts src/features/positioning/__tests__/relearn-usage.test.ts`
Expected: PASS (4 testes).

Run: `npx vitest run`
Expected: suite inteira verde.

- [ ] **Step 5: tsc (task mexeu em mocks)**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 6: Commit**

```bash
git add src/features/onboarding/onboarding.actions.ts src/features/positioning/relearn.actions.ts src/features/onboarding/__tests__/onboarding-usage.test.ts src/features/positioning/__tests__/relearn-usage.test.ts
git commit -m "feat(usage): record LLM usage on onboarding and relearn (A1/A4)"
```

---

### Task 14: Portões finais do marco

**Files:** nenhum novo (verificação).

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: todos os testes verdes (base 57 + novos deste marco).

- [ ] **Step 2: Tipos**

Run: `npx tsc --noEmit`
Expected: 0 erros.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: OK.

- [ ] **Step 4: Migrations**

Run: `npx prisma migrate status`
Expected: "Database schema is up to date!"

- [ ] **Step 5: Review whole-branch**

Rodar review da branch inteira (opus ou `/code-review`), triagem dos achados, fixes.

- [ ] **Step 6: Deploy manual (com o usuário)**

Seguir `docs/deploy.md` — setup Neon + Vercel + Sentry é ação manual do usuário (contas dele). Depois: gerar convites, rodar o smoke test do checklist em produção.
