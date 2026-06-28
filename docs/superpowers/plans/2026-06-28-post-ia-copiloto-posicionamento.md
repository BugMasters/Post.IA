# Post.IA Co-piloto de Posicionamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o Post.IA num co-piloto de conteúdo que aprende o posicionamento do usuário via onboarding conversacional e loop de feedback, com auth real, histórico de posts e landing de captação.

**Architecture:** Next.js 16 App Router com Server Actions, Prisma/PostgreSQL e Gemini (via abstração `LlmProvider`). Os modelos rígidos `AuthorProfile` e `Briefing` são fundidos num documento vivo `PositioningProfile` cujo campo `positioningMemory` é lido antes de cada geração e reescrito em lote a partir do feedback. Auth.js v5 com Credentials e sessão JWT (sem tabelas de adapter).

**Tech Stack:** TypeScript, Next.js 16, React 19, Prisma 6, PostgreSQL, Auth.js v5 (next-auth), bcryptjs, Zod 4, Gemini API, Vitest.

## Global Constraints

- **IA gratuita apenas.** Provider padrão `gemini` (`gemini-2.5-flash`) via `getLlmProvider()`. Nunca adicionar provider pago. Manter a interface `LlmProvider` intacta para troca futura.
- **Multi-tenant correto.** Toda query Prisma filtra por `userId`. Nenhuma rota logada acessível sem sessão.
- **Validação Zod** em toda server action, antes de tocar o banco.
- **Economia de cota.** Reaprendizado roda em lote, nunca por clique. Constante `LEARNING_THRESHOLD = 3`. Onboarding limitado a `MAX_ONBOARDING_TURNS = 6`.
- **Idioma:** UI e copy em português (Brasil), com acentuação correta. `lang="pt-BR"`.
- **Padrão de pastas:** `src/domain/` (tipos + Zod), `src/features/<x>/` (actions + repository), `src/infra/` (llm, db, auth), `app/` (rotas). Import alias `@/*` resolve `./src/*` e `./*`.
- **Commits frequentes** ao fim de cada task.

---

## Milestones

- **M1 — Fundações:** auth real, modelo de dados novo, limpeza de dívida, casca de produto (nav, home, metadata).
- **M2 — Onboarding conversacional:** chat multi-turno que sintetiza o `positioningMemory`.
- **M3 — Geração + feedback + aprendizado:** gerar usando a memória, salvar posts, coletar feedback, reaprender em lote.
- **M4 — Landing + waitlist:** página pública e captura de email.

Cada milestone termina em software funcional e testável.

---

# M1 — Fundações

### Task 1: Setup de testes (Vitest)

**Files:**
- Create: `vitest.config.ts`
- Create: `src/domain/__tests__/sanity.test.ts`
- Modify: `package.json` (scripts + devDependencies)

**Interfaces:**
- Produces: comando `pnpm test` rodando Vitest em modo run.

- [ ] **Step 1: Instalar Vitest**

Run: `pnpm add -D vitest @vitest/coverage-v8`
Expected: pacotes adicionados ao `devDependencies`.

- [ ] **Step 2: Criar `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Adicionar script de teste ao `package.json`**

No bloco `"scripts"`, adicionar:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Escrever teste de sanidade**

```ts
// src/domain/__tests__/sanity.test.ts
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("roda o vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Rodar e verificar verde**

Run: `pnpm test`
Expected: PASS, 1 teste.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml src/domain/__tests__/sanity.test.ts
git commit -m "chore: add vitest test setup"
```

---

### Task 2: Modelo de dados novo (Prisma)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: migration via CLI

**Interfaces:**
- Produces: modelos `PositioningProfile`, `OnboardingConversation`, `Post`, `PostFeedback`, `WaitlistEntry`; campo `User.passwordHash`. Remove `AuthorProfile` e `Briefing`.

- [ ] **Step 1: Reescrever os modelos no `schema.prisma`**

Substituir os modelos `User`, `AuthorProfile` e `Briefing` por:

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String?
  passwordHash String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  positioning  PositioningProfile?
  onboarding   OnboardingConversation?
  posts        Post[]
  feedbacks    PostFeedback[]
}

model PositioningProfile {
  id                String   @id @default(cuid())
  userId            String   @unique
  niche             String   @default("")
  audience          String   @default("")
  offer             String   @default("")
  differentiation   String   @default("")
  tonePreference    String   @default("")
  ctaPreference     String   @default("")
  positioningMemory String   @default("")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model OnboardingConversation {
  id        String   @id @default(cuid())
  userId    String   @unique
  messages  Json     @default("[]")
  status    String   @default("in_progress")
  turnCount Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Post {
  id        String   @id @default(cuid())
  userId    String
  theme     String
  platform  String
  length    String
  objective String
  variants  Json
  createdAt DateTime @default(now())

  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  feedbacks PostFeedback[]

  @@index([userId])
}

model PostFeedback {
  id            String   @id @default(cuid())
  userId        String
  postId        String
  variantLabel  String
  signal        String
  editedContent String?
  note          String?
  processed     Boolean  @default(false)
  createdAt     DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  post Post @relation(fields: [postId], references: [id], onDelete: Cascade)

  @@index([userId, processed])
}

model WaitlistEntry {
  id        String   @id @default(cuid())
  email     String   @unique
  createdAt DateTime @default(now())
}
```

- [ ] **Step 2: Gerar a migration e o client**

Run: `pnpm prisma migrate dev --name copilot_positioning_model`
Expected: nova migration criada em `prisma/migrations/`, client regenerado em `src/generated/prisma`, sem erros.

- [ ] **Step 3: Verificar que o client compila**

Run: `pnpm prisma generate`
Expected: "Generated Prisma Client" sem erros.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): fuse profile+briefing into PositioningProfile, add Post/Feedback/Waitlist"
```

---

### Task 3: Auth.js — configuração base

**Files:**
- Create: `src/infra/auth/auth.config.ts`
- Create: `src/infra/auth/index.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `auth()` (server, retorna sessão com `user.id`), `signIn`, `signOut`, handlers `GET`/`POST`. Constante de sessão JWT.

- [ ] **Step 1: Instalar dependências**

Run: `pnpm add next-auth@beta bcryptjs && pnpm add -D @types/bcryptjs`
Expected: `next-auth` e `bcryptjs` adicionados.

- [ ] **Step 2: Adicionar variáveis ao `.env.example`**

Acrescentar ao final:

```
AUTH_SECRET="gere-com: npx auth secret"
AUTH_TRUST_HOST="true"
```

- [ ] **Step 3: Criar `auth.config.ts` (Credentials + JWT)**

```ts
// src/infra/auth/auth.config.ts
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { prisma } from "@/infra/db/prisma";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) token.id = user.id;
      return token;
    },
    session: ({ session, token }) => {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },
};
```

- [ ] **Step 4: Criar `index.ts` do auth**

```ts
// src/infra/auth/index.ts
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
```

- [ ] **Step 5: Criar a route handler**

```ts
// app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/infra/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 6: Estender o tipo de sessão**

```ts
// src/infra/auth/next-auth.d.ts
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}
```

- [ ] **Step 7: Verificar build de tipos**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros relacionados a auth.

- [ ] **Step 8: Commit**

```bash
git add src/infra/auth app/api/auth .env.example package.json pnpm-lock.yaml
git commit -m "feat(auth): add Auth.js credentials with JWT session"
```

---

### Task 4: Signup + cadastro de usuário

**Files:**
- Create: `src/domain/auth.ts`
- Create: `src/features/auth/auth.repository.ts`
- Create: `src/features/auth/auth.actions.ts`
- Create: `src/features/auth/__tests__/auth.repository.test.ts`

**Interfaces:**
- Consumes: `prisma`, `bcrypt`.
- Produces: `signupSchema`, `loginSchema` (domain); `createUserWithPassword(email, password, name?)` → `{ id, email }`; `signupAction(values)` → `{ ok: true } | { ok: false; error }`.

- [ ] **Step 1: Escrever schemas de auth**

```ts
// src/domain/auth.ts
import { z } from "zod";

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome."),
  email: z.string().email("Email inválido."),
  password: z.string().min(8, "Senha precisa de ao menos 8 caracteres."),
});

export const loginSchema = z.object({
  email: z.string().email("Email inválido."),
  password: z.string().min(8, "Senha precisa de ao menos 8 caracteres."),
});

export type SignupValues = z.infer<typeof signupSchema>;
export type LoginValues = z.infer<typeof loginSchema>;
```

- [ ] **Step 2: Escrever o teste do repository (hash + unicidade)**

```ts
// src/features/auth/__tests__/auth.repository.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();

vi.mock("@/infra/db/prisma", () => ({
  prisma: { user: { findUnique: (a: unknown) => findUnique(a), create: (a: unknown) => create(a) } },
}));

import { createUserWithPassword } from "../auth.repository";

describe("createUserWithPassword", () => {
  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
  });

  it("rejeita email já cadastrado", async () => {
    findUnique.mockResolvedValue({ id: "u1" });
    await expect(
      createUserWithPassword("a@a.com", "12345678", "A")
    ).rejects.toThrow(/já cadastrado/i);
  });

  it("salva senha como hash, nunca em texto puro", async () => {
    findUnique.mockResolvedValue(null);
    create.mockImplementation(async ({ data }: any) => ({ id: "u1", email: data.email }));

    await createUserWithPassword("a@a.com", "segredo123", "A");

    const passed = create.mock.calls[0][0].data.passwordHash as string;
    expect(passed).not.toBe("segredo123");
    expect(passed.length).toBeGreaterThan(20);
  });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `pnpm test src/features/auth`
Expected: FAIL (`createUserWithPassword` não existe).

- [ ] **Step 4: Implementar o repository**

```ts
// src/features/auth/auth.repository.ts
import bcrypt from "bcryptjs";
import { prisma } from "@/infra/db/prisma";

export async function createUserWithPassword(
  email: string,
  password: string,
  name?: string
) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error("Email já cadastrado.");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.create({
    data: { email, name, passwordHash },
  });
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm test src/features/auth`
Expected: PASS.

- [ ] **Step 6: Implementar a server action de signup**

```ts
// src/features/auth/auth.actions.ts
"use server";

import { ZodError } from "zod";
import { signupSchema, type SignupValues } from "@/domain/auth";
import { createUserWithPassword } from "./auth.repository";

export type SignupResult = { ok: true } | { ok: false; error: string };

export async function signupAction(values: SignupValues): Promise<SignupResult> {
  try {
    const input = signupSchema.parse(values);
    await createUserWithPassword(input.email, input.password, input.name);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    const message = error instanceof Error ? error.message : "Erro ao cadastrar.";
    return { ok: false, error: message };
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/domain/auth.ts src/features/auth
git commit -m "feat(auth): add signup action with hashed password"
```

---

### Task 5: Telas de login e signup + guard de sessão

**Files:**
- Create: `src/infra/auth/require-user.ts`
- Create: `app/login/page.tsx`
- Create: `app/signup/page.tsx`
- Create: `components/auth/login-form.tsx`
- Create: `components/auth/signup-form.tsx`

**Interfaces:**
- Consumes: `auth()`, `signupAction`, `signIn`.
- Produces: `requireUser()` → `{ id: string; email: string }` (redireciona a `/login` se sem sessão).

- [ ] **Step 1: Criar o guard `requireUser`**

```ts
// src/infra/auth/require-user.ts
import { redirect } from "next/navigation";
import { auth } from "@/infra/auth";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return { id: session.user.id, email: session.user.email ?? "" };
}
```

- [ ] **Step 2: Criar o form de signup (client)**

```tsx
// components/auth/signup-form.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

import { signupAction } from "@/features/auth/auth.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignupForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    startTransition(async () => {
      setError(null);
      const result = await signupAction({ name, email, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const login = await signIn("credentials", { email, password, redirect: false });
      if (login?.error) {
        setError("Conta criada. Faça login.");
        router.push("/login");
        return;
      }
      router.push("/onboarding");
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="name">Nome</Label>
        <Input id="name" name="name" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">Senha</Label>
        <Input id="password" name="password" type="password" minLength={8} required />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Criando..." : "Criar conta"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Criar o form de login (client)**

```tsx
// components/auth/login-form.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    startTransition(async () => {
      setError(null);
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError("Email ou senha inválidos.");
        return;
      }
      router.push("/dashboard");
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">Senha</Label>
        <Input id="password" name="password" type="password" required />
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Criar as páginas**

```tsx
// app/login/page.tsx
import Link from "next/link";
import LoginForm from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Entrar no Post.IA</h1>
      <LoginForm />
      <p className="text-sm text-muted-foreground">
        Não tem conta? <Link className="underline" href="/signup">Criar conta</Link>
      </p>
    </main>
  );
}
```

```tsx
// app/signup/page.tsx
import Link from "next/link";
import SignupForm from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Criar conta no Post.IA</h1>
      <SignupForm />
      <p className="text-sm text-muted-foreground">
        Já tem conta? <Link className="underline" href="/login">Entrar</Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Adicionar SessionProvider ao layout raiz**

Em `app/layout.tsx`, envolver `{children}` com o provider do next-auth. Criar `components/auth/session-provider.tsx`:

```tsx
// components/auth/session-provider.tsx
"use client";
import { SessionProvider } from "next-auth/react";
export default function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

- [ ] **Step 6: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/infra/auth/require-user.ts app/login app/signup components/auth
git commit -m "feat(auth): add login/signup pages and session guard"
```

---

### Task 6: Substituir devUser pelo usuário de sessão

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `app/generate/page.tsx`
- Modify: `src/features/generate/generate.actions.ts:510`
- Delete: `src/infra/dev/devUser.ts`
- Delete: `src/features/generate/mockGenerator.ts`

**Interfaces:**
- Consumes: `requireUser()`.

- [ ] **Step 1: Trocar `ensureDevUser` por `requireUser` em todas as páginas/actions**

Em cada arquivo que importa `ensureDevUser`, substituir:

```ts
import { ensureDevUser } from "@/infra/dev/devUser";
const user = await ensureDevUser();
```

por:

```ts
import { requireUser } from "@/infra/auth/require-user";
const user = await requireUser();
```

Arquivos a alterar: `app/dashboard/page.tsx`, `app/generate/page.tsx`, `app/profile/page.tsx`, `app/briefing/page.tsx`, `src/features/generate/generate.actions.ts`, `src/features/briefing/briefing.actions.ts`, `src/features/profile/profile.actions.server.ts`.

- [ ] **Step 2: Remover código morto**

Run: `git rm src/infra/dev/devUser.ts src/features/generate/mockGenerator.ts`
Expected: arquivos removidos.

- [ ] **Step 3: Buscar referências órfãs**

Run: `git grep -n "ensureDevUser\|mockGenerator"`
Expected: nenhuma ocorrência.

- [ ] **Step 4: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: replace devUser with session user, drop dead code"
```

---

### Task 7: Casca de produto — home, metadata, navegação

**Files:**
- Modify: `app/layout.tsx`
- Create: `components/layout/app-header.tsx`
- Create: `app/(app)/layout.tsx` (layout das rotas logadas com header)

**Interfaces:**
- Consumes: `auth()`, `signOut`.

> Nota: este passo move as rotas logadas para um route group `(app)` que injeta o header. Mover `dashboard`, `generate`, `briefing`/`posicionamento`, `profile`, `onboarding` para `app/(app)/`. A URL não muda (route groups não afetam o path).

- [ ] **Step 1: Corrigir metadata e lang no layout raiz**

```tsx
// app/layout.tsx — substituir metadata e <html lang>
export const metadata: Metadata = {
  title: "Post.IA — seu co-piloto de conteúdo",
  description:
    "Posts que soam como você e vendem você. Quanto mais você usa, melhor fica.",
};
// ...
<html lang="pt-BR">
```

Manter o `AuthSessionProvider` envolvendo `{children}` (da Task 5).

- [ ] **Step 2: Criar o header logado**

```tsx
// components/layout/app-header.tsx
import Link from "next/link";
import { signOut } from "@/infra/auth";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/generate", label: "Gerar" },
  { href: "/posts", label: "Histórico" },
  { href: "/posicionamento", label: "Posicionamento" },
];

export default function AppHeader() {
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-4xl items-center justify-between p-4">
        <Link href="/dashboard" className="font-semibold">Post.IA</Link>
        <div className="flex items-center gap-4 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground">
              {l.label}
            </Link>
          ))}
          <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
            <Button variant="outline" size="sm" type="submit">Sair</Button>
          </form>
        </div>
      </nav>
    </header>
  );
}
```

- [ ] **Step 3: Criar o layout do grupo `(app)` e mover as rotas**

Mover `app/dashboard`, `app/generate`, `app/profile` para dentro de `app/(app)/`. Criar:

```tsx
// app/(app)/layout.tsx
import AppHeader from "@/components/layout/app-header";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <AppHeader />
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Substituir a home template do Next por um redirect simples (placeholder até a landing da M4)**

```tsx
// app/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/infra/auth";

export default async function Home() {
  const session = await auth();
  redirect(session?.user?.id ? "/dashboard" : "/login");
}
```

- [ ] **Step 5: Verificar tipos e rotas**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ui): app shell with header, fix metadata/lang, replace template home"
```

---

# M2 — Onboarding conversacional

### Task 8: Domínio e prompts do onboarding

**Files:**
- Create: `src/domain/onboarding.ts`
- Create: `src/features/onboarding/onboarding.prompts.ts`
- Create: `src/domain/__tests__/onboarding.test.ts`

**Interfaces:**
- Produces: tipo `ChatMessage = { role: "assistant" | "user"; content: string }`; `MAX_ONBOARDING_TURNS = 6`; `chatMessagesSchema`; `buildOnboardingSystemPrompt()`; `buildMemorySynthesisPrompt(messages)`; `parseSynthesisPayload(raw)` → `PositioningSeed`.

- [ ] **Step 1: Escrever o domínio**

```ts
// src/domain/onboarding.ts
import { z } from "zod";

export const MAX_ONBOARDING_TURNS = 6;

export const chatMessageSchema = z.object({
  role: z.enum(["assistant", "user"]),
  content: z.string().min(1),
});
export const chatMessagesSchema = z.array(chatMessageSchema);
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const positioningSeedSchema = z.object({
  niche: z.string().default(""),
  audience: z.string().default(""),
  offer: z.string().default(""),
  differentiation: z.string().default(""),
  tonePreference: z.string().default(""),
  ctaPreference: z.string().default(""),
  positioningMemory: z.string().min(1),
});
export type PositioningSeed = z.infer<typeof positioningSeedSchema>;
```

- [ ] **Step 2: Escrever o teste do parser de síntese**

```ts
// src/domain/__tests__/onboarding.test.ts
import { describe, it, expect } from "vitest";
import { parseSynthesisPayload } from "@/features/onboarding/onboarding.prompts";

describe("parseSynthesisPayload", () => {
  it("extrai JSON mesmo com cercas de código", () => {
    const raw = '```json\n{"niche":"Dev","audience":"CTOs","offer":"mentoria","differentiation":"x","tonePreference":"direto","ctaPreference":"Direct","positioningMemory":"Resumo vivo."}\n```';
    const seed = parseSynthesisPayload(raw);
    expect(seed.niche).toBe("Dev");
    expect(seed.positioningMemory).toContain("Resumo");
  });

  it("lança erro se positioningMemory vazio", () => {
    const raw = '{"positioningMemory":""}';
    expect(() => parseSynthesisPayload(raw)).toThrow();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test src/domain/__tests__/onboarding.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 4: Implementar prompts + parser**

```ts
// src/features/onboarding/onboarding.prompts.ts
import {
  chatMessagesSchema,
  positioningSeedSchema,
  type ChatMessage,
  type PositioningSeed,
} from "@/domain/onboarding";

export function buildOnboardingSystemPrompt(): string {
  return [
    "Você é um estrategista de marca pessoal entrevistando um expert.",
    "Objetivo: entender nicho, público, oferta, diferencial, tom e como ele quer ser percebido.",
    "Faça UMA pergunta por vez, curta e em português. Adapte pela resposta anterior.",
    "Não repita perguntas já respondidas. Seja caloroso e objetivo.",
    "Quando tiver contexto suficiente, responda apenas com: [PRONTO]",
  ].join("\n");
}

export function buildNextQuestionPrompt(messages: ChatMessage[]): string {
  const history = messages
    .map((m) => `${m.role === "assistant" ? "ENTREVISTADOR" : "EXPERT"}: ${m.content}`)
    .join("\n");
  return `${buildOnboardingSystemPrompt()}\n\nHistórico:\n${history}\n\nPróxima pergunta (ou [PRONTO]):`;
}

export function buildMemorySynthesisPrompt(messages: ChatMessage[]): string {
  const history = messages
    .map((m) => `${m.role === "assistant" ? "ENTREVISTADOR" : "EXPERT"}: ${m.content}`)
    .join("\n");
  return [
    "Com base na entrevista abaixo, sintetize o posicionamento do expert.",
    'Retorne APENAS JSON: {"niche","audience","offer","differentiation","tonePreference","ctaPreference","positioningMemory"}.',
    'O campo "positioningMemory" é um resumo denso em markdown (8-15 linhas) que outra IA usará para escrever posts na voz dessa pessoa.',
    "",
    history,
  ].join("\n");
}

const cleanup = (raw: string) =>
  raw.replace(/```(?:json)?/gi, "").trim();

export function parseSynthesisPayload(raw: string): PositioningSeed {
  const cleaned = cleanup(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Síntese sem JSON válido.");
  const parsed = JSON.parse(match[0]);
  return positioningSeedSchema.parse(parsed);
}

export { chatMessagesSchema };
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test src/domain/__tests__/onboarding.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/onboarding.ts src/features/onboarding/onboarding.prompts.ts src/domain/__tests__/onboarding.test.ts
git commit -m "feat(onboarding): add domain schemas and conversation prompts"
```

---

### Task 9: Repository e actions do onboarding

**Files:**
- Create: `src/features/onboarding/onboarding.repository.ts`
- Create: `src/features/positioning/positioning.repository.ts`
- Create: `src/features/onboarding/onboarding.actions.ts`

**Interfaces:**
- Consumes: `requireUser()`, `getLlmProvider()`, prompts da Task 8.
- Produces: `getOnboarding(userId)`, `saveOnboarding(userId, messages, status, turnCount)`; `upsertPositioningProfile(userId, seed)`, `getPositioningProfile(userId)`; actions `advanceOnboardingAction(userMessage)` → `{ done: boolean; question?: string }` e `finishOnboardingAction()` → `{ ok: true } | { ok: false; error }`.

- [ ] **Step 1: Repository do onboarding**

```ts
// src/features/onboarding/onboarding.repository.ts
import { prisma } from "@/infra/db/prisma";
import { chatMessagesSchema, type ChatMessage } from "@/domain/onboarding";

export async function getOnboarding(userId: string) {
  return prisma.onboardingConversation.findUnique({ where: { userId } });
}

export async function saveOnboarding(
  userId: string,
  messages: ChatMessage[],
  status: "in_progress" | "completed",
  turnCount: number
) {
  const data = { messages: chatMessagesSchema.parse(messages), status, turnCount };
  return prisma.onboardingConversation.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
```

- [ ] **Step 2: Repository do posicionamento**

```ts
// src/features/positioning/positioning.repository.ts
import { prisma } from "@/infra/db/prisma";
import type { PositioningSeed } from "@/domain/onboarding";

export async function getPositioningProfile(userId: string) {
  return prisma.positioningProfile.findUnique({ where: { userId } });
}

export async function upsertPositioningProfile(userId: string, seed: PositioningSeed) {
  return prisma.positioningProfile.upsert({
    where: { userId },
    create: { userId, ...seed },
    update: seed,
  });
}

export async function updatePositioningMemory(userId: string, positioningMemory: string) {
  return prisma.positioningProfile.update({
    where: { userId },
    data: { positioningMemory },
  });
}
```

- [ ] **Step 3: Actions do onboarding**

```ts
// src/features/onboarding/onboarding.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/infra/auth/require-user";
import { getLlmProvider } from "@/infra/llm";
import {
  MAX_ONBOARDING_TURNS,
  type ChatMessage,
} from "@/domain/onboarding";
import {
  buildNextQuestionPrompt,
  buildMemorySynthesisPrompt,
  parseSynthesisPayload,
} from "./onboarding.prompts";
import { getOnboarding, saveOnboarding } from "./onboarding.repository";
import { upsertPositioningProfile } from "@/features/positioning/positioning.repository";

const READY = "[PRONTO]";

export type AdvanceResult =
  | { ok: true; done: boolean; question?: string }
  | { ok: false; error: string };

export async function advanceOnboardingAction(userMessage: string): Promise<AdvanceResult> {
  try {
    const user = await requireUser();
    const existing = await getOnboarding(user.id);
    const history: ChatMessage[] = (existing?.messages as ChatMessage[] | undefined) ?? [];

    const messages: ChatMessage[] = userMessage.trim()
      ? [...history, { role: "user", content: userMessage.trim() }]
      : history;

    const turnCount = (existing?.turnCount ?? 0) + (userMessage.trim() ? 1 : 0);

    if (turnCount >= MAX_ONBOARDING_TURNS) {
      await saveOnboarding(user.id, messages, "in_progress", turnCount);
      return { ok: true, done: true };
    }

    const provider = getLlmProvider();
    const raw = (await provider.generateText(buildNextQuestionPrompt(messages), {
      maxTokens: 200,
      timeoutMs: 30000,
    })).trim();

    if (raw.includes(READY)) {
      await saveOnboarding(user.id, messages, "in_progress", turnCount);
      return { ok: true, done: true };
    }

    const withQuestion: ChatMessage[] = [...messages, { role: "assistant", content: raw }];
    await saveOnboarding(user.id, withQuestion, "in_progress", turnCount);
    return { ok: true, done: false, question: raw };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro no onboarding.";
    return { ok: false, error: message };
  }
}

export type FinishResult = { ok: true } | { ok: false; error: string };

export async function finishOnboardingAction(): Promise<FinishResult> {
  try {
    const user = await requireUser();
    const existing = await getOnboarding(user.id);
    const messages = (existing?.messages as ChatMessage[] | undefined) ?? [];
    if (messages.length === 0) {
      return { ok: false, error: "Conversa vazia." };
    }

    const provider = getLlmProvider();
    const raw = await provider.generateText(buildMemorySynthesisPrompt(messages), {
      maxTokens: 700,
      timeoutMs: 60000,
    });
    const seed = parseSynthesisPayload(raw);

    await upsertPositioningProfile(user.id, seed);
    await saveOnboarding(user.id, messages, "completed", existing?.turnCount ?? messages.length);

    revalidatePath("/dashboard");
    revalidatePath("/posicionamento");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao concluir onboarding.";
    return { ok: false, error: message };
  }
}
```

- [ ] **Step 4: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/features/onboarding src/features/positioning
git commit -m "feat(onboarding): conversation actions + positioning synthesis"
```

---

### Task 10: Tela de onboarding (chat)

**Files:**
- Create: `app/(app)/onboarding/page.tsx`
- Create: `components/onboarding/onboarding-chat.tsx`

**Interfaces:**
- Consumes: `requireUser()`, `getOnboarding`, `advanceOnboardingAction`, `finishOnboardingAction`.

- [ ] **Step 1: Página servidor (carrega estado e a 1ª pergunta)**

```tsx
// app/(app)/onboarding/page.tsx
import { redirect } from "next/navigation";
import { requireUser } from "@/infra/auth/require-user";
import { getOnboarding } from "@/features/onboarding/onboarding.repository";
import { getPositioningProfile } from "@/features/positioning/positioning.repository";
import OnboardingChat from "@/components/onboarding/onboarding-chat";
import type { ChatMessage } from "@/domain/onboarding";

export default async function OnboardingPage() {
  const user = await requireUser();
  const profile = await getPositioningProfile(user.id);
  if (profile) redirect("/dashboard");

  const existing = await getOnboarding(user.id);
  const messages = (existing?.messages as ChatMessage[] | undefined) ?? [];

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Vamos te conhecer</h1>
        <p className="text-sm text-muted-foreground">
          Responda em conversa. No fim, monto seu posicionamento.
        </p>
      </div>
      <OnboardingChat initialMessages={messages} />
    </main>
  );
}
```

- [ ] **Step 2: Componente de chat (client)**

```tsx
// components/onboarding/onboarding-chat.tsx
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  advanceOnboardingAction,
  finishOnboardingAction,
} from "@/features/onboarding/onboarding.actions";
import type { ChatMessage } from "@/domain/onboarding";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function OnboardingChat({ initialMessages }: { initialMessages: ChatMessage[] }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const started = useRef(false);

  const advance = (userMessage: string) =>
    startTransition(async () => {
      setError(null);
      const result = await advanceOnboardingAction(userMessage);
      if (!result.ok) return setError(result.error);
      if (result.question) {
        setMessages((m) => [
          ...m,
          ...(userMessage ? [{ role: "user" as const, content: userMessage }] : []),
          { role: "assistant" as const, content: result.question! },
        ]);
      } else if (userMessage) {
        setMessages((m) => [...m, { role: "user", content: userMessage }]);
      }
      if (result.done) setDone(true);
    });

  // dispara a 1ª pergunta se a conversa está vazia
  useEffect(() => {
    if (!started.current && messages.length === 0) {
      started.current = true;
      advance("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () => {
    if (!input.trim()) return;
    const value = input.trim();
    setInput("");
    advance(value);
  };

  const finish = () =>
    startTransition(async () => {
      setError(null);
      const result = await finishOnboardingAction();
      if (!result.ok) return setError(result.error);
      router.push("/dashboard");
    });

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border p-4">
        {messages.map((m, i) => (
          <p key={i} className={m.role === "assistant" ? "text-foreground" : "text-muted-foreground"}>
            <strong>{m.role === "assistant" ? "Post.IA: " : "Você: "}</strong>
            {m.content}
          </p>
        ))}
        {pending ? <p className="text-sm text-muted-foreground">Pensando...</p> : null}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {done ? (
        <Button onClick={finish} disabled={pending} className="w-full">
          {pending ? "Montando seu perfil..." : "Concluir e montar meu posicionamento"}
        </Button>
      ) : (
        <div className="space-y-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Sua resposta..."
            disabled={pending}
          />
          <Button onClick={send} disabled={pending || !input.trim()} className="w-full">
            Enviar
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Teste manual**

Run: `pnpm dev` → criar conta → cair em `/onboarding` → responder → concluir → ver redirect a `/dashboard`.
Expected: perfil criado, conversa salva.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/onboarding components/onboarding
git commit -m "feat(onboarding): conversational chat screen"
```

---

# M3 — Geração + feedback + aprendizado

### Task 11: Adaptar geração para usar o positioningMemory

**Files:**
- Modify: `src/features/generate/generate.actions.ts:335-409` (bloco de prompt) e `:510-512` (carregamento de contexto)
- Create: `src/features/generate/__tests__/build-prompt.test.ts`

**Interfaces:**
- Consumes: `getPositioningProfile(userId)`.
- Produces: prompt de geração que injeta `positioningMemory` no lugar de `briefing` + `authorProfile`. A action passa a retornar também o `postId` salvo (ver Task 12). Mantém `EXPECTED_VARIANT_LABELS` e o parser `buildVariantList`.

- [ ] **Step 1: Escrever teste do novo bloco de posicionamento**

```ts
// src/features/generate/__tests__/build-prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildPositioningBlock } from "../generate.prompt";

describe("buildPositioningBlock", () => {
  it("inclui a memória viva", () => {
    const block = buildPositioningBlock({ positioningMemory: "Sou dev sênior, vendo mentoria." } as any);
    expect(block).toContain("Sou dev sênior");
  });

  it("usa fallback quando memória vazia", () => {
    const block = buildPositioningBlock({ positioningMemory: "" } as any);
    expect(block).toContain("não informado");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/features/generate`
Expected: FAIL (`generate.prompt` não existe).

- [ ] **Step 3: Extrair construção de prompt para `generate.prompt.ts`**

Mover `buildPrompt`, `buildPlatformBlock`, `buildObjectiveBlock`, `buildLengthBlock`, `FORMAT_DESCRIPTIONS`, `EXPECTED_VARIANT_LABELS`, `BASE_AVOIDANCES` de `generate.actions.ts` para `src/features/generate/generate.prompt.ts`. Trocar `buildAuthorProfileBlock`/uso de briefing por:

```ts
// trecho novo em src/features/generate/generate.prompt.ts
import type { PositioningProfile } from "@/generated/prisma";

export function buildPositioningBlock(profile: Pick<PositioningProfile, "positioningMemory">) {
  const memory = profile.positioningMemory?.trim();
  return [
    "[POSICIONAMENTO]",
    memory && memory.length > 0 ? memory : "não informado",
    "[/POSICIONAMENTO]",
  ].join("\n");
}
```

`buildPrompt` passa a receber `(input, profile)` e usar `buildPositioningBlock(profile)` no lugar dos blocos de briefing/author. O CTA passa a vir de `profile.ctaPreference` com fallback `"CTA respeitosa"`.

- [ ] **Step 4: Atualizar `generate.actions.ts` para carregar o perfil**

Substituir o carregamento de briefing/authorProfile (linhas ~510-519) por:

```ts
const user = await requireUser();
const profile = await getPositioningProfile(user.id);
if (!profile) {
  return { ok: false, error: "Conclua seu onboarding antes de gerar posts." };
}
```

e usar `buildPrompt(validatedInput, profile)` + `safeField(profile.ctaPreference, "CTA respeitosa")`.

- [ ] **Step 5: Rodar testes**

Run: `pnpm test src/features/generate`
Expected: PASS.

- [ ] **Step 6: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/features/generate
git commit -m "feat(generate): use living positioningMemory instead of briefing/profile"
```

---

### Task 12: Salvar posts gerados

**Files:**
- Create: `src/features/posts/posts.repository.ts`
- Modify: `src/features/generate/generate.actions.ts` (persistir antes de retornar)
- Modify: `src/infra/llm/types.ts` (adicionar `postId` ao sucesso)
- Create: `src/features/posts/__tests__/posts.repository.test.ts`

**Interfaces:**
- Consumes: `prisma`, `GenerateVariant`.
- Produces: `savePost(userId, { theme, platform, length, objective, variants })` → `{ id }`; `listPosts(userId)`; `getPost(userId, postId)`. `GenerateResult` sucesso passa a incluir `postId: string`.

- [ ] **Step 1: Teste do repository (filtra por userId)**

```ts
// src/features/posts/__tests__/posts.repository.test.ts
import { describe, it, expect, vi } from "vitest";

const create = vi.fn(async ({ data }: any) => ({ id: "p1", ...data }));
const findMany = vi.fn(async () => []);
vi.mock("@/infra/db/prisma", () => ({
  prisma: { post: { create: (a: unknown) => create(a), findMany: (a: unknown) => findMany(a) } },
}));

import { savePost, listPosts } from "../posts.repository";

describe("posts.repository", () => {
  it("salva post com userId e variants", async () => {
    const res = await savePost("u1", {
      theme: "x", platform: "LINKEDIN", length: "MEDIO", objective: "ENSINAR",
      variants: [{ label: "Direto", content: "abc" }],
    });
    expect(res.id).toBe("p1");
    expect(create.mock.calls[0][0].data.userId).toBe("u1");
  });

  it("lista filtrando por userId", async () => {
    await listPosts("u1");
    expect(findMany.mock.calls[0][0].where.userId).toBe("u1");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/features/posts`
Expected: FAIL.

- [ ] **Step 3: Implementar o repository**

```ts
// src/features/posts/posts.repository.ts
import { prisma } from "@/infra/db/prisma";
import type { GenerateVariant } from "@/infra/llm/types";

export type SavePostInput = {
  theme: string;
  platform: string;
  length: string;
  objective: string;
  variants: GenerateVariant[];
};

export async function savePost(userId: string, input: SavePostInput) {
  return prisma.post.create({
    data: { userId, ...input, variants: input.variants },
  });
}

export async function listPosts(userId: string) {
  return prisma.post.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPost(userId: string, postId: string) {
  return prisma.post.findFirst({ where: { id: postId, userId } });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test src/features/posts`
Expected: PASS.

- [ ] **Step 5: Adicionar `postId` ao tipo de sucesso**

```ts
// src/infra/llm/types.ts
type GenerateSuccess = { ok: true; variants: GenerateVariant[]; postId?: string };
```

- [ ] **Step 6: Persistir na action de geração**

Em `generate.actions.ts`, antes de cada `return { ok: true, variants }`, salvar e incluir `postId`:

```ts
const saved = await savePost(user.id, {
  theme: validatedInput.theme,
  platform: validatedInput.platform,
  length: validatedInput.length,
  objective: validatedInput.objective,
  variants: qualityCheckedVariants,
});
return { ok: true, variants: qualityCheckedVariants, postId: saved.id };
```

- [ ] **Step 7: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/features/posts src/features/generate/generate.actions.ts src/infra/llm/types.ts
git commit -m "feat(posts): persist generated posts and expose postId"
```

---

### Task 13: Feedback dos variants

**Files:**
- Create: `src/domain/feedback.ts`
- Create: `src/features/feedback/feedback.repository.ts`
- Create: `src/features/feedback/feedback.actions.ts`
- Create: `src/features/feedback/__tests__/feedback.repository.test.ts`

**Interfaces:**
- Consumes: `requireUser()`, `prisma`.
- Produces: `feedbackSignalSchema` (`"liked" | "disliked" | "edited" | "more_like_this"`); `recordFeedback(userId, input)`; `countUnprocessedFeedback(userId)`; `submitFeedbackAction(input)` → `{ ok: true; shouldRelearn: boolean } | { ok: false; error }`.

- [ ] **Step 1: Domínio do feedback**

```ts
// src/domain/feedback.ts
import { z } from "zod";

export const feedbackSignalSchema = z.enum([
  "liked",
  "disliked",
  "edited",
  "more_like_this",
]);
export type FeedbackSignal = z.infer<typeof feedbackSignalSchema>;

export const feedbackInputSchema = z.object({
  postId: z.string().min(1),
  variantLabel: z.string().min(1),
  signal: feedbackSignalSchema,
  editedContent: z.string().optional(),
  note: z.string().max(280).optional(),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export const LEARNING_THRESHOLD = 3;
```

- [ ] **Step 2: Teste do repository (contagem de não processados)**

```ts
// src/features/feedback/__tests__/feedback.repository.test.ts
import { describe, it, expect, vi } from "vitest";

const create = vi.fn(async () => ({ id: "f1" }));
const count = vi.fn(async () => 2);
vi.mock("@/infra/db/prisma", () => ({
  prisma: { postFeedback: { create: (a: unknown) => create(a), count: (a: unknown) => count(a) } },
}));

import { recordFeedback, countUnprocessedFeedback } from "../feedback.repository";

describe("feedback.repository", () => {
  it("grava feedback com userId", async () => {
    await recordFeedback("u1", { postId: "p1", variantLabel: "Direto", signal: "liked" });
    expect(create.mock.calls[0][0].data.userId).toBe("u1");
    expect(create.mock.calls[0][0].data.processed).toBe(false);
  });

  it("conta só não processados do usuário", async () => {
    const n = await countUnprocessedFeedback("u1");
    expect(n).toBe(2);
    expect(count.mock.calls[0][0].where).toEqual({ userId: "u1", processed: false });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test src/features/feedback`
Expected: FAIL.

- [ ] **Step 4: Implementar o repository**

```ts
// src/features/feedback/feedback.repository.ts
import { prisma } from "@/infra/db/prisma";
import type { FeedbackInput } from "@/domain/feedback";

export async function recordFeedback(userId: string, input: FeedbackInput) {
  return prisma.postFeedback.create({
    data: { userId, processed: false, ...input },
  });
}

export async function countUnprocessedFeedback(userId: string) {
  return prisma.postFeedback.count({ where: { userId, processed: false } });
}

export async function listUnprocessedFeedback(userId: string) {
  return prisma.postFeedback.findMany({ where: { userId, processed: false } });
}

export async function markFeedbackProcessed(ids: string[]) {
  return prisma.postFeedback.updateMany({
    where: { id: { in: ids } },
    data: { processed: true },
  });
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test src/features/feedback`
Expected: PASS.

- [ ] **Step 6: Action de feedback (sinaliza quando reaprender)**

```ts
// src/features/feedback/feedback.actions.ts
"use server";

import { ZodError } from "zod";
import { requireUser } from "@/infra/auth/require-user";
import { feedbackInputSchema, LEARNING_THRESHOLD, type FeedbackInput } from "@/domain/feedback";
import { recordFeedback, countUnprocessedFeedback } from "./feedback.repository";

export type SubmitFeedbackResult =
  | { ok: true; shouldRelearn: boolean }
  | { ok: false; error: string };

export async function submitFeedbackAction(input: FeedbackInput): Promise<SubmitFeedbackResult> {
  try {
    const parsed = feedbackInputSchema.parse(input);
    const user = await requireUser();
    await recordFeedback(user.id, parsed);
    const pending = await countUnprocessedFeedback(user.id);
    return { ok: true, shouldRelearn: pending >= LEARNING_THRESHOLD };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    const message = error instanceof Error ? error.message : "Erro ao salvar feedback.";
    return { ok: false, error: message };
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add src/domain/feedback.ts src/features/feedback
git commit -m "feat(feedback): record variant feedback and detect relearn threshold"
```

---

### Task 14: Reaprendizado em lote do positioningMemory

**Files:**
- Create: `src/features/positioning/relearn.prompts.ts`
- Create: `src/features/positioning/relearn.actions.ts`
- Create: `src/features/positioning/__tests__/relearn.prompts.test.ts`

**Interfaces:**
- Consumes: `requireUser()`, `getLlmProvider()`, `getPositioningProfile`, `updatePositioningMemory`, `listUnprocessedFeedback`, `markFeedbackProcessed`.
- Produces: `buildRelearnPrompt(currentMemory, feedbacks)`; `relearnPositioningAction()` → `{ ok: true; updated: boolean } | { ok: false; error }`.

- [ ] **Step 1: Teste do prompt de reaprendizado**

```ts
// src/features/positioning/__tests__/relearn.prompts.test.ts
import { describe, it, expect } from "vitest";
import { buildRelearnPrompt } from "../relearn.prompts";

describe("buildRelearnPrompt", () => {
  it("inclui memória atual e os sinais", () => {
    const prompt = buildRelearnPrompt("Memória atual", [
      { variantLabel: "Direto", signal: "liked", editedContent: null, note: null },
      { variantLabel: "Técnico", signal: "disliked", editedContent: null, note: "muito seco" },
    ] as any);
    expect(prompt).toContain("Memória atual");
    expect(prompt).toContain("Direto");
    expect(prompt).toContain("muito seco");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/features/positioning`
Expected: FAIL.

- [ ] **Step 3: Implementar o prompt**

```ts
// src/features/positioning/relearn.prompts.ts
import type { PostFeedback } from "@/generated/prisma";

type FeedbackLike = Pick<PostFeedback, "variantLabel" | "signal" | "editedContent" | "note">;

const signalLabel: Record<string, string> = {
  liked: "GOSTOU",
  disliked: "NÃO GOSTOU",
  edited: "EDITOU",
  more_like_this: "QUER MAIS ASSIM",
};

export function buildRelearnPrompt(currentMemory: string, feedbacks: FeedbackLike[]): string {
  const signals = feedbacks
    .map((f) => {
      const parts = [`- [${signalLabel[f.signal] ?? f.signal}] variação "${f.variantLabel}"`];
      if (f.note) parts.push(`nota: ${f.note}`);
      if (f.editedContent) parts.push(`edição: ${f.editedContent}`);
      return parts.join(" | ");
    })
    .join("\n");

  return [
    "Você mantém o documento de posicionamento de um expert.",
    "Atualize a MEMÓRIA atual incorporando os sinais de feedback abaixo.",
    "Mantenha o que segue válido, ajuste tom/preferências reveladas pelo feedback.",
    "Retorne APENAS o novo texto da memória (markdown, 8-15 linhas). Sem JSON, sem comentários.",
    "",
    "MEMÓRIA ATUAL:",
    currentMemory || "(vazia)",
    "",
    "SINAIS DE FEEDBACK:",
    signals,
  ].join("\n");
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test src/features/positioning`
Expected: PASS.

- [ ] **Step 5: Implementar a action de reaprendizado**

```ts
// src/features/positioning/relearn.actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/infra/auth/require-user";
import { getLlmProvider } from "@/infra/llm";
import { getPositioningProfile, updatePositioningMemory } from "./positioning.repository";
import { buildRelearnPrompt } from "./relearn.prompts";
import {
  listUnprocessedFeedback,
  markFeedbackProcessed,
} from "@/features/feedback/feedback.repository";

export type RelearnResult =
  | { ok: true; updated: boolean }
  | { ok: false; error: string };

export async function relearnPositioningAction(): Promise<RelearnResult> {
  try {
    const user = await requireUser();
    const [profile, feedbacks] = await Promise.all([
      getPositioningProfile(user.id),
      listUnprocessedFeedback(user.id),
    ]);

    if (!profile || feedbacks.length === 0) {
      return { ok: true, updated: false };
    }

    const provider = getLlmProvider();
    const newMemory = (
      await provider.generateText(buildRelearnPrompt(profile.positioningMemory, feedbacks), {
        maxTokens: 700,
        timeoutMs: 60000,
      })
    ).trim();

    if (newMemory.length > 0) {
      await updatePositioningMemory(user.id, newMemory);
    }
    await markFeedbackProcessed(feedbacks.map((f) => f.id));

    revalidatePath("/posicionamento");
    return { ok: true, updated: newMemory.length > 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao reaprender.";
    return { ok: false, error: message };
  }
}
```

> Resiliência: se o LLM falhar, o `catch` retorna erro e os feedbacks **não** são marcados como processados (rodam de novo na próxima). A memória anterior nunca é corrompida.

- [ ] **Step 6: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/features/positioning/relearn.prompts.ts src/features/positioning/relearn.actions.ts src/features/positioning/__tests__
git commit -m "feat(positioning): batch relearn positioningMemory from feedback"
```

---

### Task 15: UI de geração com feedback + gatilho de reaprendizado

**Files:**
- Modify: `components/generate/generate-form.tsx`
- Create: `components/generate/variant-card.tsx`

**Interfaces:**
- Consumes: `generatePostsAction` (agora retorna `postId`), `submitFeedbackAction`, `relearnPositioningAction`.

- [ ] **Step 1: Criar o card de variação com ações de feedback**

```tsx
// components/generate/variant-card.tsx
"use client";

import { useState, useTransition } from "react";
import { submitFeedbackAction } from "@/features/feedback/feedback.actions";
import { relearnPositioningAction } from "@/features/positioning/relearn.actions";
import type { FeedbackSignal } from "@/domain/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  const react = (signal: FeedbackSignal) =>
    startTransition(async () => {
      const result = await submitFeedbackAction({ postId, variantLabel: label, signal });
      if (result.ok) {
        setSent(signal);
        if (result.shouldRelearn) await relearnPositioningAction();
      }
    });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{label}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="whitespace-pre-wrap text-sm">{content}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => navigator.clipboard.writeText(content)}>Copiar</Button>
          <Button size="sm" variant={sent === "liked" ? "default" : "outline"} disabled={pending} onClick={() => react("liked")}>👍</Button>
          <Button size="sm" variant={sent === "disliked" ? "default" : "outline"} disabled={pending} onClick={() => react("disliked")}>👎</Button>
          <Button size="sm" variant={sent === "more_like_this" ? "default" : "outline"} disabled={pending} onClick={() => react("more_like_this")}>Mais assim</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Renderizar os cards no `generate-form.tsx`**

No `generate-form.tsx`, guardar `postId` do resultado e renderizar a lista de `variants` com `VariantCard` (passando `postId={postId}`), substituindo o render atual de variações. Manter o tratamento de erro/loading existente.

- [ ] **Step 3: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Teste manual do loop**

Run: `pnpm dev` → gerar → dar 👍/👎/Mais assim em 3 variações → conferir no banco que `positioningMemory` mudou após o 3º sinal.
Expected: memória atualizada, feedbacks marcados `processed=true`.

- [ ] **Step 5: Commit**

```bash
git add components/generate
git commit -m "feat(generate): variant feedback UI with batched relearn trigger"
```

---

### Task 16: Histórico e tela de posicionamento

**Files:**
- Create: `app/(app)/posts/page.tsx`
- Create: `app/(app)/posicionamento/page.tsx`
- Delete: `app/(app)/briefing/` e `app/(app)/profile/` (substituídos pelo onboarding/posicionamento)

**Interfaces:**
- Consumes: `requireUser()`, `listPosts`, `getPositioningProfile`.

- [ ] **Step 1: Tela de histórico**

```tsx
// app/(app)/posts/page.tsx
import { requireUser } from "@/infra/auth/require-user";
import { listPosts } from "@/features/posts/posts.repository";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GenerateVariant } from "@/infra/llm/types";

export default async function PostsPage() {
  const user = await requireUser();
  const posts = await listPosts(user.id);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Histórico</h1>
      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Você ainda não gerou posts.</p>
      ) : (
        posts.map((post) => (
          <Card key={post.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {post.theme} · {post.platform} · {post.createdAt.toLocaleDateString("pt-BR")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(post.variants as GenerateVariant[]).map((v) => (
                <div key={v.label}>
                  <p className="font-semibold">{v.label}</p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{v.content}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </main>
  );
}
```

- [ ] **Step 2: Tela de posicionamento (vê a memória viva)**

```tsx
// app/(app)/posicionamento/page.tsx
import Link from "next/link";
import { requireUser } from "@/infra/auth/require-user";
import { getPositioningProfile } from "@/features/positioning/positioning.repository";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PosicionamentoPage() {
  const user = await requireUser();
  const profile = await getPositioningProfile(user.id);

  if (!profile) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="text-3xl font-semibold">Posicionamento</h1>
        <p className="text-sm text-muted-foreground">Conclua seu onboarding primeiro.</p>
        <Button asChild><Link href="/onboarding">Começar</Link></Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Seu posicionamento</h1>
      <Card>
        <CardHeader><CardTitle>Memória viva</CardTitle></CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">{profile.positioningMemory}</p>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Atualiza sozinho conforme você dá feedback nos posts.
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Remover telas antigas de briefing/profile**

Run: `git rm -r "app/(app)/briefing" "app/(app)/profile"`
Expected: removidas. Conferir que o header (Task 7) não aponta mais para elas.

- [ ] **Step 4: Verificar tipos e referências**

Run: `pnpm exec tsc --noEmit && git grep -n "/briefing\|/profile"`
Expected: sem erros; sem links órfãos para as rotas removidas.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): post history + positioning screen, drop old briefing/profile"
```

---

# M4 — Landing + waitlist

### Task 17: Waitlist (domínio, repository, action)

**Files:**
- Create: `src/domain/waitlist.ts`
- Create: `src/features/waitlist/waitlist.repository.ts`
- Create: `src/features/waitlist/waitlist.actions.ts`
- Create: `src/features/waitlist/__tests__/waitlist.actions.test.ts`

**Interfaces:**
- Produces: `waitlistSchema`; `addToWaitlist(email)`; `joinWaitlistAction(email)` → `{ ok: true } | { ok: false; error }` (idempotente em email duplicado).

- [ ] **Step 1: Domínio**

```ts
// src/domain/waitlist.ts
import { z } from "zod";
export const waitlistSchema = z.object({ email: z.string().email("Email inválido.") });
export type WaitlistValues = z.infer<typeof waitlistSchema>;
```

- [ ] **Step 2: Teste da action (duplicado não quebra)**

```ts
// src/features/waitlist/__tests__/waitlist.actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsert = vi.fn(async () => ({ id: "w1" }));
vi.mock("@/infra/db/prisma", () => ({
  prisma: { waitlistEntry: { upsert: (a: unknown) => upsert(a) } },
}));

import { joinWaitlistAction } from "../waitlist.actions";

describe("joinWaitlistAction", () => {
  beforeEach(() => upsert.mockClear());

  it("aceita email válido", async () => {
    const res = await joinWaitlistAction("a@a.com");
    expect(res.ok).toBe(true);
  });

  it("rejeita email inválido sem tocar o banco", async () => {
    const res = await joinWaitlistAction("nao-email");
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test src/features/waitlist`
Expected: FAIL.

- [ ] **Step 4: Implementar repository + action**

```ts
// src/features/waitlist/waitlist.repository.ts
import { prisma } from "@/infra/db/prisma";

export async function addToWaitlist(email: string) {
  return prisma.waitlistEntry.upsert({
    where: { email },
    create: { email },
    update: {},
  });
}
```

```ts
// src/features/waitlist/waitlist.actions.ts
"use server";

import { ZodError } from "zod";
import { waitlistSchema } from "@/domain/waitlist";
import { addToWaitlist } from "./waitlist.repository";

export type JoinWaitlistResult = { ok: true } | { ok: false; error: string };

export async function joinWaitlistAction(email: string): Promise<JoinWaitlistResult> {
  try {
    const input = waitlistSchema.parse({ email });
    await addToWaitlist(input.email);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    return { ok: false, error: "Erro ao entrar na lista." };
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test src/features/waitlist`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/waitlist.ts src/features/waitlist
git commit -m "feat(waitlist): email capture domain, repository and action"
```

---

### Task 18: Landing page pública

**Files:**
- Create: `app/(marketing)/page.tsx` (landing)
- Create: `components/marketing/waitlist-form.tsx`
- Modify: `app/page.tsx` (a home redireciona logados a `/dashboard`, deslogados para a landing)

**Interfaces:**
- Consumes: `joinWaitlistAction`, `auth()`.

- [ ] **Step 1: Form de waitlist (client)**

```tsx
// components/marketing/waitlist-form.tsx
"use client";

import { useState, useTransition } from "react";
import { joinWaitlistAction } from "@/features/waitlist/waitlist.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function WaitlistForm() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    const email = String(formData.get("email") ?? "");
    startTransition(async () => {
      setError(null);
      const result = await joinWaitlistAction(email);
      if (!result.ok) return setError(result.error);
      setDone(true);
    });
  }

  if (done) return <p className="text-sm text-green-600">Pronto! Te aviso quando abrir.</p>;

  return (
    <form action={onSubmit} className="flex w-full max-w-md gap-2">
      <Input name="email" type="email" placeholder="seu@email.com" required />
      <Button type="submit" disabled={pending}>{pending ? "..." : "Entrar na lista"}</Button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
```

- [ ] **Step 2: Landing**

```tsx
// app/(marketing)/page.tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import WaitlistForm from "@/components/marketing/waitlist-form";

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 p-6">
      <div className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Posts que soam como você — e vendem você.
        </h1>
        <p className="text-lg text-muted-foreground">
          O Post.IA aprende seu posicionamento e melhora a cada uso. Sem texto genérico de IA.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <WaitlistForm />
        <div className="flex gap-3">
          <Button asChild><Link href="/signup">Criar conta grátis</Link></Button>
          <Button variant="outline" asChild><Link href="/login">Entrar</Link></Button>
        </div>
      </div>
    </main>
  );
}
```

> Nota de rota: mover a landing para um route group `(marketing)` mantém `/` como path. A `app/page.tsx` da Task 7 (redirect) é substituída — agora deslogado vê a landing direto. Ajustar: a landing fica em `app/page.tsx` (raiz) e o redirect de logado vai no topo dela via `auth()`.

- [ ] **Step 3: Logado pula a landing**

No topo de `app/page.tsx` (landing), redirecionar logados:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/infra/auth";
// dentro do componente (torná-lo async):
const session = await auth();
if (session?.user?.id) redirect("/dashboard");
```

- [ ] **Step 4: Verificar tipos**

Run: `pnpm exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx components/marketing
git commit -m "feat(marketing): public landing with waitlist capture"
```

---

### Task 19: README + fechamento

**Files:**
- Create: `README.md`

**Interfaces:** nenhuma.

- [ ] **Step 1: Escrever o README**

Conteúdo: o que é o Post.IA, stack, setup (`.env` com `DATABASE_URL`, `GEMINI_API_KEY`, `AUTH_SECRET`), comandos (`pnpm install`, `pnpm prisma migrate dev`, `pnpm dev`, `pnpm test`), e o fluxo do produto (signup → onboarding → gerar → feedback → memória evolui).

- [ ] **Step 2: Rodar a suíte completa**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: testes verdes, sem erro de tipo, build ok.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and product flow"
```

---

## Self-Review (cobertura do spec)

- Auth real → Tasks 3-6. ✓
- Fusão AuthorProfile+Briefing em PositioningProfile → Task 2 + Task 11/16. ✓
- Onboarding full conversacional → Tasks 8-10. ✓
- Geração usando positioningMemory → Task 11. ✓
- Salvar posts → Task 12. ✓
- Loop de feedback → Task 13. ✓
- Reaprendizado em lote (N=3) → Task 14, gatilho na Task 15. ✓
- Telas (landing, login, signup, onboarding, dashboard, gerar, histórico, posicionamento) → Tasks 5,7,10,15,16,18. ✓
- Header global → Task 7. ✓
- Erros/resiliência → Tasks 9,14 (conversa parcial, memória não corrompe). ✓
- Custo/cota → `LEARNING_THRESHOLD`, `MAX_ONBOARDING_TURNS`, batch. ✓
- Testes (parser, memória, schemas) → Tasks 8,11,13,14,17. ✓
- Segurança (auth guard, filtro userId, Zod) → Tasks 5,6,12,13. ✓
- Limpeza de dívida (mockGenerator, devUser, metadata, home) → Tasks 6,7. ✓

**Pendência consciente:** `dashboard/page.tsx` ainda referencia briefing (texto antigo). Ajuste de cópia incluído implicitamente na Task 7 (casca) — reescrever o dashboard para refletir posicionamento/onboarding em vez de briefing. Adicionar como sub-passo da Task 7 se necessário durante execução.

**Cota free tier:** o reaprendizado dispara no cliente (Task 15) após o 3º sinal. Em pico, várias chamadas. Mitigação no MVP: batch + threshold. Se estourar, mover para fila/cron (fase 2).
