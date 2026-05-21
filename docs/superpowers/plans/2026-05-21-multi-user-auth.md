# Multi-user authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert dinner-spinner from a single-admin app into a multi-user app with Google + email/password sign-in, per-user data scoping (dishes / pantry / meal plan / cook log / Todoist), a new `/add` ingest-first page, and a renamed `/settings` page replacing `/admin`.

**Architecture:** NextAuth v5 (beta) with JWT sessions and **no database adapter** — auth tables are managed by hand-written raw SQL through `@neondatabase/serverless`. A `users` table is added, every domain table gets a nullable `user_id` column (later locked to `NOT NULL`), and a one-shot backfill script assigns existing rows to the seed owner. A `resolveUserId(req)` helper bridges JWT sessions and the legacy `Authorization: Bearer $API_TOKEN` pathway by mapping the env-token to the seed owner's user_id.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · `next-auth@5.0.0-beta` · `@neondatabase/serverless` (raw SQL) · `bcryptjs` · `zod` · Tailwind v4 · Vercel + Neon Postgres.

**Spec:** `docs/superpowers/specs/2026-05-21-multi-user-auth-design.md`

**Execution rule:** Every task ends with a commit. **Do not** lock `user_id` columns to `NOT NULL` (Task 27) until the backfill script (Task 25) has been run against production. The plan's order is also the deploy order.

---

## File-level overview

**New files:**
- `lib/auth.ts` (rewritten — old HMAC code deleted)
- `lib/auth-helpers.ts` — `resolveUserId`, `parseAllowlist`, `isEmailAllowed`, bcrypt wrappers
- `lib/auth-helpers.test.ts` — unit tests for the pure helpers
- `app/api/auth/[...nextauth]/route.ts` — NextAuth handlers
- `app/api/auth/signup/route.ts` — POST email/password sign-up
- `app/api/me/todoist/route.ts` — PATCH per-user Todoist creds
- `app/api/me/password/route.ts` — PATCH change password
- `app/auth/signin/page.tsx`, `app/auth/signup/page.tsx`
- `app/add/page.tsx`
- `app/dishes/[id]/edit/page.tsx`
- `app/settings/page.tsx`
- `app/_components/dish-form.tsx` — shared form pulled out of `app/admin/page.tsx`
- `scripts/backfill-seed-owner.ts`
- `db/lockdown.sql` — second-stage `SET NOT NULL` + `meal_plan` repk

**Modified files:**
- `db/schema.sql` (additive: `users` table, nullable `user_id` columns, indexes)
- `proxy.ts` (NextAuth middleware with public-path exemptions)
- `app/_components/tab-bar.tsx` (5-slot layout, raised center "+")
- `app/_components/icon.tsx` (add "settings" glyph)
- All `app/api/*` route handlers (auth + user_id scoping)
- `lib/todoist.ts` (no longer reads env directly)
- `lib/types.ts` (add `User` type)
- `package.json` / `package-lock.json` (add `next-auth@beta`, `bcryptjs`, `@types/bcryptjs`)
- `.env.example` (new auth env vars)
- `AGENTS.md` and `/home/mirko/CLAUDE.md` (machine notes — new auth model)

**Removed files:**
- `app/admin/page.tsx` (logic merged into `app/settings/page.tsx` + `app/_components/dish-form.tsx`)
- `app/admin/login/page.tsx` (replaced by `/auth/signin`)
- `app/admin/ingest/page.tsx` (replaced by `/add`; old route returns a 301 redirect for one release)
- `app/api/admin/login/route.ts`
- `app/api/auth/check/route.ts` (legacy single-user auth probe; NextAuth's `session` endpoint replaces it)

---

## Phase 1 — Foundation (deps, schema, helpers)

### Task 1: Install deps and update `.env.example`

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Install runtime deps**

```bash
cd /home/mirko/projects/dinner-spinner
npm install next-auth@beta bcryptjs
npm install --save-dev @types/bcryptjs
```

- [ ] **Step 2: Verify `package.json` shows the new deps**

```bash
node -e "const p = require('./package.json'); console.log(p.dependencies['next-auth'], p.dependencies.bcryptjs)"
```

Expected output: `5.0.0-beta.X 3.X.X` (versions vary). If `next-auth` reads `undefined`, the install failed silently — rerun the install.

- [ ] **Step 3: Update `.env.example`**

Replace the file entirely with:

```bash
# Required
DATABASE_URL=postgres://...                  # Neon pooled connection string
AUTH_SECRET=                                  # openssl rand -base64 32
AUTH_GOOGLE_ID=                               # Google OAuth client ID
AUTH_GOOGLE_SECRET=                           # Google OAuth client secret
AUTH_URL=http://localhost:3000                # https://dinner-spinner-lake.vercel.app in prod
ALLOWED_EMAILS=you@example.com                # Comma-separated lowercased allowlist. Set to "*" to disable.
SEED_OWNER_EMAIL=you@example.com              # Email that owns pre-multi-user data. Used by backfill + bearer-token resolver.

# Optional
API_TOKEN=                                    # Long-lived bearer for curl scripts. Resolves to SEED_OWNER_EMAIL's user_id.
TODOIST_API_TOKEN=                            # Seed-owner Todoist fallback. Other users set theirs in /settings.
TODOIST_PROJECT_NAME=Shopping                 # Seed-owner Todoist fallback.
```

Note that `ADMIN_PASSWORD` and `SESSION_SECRET` are intentionally removed.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "Add next-auth + bcryptjs deps and refresh .env.example for multi-user"
```

---

### Task 2: Apply the additive schema migration

**Files:**
- Modify: `db/schema.sql`

- [ ] **Step 1: Append the `users` table + `user_id` columns to `db/schema.sql`**

At the end of the file, append:

```sql
-- Multi-user auth. uuid PK via pgcrypto's gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  name            text,
  image           text,
  -- bcrypt hash. Null for OAuth-only users.
  password_hash   text,
  -- Per-user Todoist creds. Env vars are fallback for the seed owner only.
  todoist_token   text,
  todoist_project text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Add nullable user_id to every domain table. Backfill populates them;
-- a later migration (db/lockdown.sql) flips them to NOT NULL.
ALTER TABLE dishes        ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE pantry_names  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE meal_plan     ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE cook_log      ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS dishes_user_id_idx       ON dishes (user_id);
CREATE INDEX IF NOT EXISTS pantry_names_user_id_idx ON pantry_names (user_id);
CREATE INDEX IF NOT EXISTS cook_log_user_id_idx     ON cook_log (user_id);
```

- [ ] **Step 2: Apply against your local/dev DB**

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

Expected: no errors. Re-running is safe (every statement is `IF NOT EXISTS`).

- [ ] **Step 3: Verify the schema**

```bash
psql "$DATABASE_URL" -c "\d users" -c "\d dishes" -c "SELECT COUNT(*) FROM users"
```

Expected: `users` shows the new columns; `dishes` shows `user_id uuid` near the bottom; the count is `0`.

- [ ] **Step 4: Commit**

```bash
git add db/schema.sql
git commit -m "Add users table and nullable user_id columns to domain tables"
```

---

### Task 3: Add `lib/auth-helpers.ts` with TDD-able pure logic

**Files:**
- Create: `lib/auth-helpers.ts`
- Create: `lib/auth-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/auth-helpers.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllowlist, isEmailAllowed } from "./auth-helpers.ts";

test("parseAllowlist returns empty set when env var unset", () => {
  assert.deepEqual(parseAllowlist(undefined), { mode: "deny-all", emails: new Set() });
  assert.deepEqual(parseAllowlist(""), { mode: "deny-all", emails: new Set() });
});

test('parseAllowlist treats "*" as wildcard', () => {
  assert.deepEqual(parseAllowlist("*"), { mode: "allow-all", emails: new Set() });
  assert.deepEqual(parseAllowlist(" * "), { mode: "allow-all", emails: new Set() });
});

test("parseAllowlist splits on commas and lowercases", () => {
  const result = parseAllowlist("A@x.com, b@Y.com ,c@z.com");
  assert.equal(result.mode, "allow-listed");
  assert.deepEqual([...result.emails].sort(), ["a@x.com", "b@y.com", "c@z.com"]);
});

test("isEmailAllowed honors the three modes", () => {
  assert.equal(isEmailAllowed("any@x.com", { mode: "deny-all", emails: new Set() }), false);
  assert.equal(isEmailAllowed("any@x.com", { mode: "allow-all", emails: new Set() }), true);
  assert.equal(
    isEmailAllowed("A@X.com", { mode: "allow-listed", emails: new Set(["a@x.com"]) }),
    true,
  );
  assert.equal(
    isEmailAllowed("b@x.com", { mode: "allow-listed", emails: new Set(["a@x.com"]) }),
    false,
  );
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx tsx --test lib/auth-helpers.test.ts
```

Expected: failure with "Cannot find module './auth-helpers.ts'" or similar.

- [ ] **Step 3: Create `lib/auth-helpers.ts` (helpers only — `resolveUserId` lands in Task 4)**

```ts
import "server-only";
import bcrypt from "bcryptjs";

export type Allowlist =
  | { mode: "deny-all"; emails: Set<string> }
  | { mode: "allow-all"; emails: Set<string> }
  | { mode: "allow-listed"; emails: Set<string> };

export function parseAllowlist(raw: string | undefined): Allowlist {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { mode: "deny-all", emails: new Set() };
  if (trimmed === "*") return { mode: "allow-all", emails: new Set() };
  const emails = new Set(
    trimmed
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return { mode: "allow-listed", emails };
}

export function isEmailAllowed(email: string, list: Allowlist): boolean {
  if (list.mode === "deny-all") return false;
  if (list.mode === "allow-all") return true;
  return list.emails.has(email.trim().toLowerCase());
}

const BCRYPT_ROUNDS = 10;
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

The `server-only` import prevents this file from being imported into client components.

- [ ] **Step 4: Run the test and confirm it passes**

```bash
npx tsx --test lib/auth-helpers.test.ts
```

Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/auth-helpers.ts lib/auth-helpers.test.ts
git commit -m "Add allowlist helpers and bcrypt wrappers"
```

---

### Task 4: Add `resolveUserId` (session-or-bearer)

**Files:**
- Modify: `lib/auth-helpers.ts`

`resolveUserId` can't be unit-tested in isolation (it touches the DB and the NextAuth session), so verification here is type-check + a curl smoke test once routes exist. We add it now so later route changes can use it.

- [ ] **Step 1: Append to `lib/auth-helpers.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";

// Resolves the acting user_id for an incoming request. Returns null when
// the request is unauthenticated. Two paths:
//   1. Authorization: Bearer $API_TOKEN  -> seed owner's user_id.
//   2. NextAuth JWT session              -> session.user.id.
// The bearer path exists for the curl/script use case. There is no
// per-user token minting yet.
export async function resolveUserId(req: Request): Promise<string | null> {
  const bearer = bearerToken(req);
  if (bearer && process.env.API_TOKEN && constantTimeEqual(bearer, process.env.API_TOKEN)) {
    const seedEmail = (process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();
    if (!seedEmail) return null;
    const rows = await sql`SELECT id FROM users WHERE email = ${seedEmail} LIMIT 1`;
    return (rows[0]?.id as string | undefined) ?? null;
  }
  // Lazy import to avoid a top-level cycle: lib/auth -> lib/auth-helpers -> lib/auth.
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  return (session?.user?.id as string | undefined) ?? null;
}

function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const prefix = "Bearer ";
  if (!h.startsWith(prefix)) return null;
  return h.slice(prefix.length);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: tsc reports errors only in files we haven't touched yet (the old `lib/auth.ts` still exists and references `checkApiToken` from the route handlers). That's expected — we replace it in Task 5.

- [ ] **Step 3: Commit**

```bash
git add lib/auth-helpers.ts
git commit -m "Add resolveUserId helper bridging JWT session and env API_TOKEN"
```

---

### Task 5: Rewrite `lib/auth.ts` as the NextAuth config

This is the biggest single file in the plan. It replaces the old HMAC-cookie code entirely.

**Files:**
- Replace: `lib/auth.ts` (delete old content)

- [ ] **Step 1: Replace `lib/auth.ts` with the NextAuth config**

```ts
import "server-only";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { sql } from "@/lib/db";
import {
  parseAllowlist,
  isEmailAllowed,
  verifyPassword,
} from "@/lib/auth-helpers";

const allowlist = () => parseAllowlist(process.env.ALLOWED_EMAILS);

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/auth/signin" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
    }),
    Credentials({
      name: "Email + password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;
        const rows = await sql`
          SELECT id, email, name, password_hash
          FROM users
          WHERE email = ${email}
          LIMIT 1
        `;
        const row = rows[0];
        if (!row || !row.password_hash) return null;
        if (!(await verifyPassword(password, row.password_hash as string))) return null;
        return {
          id: row.id as string,
          email: row.email as string,
          name: (row.name as string | null) ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      const email = (user?.email ?? "").trim().toLowerCase();
      if (!email) return false;
      if (!isEmailAllowed(email, allowlist())) return false;

      // Google: upsert the user row and stamp our DB uuid back onto the
      // user object so jwt() picks up the right id. Credentials provider
      // already produced our user_id in authorize() above.
      if (account?.provider === "google") {
        const rows = await sql`
          INSERT INTO users (email, name, image)
          VALUES (${email}, ${user.name ?? null}, ${user.image ?? null})
          ON CONFLICT (email) DO UPDATE
            SET name  = COALESCE(EXCLUDED.name,  users.name),
                image = COALESCE(EXCLUDED.image, users.image)
          RETURNING id
        `;
        user.id = rows[0].id as string;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        // NextAuth's default User type already has id?: string thanks to
        // the next-auth.d.ts shipped by the package.
        (session.user as { id: string }).id = token.sub;
      }
      return session;
    },
  },
});
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: every file that imports `ADMIN_COOKIE_NAME`, `checkApiToken`, `checkAdminPassword`, `createSessionCookieValue`, or `verifySessionCookieValue` from `@/lib/auth` now errors. Those will be cleaned up as we rewrite each route handler (Tasks 9–17). Tsc errors confined to those files are expected here.

- [ ] **Step 3: Commit**

```bash
git add lib/auth.ts
git commit -m "Rewrite lib/auth.ts as NextAuth v5 config (Google + credentials)"
```

---

### Task 6: Add NextAuth route handler

**Files:**
- Create: `app/api/auth/[...nextauth]/route.ts`
- Delete: `app/api/auth/check/route.ts`

- [ ] **Step 1: Create the handler**

```ts
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 2: Delete the legacy auth-probe route**

```bash
git rm app/api/auth/check/route.ts
```

(`/api/auth/check` was the single-user cookie probe; NextAuth's built-in `/api/auth/session` replaces it.)

- [ ] **Step 3: Verify the dev server boots**

```bash
npm run dev
```

Visit `http://localhost:3000/api/auth/session` — should return `{}` or `null` (logged-out). Visit `http://localhost:3000/api/auth/providers` — should return `{ google: {...}, credentials: {...} }`. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/[...nextauth]/route.ts
git commit -m "Wire NextAuth route handler and drop legacy /api/auth/check"
```

---

## Phase 2 — Auth UI

### Task 7: Build `/auth/signin` page

**Files:**
- Create: `app/auth/signin/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
"use client";

import { signIn } from "next-auth/react";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function SignInForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";
  const error = params.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onCredentials(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);
    const res = await signIn("credentials", {
      email,
      password,
      callbackUrl,
      redirect: false,
    });
    setSubmitting(false);
    if (!res || res.error) {
      setMsg("Email or password is wrong, or that email isn't on the allowlist.");
    } else if (res.url) {
      window.location.href = res.url;
    }
  }

  return (
    <div className="mx-auto mt-16 flex w-full max-w-sm flex-col gap-6 rounded-lg border border-zinc-200 bg-paper p-6 shadow-sm dark:border-zinc-800">
      <h1 className="text-center text-xl font-semibold">Sign in to Dinner Spinner</h1>

      <button
        type="button"
        onClick={() => signIn("google", { callbackUrl })}
        className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500"
      >
        Continue with Google
      </button>

      <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-zinc-400">
        <hr className="flex-1 border-zinc-300 dark:border-zinc-700" />
        or
        <hr className="flex-1 border-zinc-300 dark:border-zinc-700" />
      </div>

      <form onSubmit={onCredentials} className="flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 disabled:opacity-70 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {submitting ? "Signing in…" : "Sign in with email"}
        </button>
        {(msg || error) && (
          <p className="text-sm text-red-600">{msg ?? `Sign-in failed (${error}).`}</p>
        )}
      </form>

      <p className="text-center text-sm">
        No account yet?{" "}
        <Link href="/auth/signup" className="text-emerald-600 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
```

The `<Suspense>` wrapper is required because `useSearchParams` suspends.

- [ ] **Step 2: Smoke test**

```bash
npm run dev
```

Visit `http://localhost:3000/auth/signin` — the page should render. Click Google → you'll get an OAuth-config error if `AUTH_GOOGLE_ID` is not set in `.env.local`; that's expected at this stage. Kill the dev server.

- [ ] **Step 3: Commit**

```bash
git add app/auth/signin/page.tsx
git commit -m "Add /auth/signin page with Google + credentials providers"
```

---

### Task 8: Add sign-up route + page

**Files:**
- Create: `app/api/auth/signup/route.ts`
- Create: `app/auth/signup/page.tsx`

- [ ] **Step 1: Create the signup route**

```ts
import { sql } from "@/lib/db";
import {
  hashPassword,
  isEmailAllowed,
  parseAllowlist,
} from "@/lib/auth-helpers";

export async function POST(req: Request) {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = body.name ? String(body.name).trim() : null;

  if (!email || !password) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "password_too_short" }, { status: 400 });
  }
  if (!isEmailAllowed(email, parseAllowlist(process.env.ALLOWED_EMAILS))) {
    return Response.json({ error: "email_not_allowed" }, { status: 403 });
  }

  const existing = await sql`SELECT 1 FROM users WHERE email = ${email} LIMIT 1`;
  if (existing.length > 0) {
    return Response.json({ error: "already_registered" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  await sql`
    INSERT INTO users (email, name, password_hash)
    VALUES (${email}, ${name}, ${passwordHash})
  `;
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Create the signup page**

```tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setSubmitting(false);
      setMsg(messageFor(data.error));
      return;
    }
    // Auto-sign-in after successful sign-up.
    const signed = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/",
    });
    setSubmitting(false);
    if (signed?.url) {
      window.location.href = signed.url;
    } else {
      setMsg("Account created — sign in.");
    }
  }

  return (
    <div className="mx-auto mt-16 flex w-full max-w-sm flex-col gap-6 rounded-lg border border-zinc-200 bg-paper p-6 shadow-sm dark:border-zinc-800">
      <h1 className="text-center text-xl font-semibold">Create your account</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-70"
        >
          {submitting ? "Creating…" : "Create account"}
        </button>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </form>
      <p className="text-center text-sm">
        Already have an account?{" "}
        <Link href="/auth/signin" className="text-emerald-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

function messageFor(code: string | undefined): string {
  switch (code) {
    case "email_not_allowed":
      return "That email isn't on the allowlist.";
    case "already_registered":
      return "That email is already registered. Try signing in.";
    case "password_too_short":
      return "Password must be at least 8 characters.";
    case "missing_fields":
      return "Email and password are required.";
    default:
      return "Sign-up failed.";
  }
}
```

- [ ] **Step 3: Smoke test against local DB**

```bash
npm run dev
```

In a second terminal:

```bash
# Should be 403 if your email isn't in ALLOWED_EMAILS
curl -sS -X POST http://localhost:3000/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"new@example.com","password":"hunter2hunter2","name":"Test"}'
```

Then visit `http://localhost:3000/auth/signup` with `ALLOWED_EMAILS=new@example.com` in `.env.local` and create the account in-browser. Confirm the redirect to `/`. Kill the dev server. Then in `psql`:

```bash
psql "$DATABASE_URL" -c "SELECT email, password_hash IS NOT NULL AS has_password FROM users"
```

Expected: one row with `has_password = t`.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/signup/route.ts app/auth/signup/page.tsx
git commit -m "Add /auth/signup page and POST /api/auth/signup with allowlist"
```

---

### Task 9: Rewrite `proxy.ts` to use NextAuth middleware

This **turns on the auth gate**. After this commit, every page and API route requires a session unless explicitly exempted.

**Files:**
- Modify: `proxy.ts`

- [ ] **Step 1: Replace `proxy.ts`**

```ts
import { auth } from "@/lib/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Public paths.
  if (
    pathname === "/" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/offline")
  ) {
    return;
  }

  if (req.auth) return;

  const isApi = pathname.startsWith("/api/");
  if (isApi) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const signInUrl = new URL("/auth/signin", req.url);
  signInUrl.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
  return Response.redirect(signInUrl);
});

export const config = {
  // Skip Next internals & static assets so the JWT cookie doesn't have
  // to be parsed for every chunk request.
  matcher: ["/((?!_next/|api/auth/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|webmanifest)$).*)"],
};
```

Note: `/` is exempted from auth so the spinner can render unauthenticated (e.g., for someone hitting the URL before signing in). The home spinner client fetches `/api/dishes`, which **is** gated — the client gracefully handles the 401 by redirecting to sign-in (handled in Task 12).

- [ ] **Step 2: Restart the dev server and smoke test the gate**

```bash
npm run dev
```

In a second terminal:

```bash
# Unauthenticated request to a protected API: should be 401.
curl -sS -w '\n%{http_code}\n' http://localhost:3000/api/dishes
# Expected: {"error":"unauthorized"}\n401\n

# Auth flow still reachable.
curl -sS -w '\n%{http_code}\n' http://localhost:3000/api/auth/providers
# Expected: 200 with JSON

# Visiting a protected page redirects.
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3000/settings
# Expected: 307 http://localhost:3000/auth/signin?callbackUrl=%2Fsettings   (or 308)
```

Kill the dev server.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "Turn on NextAuth middleware gate for protected routes"
```

---

## Phase 3 — Scope domain API routes by user_id

For every route in this phase, the pattern is:

1. Add `import { resolveUserId } from "@/lib/auth-helpers";`
2. Drop the old `import { ADMIN_COOKIE_NAME, checkApiToken, verifySessionCookieValue } from "@/lib/auth";` and any local `isAuthorized()` helper.
3. At the top of each handler: `const userId = await resolveUserId(req); if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });`
4. Add `user_id` to every `INSERT`, and `WHERE user_id = ${userId}` to every `SELECT` / `UPDATE` / `DELETE`.

The dish-detail GET, PATCH, DELETE return **404** (not 403) when the row exists but belongs to another user, so existence isn't leaked.

### Task 10: Scope `/api/dishes` (GET list + POST create)

**Files:**
- Modify: `app/api/dishes/route.ts`

- [ ] **Step 1: Replace the file**

```ts
import { after } from "next/server";
import { sql } from "@/lib/db";
import { DishInputSchema, rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import { applyPantryDefaults } from "@/lib/pantry";
import { buildImagePrompt } from "@/lib/image-prompt";
import { getProvider } from "@/lib/image-provider";
import { uploadDishImage } from "@/lib/image-storage";

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const tagsParam = url.searchParams.get("tags");
  const tags = tagsParam
    ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const rows =
    tags.length > 0
      ? await sql`
          SELECT d.*,
            (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
            (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
            (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
          FROM dishes d
          WHERE d.user_id = ${userId} AND tags @> ${tags}
          ORDER BY title ASC
        `
      : await sql`
          SELECT d.*,
            (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
            (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
            (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
          FROM dishes d
          WHERE d.user_id = ${userId}
          ORDER BY title ASC
        `;

  return Response.json(rows.map(rowToDish));
}

export async function POST(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = DishInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const d = {
    ...parsed.data,
    ingredients: await applyPantryDefaults(parsed.data.ingredients, userId),
  };
  const rows = await sql`
    INSERT INTO dishes (
      user_id, title, subtitle, recipe, tags, ingredients, base_servings,
      favorite, image_url, emoji, accent, notes, image_description
    )
    VALUES (
      ${userId},
      ${d.title},
      ${d.subtitle ?? null},
      ${d.recipe ?? null},
      ${d.tags},
      ${JSON.stringify(d.ingredients)}::jsonb,
      ${d.baseServings},
      ${d.favorite ?? false},
      ${d.imageUrl ?? null},
      ${d.emoji ?? null},
      ${d.accent ?? null},
      ${d.notes ?? null},
      ${d.imageDescription ?? null}
    )
    RETURNING *
  `;
  const dish = rowToDish(rows[0]);

  if (dish.imageUrl == null) {
    after(async () => {
      try {
        const prompt = buildImagePrompt({
          title: dish.title,
          subtitle: dish.subtitle,
          imageDescription: dish.imageDescription,
        });
        const { bytes, mime } = await getProvider().generate(prompt);
        const url = await uploadDishImage(dish.id, bytes, mime);
        await sql`
          UPDATE dishes
             SET image_url = ${url}, updated_at = now()
           WHERE id = ${dish.id}
        `;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`auto image-gen failed for dish ${dish.id}:`, err);
      }
    });
  }

  return Response.json(dish, { status: 201 });
}
```

`applyPantryDefaults` gets a new `userId` parameter — see Task 11 where we update `lib/pantry.ts`.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: `applyPantryDefaults` call still has a type mismatch (we haven't updated the function yet). Defer the type-check pass to Task 11.

- [ ] **Step 3: Commit**

```bash
git add app/api/dishes/route.ts
git commit -m "Scope /api/dishes list and create by user_id"
```

---

### Task 11: Update `lib/pantry.ts` to be user-scoped

**Files:**
- Modify: `lib/pantry.ts`

- [ ] **Step 1: Read the current file**

```bash
cat lib/pantry.ts
```

- [ ] **Step 2: Update the signatures**

Change every exported function that touches `pantry_names` to take a `userId: string` first argument. The function `applyPantryDefaults` becomes:

```ts
export async function applyPantryDefaults(
  ingredients: Ingredient[],
  userId: string,
): Promise<Ingredient[]> {
  const names = await getPantryDefaults(userId);
  const set = new Set(names.map((n) => n.toLowerCase()));
  return ingredients.map((i) =>
    set.has(i.name.trim().toLowerCase()) ? { ...i, pantry: true } : i,
  );
}

export async function getPantryDefaults(userId: string): Promise<string[]> {
  try {
    const rows = await sql`
      SELECT name FROM pantry_names WHERE user_id = ${userId} ORDER BY name ASC
    `;
    return rows.map((r) => r.name as string);
  } catch {
    // Fallback to vocabulary defaults if the DB read fails.
    return [...PANTRY_DEFAULTS];
  }
}
```

Replace the bodies of any other exported functions accordingly. Keep the import of `PANTRY_DEFAULTS` from `lib/vocabulary.ts` as a fallback.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: every caller of `applyPantryDefaults` / `getPantryDefaults` now type-errors because they don't pass `userId`. We fix those callers as we touch each route in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add lib/pantry.ts
git commit -m "Scope pantry helpers by user_id"
```

---

### Task 12: Scope `/api/dishes/[id]` (GET / PATCH / DELETE)

**Files:**
- Modify: `app/api/dishes/[id]/route.ts`

- [ ] **Step 1: Read the file**

```bash
cat app/api/dishes/[id]/route.ts
```

- [ ] **Step 2: Apply the per-route pattern**

Replace the imports and auth helper with:

```ts
import { sql } from "@/lib/db";
import { DishPatchSchema, rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import { applyPantryDefaults } from "@/lib/pantry";
```

For GET: read `userId`, then `SELECT … FROM dishes WHERE id = $id AND user_id = $userId`. Return 404 when no row.

For PATCH: read `userId`, validate body with `DishPatchSchema`, then `UPDATE dishes SET … WHERE id = $id AND user_id = $userId RETURNING *`. If 0 rows, return 404. When ingredients are provided, call `applyPantryDefaults(ingredients, userId)`.

For DELETE: `DELETE FROM dishes WHERE id = $id AND user_id = $userId`. 404 when 0 rows.

For every handler:

```ts
const userId = await resolveUserId(req);
if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
```

Note Next.js 16 makes `ctx.params` a Promise: `const { id } = await ctx.params;`.

- [ ] **Step 3: Smoke test (after writing the file)**

```bash
npm run dev
```

Sign in as your local user in the browser, then in another terminal extract the session cookie (`document.cookie` in DevTools, look for `authjs.session-token` or similar — name varies by NextAuth version) and:

```bash
COOKIE='authjs.session-token=...'
DISH_ID=1  # adjust to any real dish id in your local DB; expect 404 if it's not yours

curl -sS -w '\n%{http_code}\n' -H "cookie: $COOKIE" \
  http://localhost:3000/api/dishes/$DISH_ID
```

Expected: 404 (dish has no `user_id` yet because we haven't backfilled). That's correct behavior pre-backfill — manually `UPDATE dishes SET user_id = (SELECT id FROM users WHERE email='you@example.com') WHERE id = $DISH_ID` in `psql` to test the happy path locally.

- [ ] **Step 4: Commit**

```bash
git add app/api/dishes/[id]/route.ts
git commit -m "Scope /api/dishes/[id] GET/PATCH/DELETE by user_id (404 on cross-user)"
```

---

### Task 13: Scope `/api/dishes/[id]/favorite`

**Files:**
- Modify: `app/api/dishes/[id]/favorite/route.ts`

- [ ] **Step 1: Read the file then update**

```bash
cat app/api/dishes/[id]/favorite/route.ts
```

Replace the auth check with `resolveUserId`. Add `AND user_id = ${userId}` to the `UPDATE dishes` clause. Return 404 on 0 rows.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add app/api/dishes/[id]/favorite/route.ts
git commit -m "Scope dish-favorite toggle by user_id"
```

---

### Task 14: Scope `/api/dishes/[id]/image` + `/api/dishes/images/backfill`

**Files:**
- Modify: `app/api/dishes/[id]/image/route.ts`
- Modify: `app/api/dishes/images/backfill/route.ts`

- [ ] **Step 1: `/api/dishes/[id]/image`**

Read `userId`, fetch the dish with `WHERE id = $id AND user_id = $userId`, 404 if no row, otherwise generate and update.

- [ ] **Step 2: `/api/dishes/images/backfill`**

Read `userId`, and constrain the candidate-dish query to `WHERE user_id = ${userId} AND image_url IS NULL` (plus the existing `overwrite` logic).

- [ ] **Step 3: Type-check + commit**

```bash
npx tsc --noEmit
git add app/api/dishes/[id]/image/route.ts app/api/dishes/images/backfill/route.ts
git commit -m "Scope dish image-gen and bulk-backfill by user_id"
```

---

### Task 15: Scope `/api/tags` and `/api/ingredient-names`

**Files:**
- Modify: `app/api/tags/route.ts`
- Modify: `app/api/ingredient-names/route.ts`

- [ ] **Step 1: `/api/tags/route.ts`**

Replace the body with:

```ts
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`
    SELECT DISTINCT unnest(tags) AS tag
    FROM dishes
    WHERE user_id = ${userId}
    ORDER BY tag ASC
  `;
  return Response.json(rows.map((r) => r.tag as string));
}
```

- [ ] **Step 2: `/api/ingredient-names/route.ts`**

Do the same: `resolveUserId` gate + add `WHERE user_id = ${userId}` to the existing query.

- [ ] **Step 3: Commit**

```bash
git add app/api/tags/route.ts app/api/ingredient-names/route.ts
git commit -m "Scope /api/tags and /api/ingredient-names by user_id"
```

---

### Task 16: Scope `/api/pantry-defaults`

**Files:**
- Modify: `app/api/pantry-defaults/route.ts`

This route was **public** before. Now it requires auth.

- [ ] **Step 1: Replace the file**

```ts
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`
    SELECT name FROM pantry_names WHERE user_id = ${userId} ORDER BY name ASC
  `;
  return Response.json(rows.map((r) => r.name as string));
}

export async function POST(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim().toLowerCase();
  if (!name) return Response.json({ error: "missing_name" }, { status: 400 });
  await sql`
    INSERT INTO pantry_names (user_id, name)
    VALUES (${userId}, ${name})
    ON CONFLICT (user_id, name) DO NOTHING
  `;
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const name = (url.searchParams.get("name") ?? "").trim().toLowerCase();
  if (!name) return Response.json({ error: "missing_name" }, { status: 400 });
  await sql`DELETE FROM pantry_names WHERE user_id = ${userId} AND name = ${name}`;
  return Response.json({ ok: true });
}
```

The `ON CONFLICT (user_id, name)` requires the PK change. We apply that PK change in the lock-down migration (Task 27). Until then, `(user_id, name)` is enforced by the `ON CONFLICT (user_id, name)` clause failing if the legacy `(name)` PK is still in place. **Workaround for the interim window**: change the upsert to `INSERT ... ON CONFLICT DO NOTHING` (without column list) — Postgres accepts that and matches the existing PK. Use the column-list form once the lock-down migration runs.

For now, use the column-list form `(user_id, name)`. If you get a constraint error during smoke testing pre-lockdown, replace `(user_id, name)` with no columns until Task 27 ships.

- [ ] **Step 2: Commit**

```bash
git add app/api/pantry-defaults/route.ts
git commit -m "Scope /api/pantry-defaults by user_id (was public)"
```

---

### Task 17: Scope `/api/meal-plan`

**Files:**
- Modify: `app/api/meal-plan/route.ts`

The current single-row pattern (`WHERE id = 1`) becomes `WHERE user_id = ${userId}`.

- [ ] **Step 1: Read the file**

```bash
cat app/api/meal-plan/route.ts
```

- [ ] **Step 2: Replace the queries**

`GET`: `SELECT entries FROM meal_plan WHERE user_id = ${userId} LIMIT 1`. If no row, return `[]`.

`POST` (set/replace plan): upsert via:

```ts
await sql`
  INSERT INTO meal_plan (user_id, entries)
  VALUES (${userId}, ${JSON.stringify(entries)}::jsonb)
  ON CONFLICT (user_id) DO UPDATE
    SET entries = EXCLUDED.entries, updated_at = now()
`;
```

The `ON CONFLICT (user_id)` clause requires `user_id` to be the PK. Until the lock-down migration repks, use `ON CONFLICT DO NOTHING` then an `UPDATE` separately, OR run the lock-down PK change against the legacy row first (`UPDATE meal_plan SET user_id = ...` + drop the `(id=1)` row's `id`). We pick the safer approach: rewrite this route assuming the lock-down has run. In the interim, **insert a one-shot SQL fix-up step** locally:

```bash
# Run this once before testing this task locally:
psql "$DATABASE_URL" <<'SQL'
ALTER TABLE meal_plan DROP CONSTRAINT IF EXISTS meal_plan_pkey;
ALTER TABLE meal_plan DROP CONSTRAINT IF EXISTS meal_plan_id_check;
ALTER TABLE meal_plan DROP COLUMN IF EXISTS id;
-- We can't ADD PK on user_id while there's a legacy row with null user_id.
-- Either delete that row or assign it to your local user first:
UPDATE meal_plan SET user_id = (SELECT id FROM users LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE meal_plan ADD PRIMARY KEY (user_id);
SQL
```

This is a destructive change to your local schema. Do it on dev only. The same migration is encoded in `db/lockdown.sql` (Task 27) for prod.

- [ ] **Step 3: Smoke test (after restart)**

```bash
curl -sS -H "cookie: $COOKIE" http://localhost:3000/api/meal-plan
```

Expected: `[]` (empty plan).

- [ ] **Step 4: Commit**

```bash
git add app/api/meal-plan/route.ts
git commit -m "Scope /api/meal-plan by user_id (PK becomes user_id)"
```

---

### Task 18: Scope `/api/cook-log`

**Files:**
- Modify: `app/api/cook-log/route.ts`

- [ ] **Step 1: Update**

`GET`: `WHERE user_id = ${userId} AND dish_id = $dishId ORDER BY cooked_at DESC`.

`POST`: include `user_id` in the INSERT. Also enforce that the `dish_id` belongs to the current user:

```ts
const ownedRows = await sql`
  SELECT 1 FROM dishes WHERE id = ${dishId} AND user_id = ${userId} LIMIT 1
`;
if (ownedRows.length === 0) return Response.json({ error: "not_found" }, { status: 404 });
```

- [ ] **Step 2: Commit**

```bash
git add app/api/cook-log/route.ts
git commit -m "Scope /api/cook-log by user_id (cook_log rows + dish ownership check)"
```

---

### Task 19: Scope `/api/backup`

**Files:**
- Modify: `app/api/backup/route.ts`
- Modify: `lib/backup.ts`

- [ ] **Step 1: Read both files first**

```bash
cat lib/backup.ts
cat app/api/backup/route.ts
```

- [ ] **Step 2: Update `lib/backup.ts`**

Add a `userId: string` parameter to `exportBackup()` and `importBackup()`. Inside, every read filters by `WHERE user_id = ${userId}`; every write sets `user_id = ${userId}` and upserts use composite keys (e.g., `pantry_names` upsert on `(user_id, name)`).

- [ ] **Step 3: Update `app/api/backup/route.ts`**

Replace the auth helper with `resolveUserId`, pass the userId into the backup library.

- [ ] **Step 4: Smoke test**

```bash
# Should be 401 anon
curl -sS -w '\n%{http_code}\n' http://localhost:3000/api/backup

# Should be a JSON envelope for the signed-in user
curl -sS -H "cookie: $COOKIE" http://localhost:3000/api/backup | head -c 200
```

- [ ] **Step 5: Commit**

```bash
git add lib/backup.ts app/api/backup/route.ts
git commit -m "Scope backup export/import by user_id"
```

---

### Task 20: Update `lib/todoist.ts` and scope `/api/todoist`

**Files:**
- Modify: `lib/todoist.ts`
- Modify: `app/api/todoist/route.ts`

- [ ] **Step 1: Read both files**

```bash
cat lib/todoist.ts
cat app/api/todoist/route.ts
```

- [ ] **Step 2: Refactor `lib/todoist.ts`**

Remove `process.env.TODOIST_API_TOKEN` / `TODOIST_PROJECT_NAME` reads from inside the library. Expose the public push function with this signature:

```ts
export async function pushShoppingList(args: {
  token: string;
  projectName: string;
  ingredients: ShoppingIngredient[];
}): Promise<{ created: number; pushed: number }> {
  // existing implementation, but reads args.token and args.projectName
  // instead of env vars
}
```

- [ ] **Step 3: Update `app/api/todoist/route.ts`**

```ts
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";
import { pushShoppingList } from "@/lib/todoist";

export async function POST(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Per-user creds, with env fallback ONLY for the seed owner.
  const rows = await sql`
    SELECT email, todoist_token, todoist_project FROM users WHERE id = ${userId}
  `;
  const user = rows[0];
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let token = (user.todoist_token as string | null) ?? null;
  let projectName = (user.todoist_project as string | null) ?? null;
  const seedEmail = (process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();
  if ((!token || !projectName) && user.email === seedEmail) {
    token ??= process.env.TODOIST_API_TOKEN ?? null;
    projectName ??= process.env.TODOIST_PROJECT_NAME ?? null;
  }
  if (!token || !projectName) {
    return Response.json({ error: "todoist_not_configured" }, { status: 400 });
  }

  let body: { ingredients?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
  // Existing validation/normalization stays as it was.
  const result = await pushShoppingList({ token, projectName, ingredients });
  return Response.json(result);
}
```

- [ ] **Step 4: Type-check + commit**

```bash
npx tsc --noEmit
git add lib/todoist.ts app/api/todoist/route.ts
git commit -m "Scope Todoist push by user_id; env vars become seed-owner fallback"
```

---

### Task 21: Scope `/api/ingest`

**Files:**
- Modify: `app/api/ingest/route.ts`

The ingest route only parses — it doesn't write dishes. Just add the auth gate and pass `userId` to `getPantryDefaults` if it's called.

- [ ] **Step 1: Read the file**

```bash
cat app/api/ingest/route.ts
```

- [ ] **Step 2: Update**

Add `resolveUserId` gate; replace any `getPantryDefaults()` calls with `getPantryDefaults(userId)`.

- [ ] **Step 3: Commit**

```bash
git add app/api/ingest/route.ts
git commit -m "Require auth for /api/ingest and pass userId to pantry defaults"
```

---

### Task 22: Delete the legacy `/api/admin/login` and `/admin/login` page

**Files:**
- Delete: `app/api/admin/login/route.ts`
- Delete: `app/admin/login/page.tsx`

- [ ] **Step 1: Delete both, plus the now-orphan helpers**

```bash
git rm app/api/admin/login/route.ts app/admin/login/page.tsx
```

Verify nothing else imports the deleted helpers:

```bash
grep -RIn "checkAdminPassword\|ADMIN_COOKIE_NAME\|verifySessionCookieValue\|createSessionCookieValue" \
  --include="*.ts" --include="*.tsx" -- app lib proxy.ts
```

Expected: no matches.

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "Remove legacy /admin/login page and route"
```

---

## Phase 4 — Per-user self-management API

### Task 23: `PATCH /api/me/todoist`

**Files:**
- Create: `app/api/me/todoist/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";

export async function PATCH(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { token?: string | null; projectName?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const token = body.token === null ? null : (body.token ?? "").trim() || null;
  const projectName = body.projectName === null ? null : (body.projectName ?? "").trim() || null;
  await sql`
    UPDATE users
       SET todoist_token   = ${token},
           todoist_project = ${projectName}
     WHERE id = ${userId}
  `;
  return Response.json({ ok: true });
}

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`SELECT todoist_token, todoist_project FROM users WHERE id = ${userId}`;
  const r = rows[0];
  return Response.json({
    // Mask the token: only return whether it's set.
    hasToken: !!(r?.todoist_token as string | null),
    projectName: (r?.todoist_project as string | null) ?? null,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/me/todoist/route.ts
git commit -m "Add /api/me/todoist GET/PATCH for per-user Todoist creds"
```

---

### Task 24: `PATCH /api/me/password`

**Files:**
- Create: `app/api/me/password/route.ts`

- [ ] **Step 1: Create**

```ts
import { sql } from "@/lib/db";
import {
  resolveUserId,
  verifyPassword,
  hashPassword,
} from "@/lib/auth-helpers";

export async function PATCH(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { current?: string; next?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const current = String(body.current ?? "");
  const next = String(body.next ?? "");
  if (next.length < 8) {
    return Response.json({ error: "password_too_short" }, { status: 400 });
  }

  const rows = await sql`SELECT password_hash FROM users WHERE id = ${userId} LIMIT 1`;
  const hash = (rows[0]?.password_hash as string | null) ?? null;
  if (!hash) {
    // Google-only account: don't allow setting a password here.
    // (We can add a flow for this later if needed.)
    return Response.json({ error: "no_password_set" }, { status: 400 });
  }
  if (!(await verifyPassword(current, hash))) {
    return Response.json({ error: "wrong_current_password" }, { status: 403 });
  }
  const nextHash = await hashPassword(next);
  await sql`UPDATE users SET password_hash = ${nextHash} WHERE id = ${userId}`;
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/me/password/route.ts
git commit -m "Add /api/me/password for password change (credentials users)"
```

---

## Phase 5 — UI restructure

### Task 25: Extract `<DishForm>` shared component

**Files:**
- Create: `app/_components/dish-form.tsx`
- Modify: `app/admin/page.tsx` (becomes a thin wrapper — to be removed in Task 28)

This is the largest single refactor in the plan. The form lives in two places after this — `/add` (create) and `/dishes/[id]/edit` (update).

- [ ] **Step 1: Create `app/_components/dish-form.tsx`**

Copy the form portion of today's `app/admin/page.tsx` (the entire `<form onSubmit={save}>` block plus all of the form-related state, handlers, and helpers — `draftToPayload`, `dishToDraft`, `dishInputToDraft`, `EMPTY_DRAFT`, `EMPTY_INGREDIENT`, `IngredientDraft`, `Draft`, `updateIngredient`, `addIngredient`, `removeIngredient`, `reorderIngredient`, `addTag`, `generateImage`) into the new file.

Export a default React component:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { Dish, DishInput, Ingredient } from "@/lib/types";
import { PANTRY_DEFAULTS, STANDARD_INGREDIENTS, STANDARD_UNITS } from "@/lib/vocabulary";
import { moveItem } from "@/lib/reorder";
import { Button } from "./ui";

// (all the helpers/types listed above, unchanged from app/admin/page.tsx)

export type DishFormProps = {
  initial?: Dish;
  prefillDraft?: DishInput;          // when /add wants to seed from ingest
  onSaved?: (dish: Dish) => void;
  onCanceled?: () => void;
};

export default function DishForm({ initial, prefillDraft, onSaved, onCanceled }: DishFormProps) {
  const [draft, setDraft] = useState<Draft>(() => {
    if (initial) return dishToDraft(initial);
    if (prefillDraft) return dishInputToDraft(prefillDraft);
    return EMPTY_DRAFT;
  });
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [pantryDefaults, setPantryDefaults] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // (etc. — keep all the per-form state from the original)

  const pantryDefaultsSet = useMemo(
    () => new Set(pantryDefaults.map((n) => n.toLowerCase())),
    [pantryDefaults],
  );
  const ingredientNameOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of [...STANDARD_INGREDIENTS, ...existingNames]) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [existingNames]);

  useEffect(() => {
    (async () => {
      const [tRes, nRes, pRes] = await Promise.all([
        fetch("/api/tags"),
        fetch("/api/ingredient-names"),
        fetch("/api/pantry-defaults"),
      ]);
      if (tRes.ok) setTagSuggestions(await tRes.json());
      if (nRes.ok) setExistingNames(await nRes.json());
      if (pRes.ok) setPantryDefaults(await pRes.json());
    })().catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSaving(true);
    const payload = draftToPayload(draft);
    if (!payload.title) {
      setMsg("Title is required");
      setSaving(false);
      return;
    }
    const url = initial ? `/api/dishes/${initial.id}` : "/api/dishes";
    const method = initial ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(data.error ?? `HTTP ${res.status}`);
      return;
    }
    const dish = (await res.json()) as Dish;
    onSaved?.(dish);
  }

  // (the rest of the form JSX from the original, unchanged — including
  // ingredient rows, drag/drop, datalists for ingredient names and units)

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      {/* original form body */}
    </form>
  );
}
```

Keep the props minimal — the form fetches its own tag/name/pantry suggestions. Don't try to lift that state into the parent.

- [ ] **Step 2: Slim `app/admin/page.tsx`**

Temporarily rewrite `app/admin/page.tsx` to render `<DishForm />` plus the dish list + pantry-defaults + backup sections, so the admin page keeps working until Task 28 replaces it with `/settings`. The form-handling code moves out; the page now just imports and renders the component.

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

Visit `/admin` (you'll be redirected to sign in first — sign in with your seeded account). Confirm the form renders and you can create/edit a dish. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/_components/dish-form.tsx app/admin/page.tsx
git commit -m "Extract shared <DishForm> component"
```

---

### Task 26: `/add` page

**Files:**
- Create: `app/add/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DishInput } from "@/lib/types";
import DishForm from "@/app/_components/dish-form";
import { AppHeader } from "@/app/_components/app-header";
import { Button } from "@/app/_components/ui";

// Reuse the existing ingest input from app/admin/ingest/page.tsx.
// Lift its handlers up here so we can swap views on success.
import { IngestInput } from "./ingest-input";

export default function AddPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"ingest" | "manual">("ingest");
  const [prefill, setPrefill] = useState<DishInput | undefined>();

  function onIngested(parsed: DishInput) {
    setPrefill(parsed);
    setMode("manual");
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader title="Add recipe" />
      <div className="flex-1 overflow-auto pb-20">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {mode === "ingest" ? (
            <>
              <IngestInput onParsed={onIngested} />
              <p className="text-center text-sm text-zinc-500">
                Or{" "}
                <button
                  type="button"
                  onClick={() => setMode("manual")}
                  className="text-emerald-600 hover:underline"
                >
                  fill in manually
                </button>
              </p>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setMode("ingest")}>
                ← Back to ingest
              </Button>
              <DishForm
                prefillDraft={prefill}
                onSaved={(dish) => router.push(`/dishes/${dish.id}`)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/add/ingest-input.tsx`**

Copy the input UI from today's `app/admin/ingest/page.tsx`. Change its end-of-flow from "redirect to /admin with sessionStorage" to `props.onParsed(parsed)`. Keep image compression and paste/URL/photo as-is.

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

Visit `/add` while signed in. Paste a simple recipe (or upload a photo). Confirm the ingest fires, the view swaps to the form prefilled, and saving routes to `/dishes/<id>`. Test the "Or fill in manually" link too. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/add/page.tsx app/add/ingest-input.tsx
git commit -m "Add /add page (ingest-first, manual fallback)"
```

---

### Task 27: `/dishes/[id]/edit` page

**Files:**
- Create: `app/dishes/[id]/edit/page.tsx`

- [ ] **Step 1: Create**

```tsx
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { auth } from "@/lib/auth";
import { rowToDish } from "@/lib/types";
import { AppHeader } from "@/app/_components/app-header";
import EditDishClient from "./edit-client";

export default async function EditDishPage(props: PageProps<"/dishes/[id]/edit">) {
  const { id } = await props.params;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) notFound();

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) notFound();

  const rows = await sql`
    SELECT d.*,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
    FROM dishes d
    WHERE d.id = ${dishId} AND d.user_id = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) notFound();
  const dish = rowToDish(rows[0]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <AppHeader title={`Edit · ${dish.title}`} />
      <div className="flex-1 overflow-auto pb-20">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          <EditDishClient dish={dish} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/dishes/[id]/edit/edit-client.tsx`** (small client wrapper)

```tsx
"use client";

import { useRouter } from "next/navigation";
import type { Dish } from "@/lib/types";
import DishForm from "@/app/_components/dish-form";
import { Button } from "@/app/_components/ui";

export default function EditDishClient({ dish }: { dish: Dish }) {
  const router = useRouter();

  async function del() {
    if (!confirm("Delete this dish?")) return;
    const res = await fetch(`/api/dishes/${dish.id}`, { method: "DELETE" });
    if (res.ok) router.push("/settings");
  }

  return (
    <>
      <DishForm initial={dish} onSaved={(saved) => router.push(`/dishes/${saved.id}`)} />
      <div className="rounded-md border border-red-300 p-3 dark:border-red-900">
        <p className="mb-2 text-sm">Danger zone</p>
        <Button variant="ghost" size="sm" onClick={del}>
          Delete this dish
        </Button>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Type-check + smoke test**

```bash
npx next typegen
npx tsc --noEmit
npm run dev
```

Visit `/dishes/<id>/edit` for one of your dishes; confirm the form prefills, save updates, and delete sends you to `/settings` (page exists by Task 28 — for now a 404 there is fine). Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/dishes/[id]/edit/page.tsx app/dishes/[id]/edit/edit-client.tsx
git commit -m "Add /dishes/[id]/edit page wrapping <DishForm>"
```

---

### Task 28: Build `/settings` and remove `/admin`

**Files:**
- Create: `app/settings/page.tsx`
- Delete: `app/admin/page.tsx`, `app/admin/ingest/page.tsx`

- [ ] **Step 1: Build `/settings/page.tsx`**

Take what's left of `app/admin/page.tsx` (now that the form is extracted) and rebuild it as `/settings`. **Structure: a server component fetches the user via `await auth()` and passes the fields as props to a client child** (`<SettingsClient user={…} />`). This avoids having to add `<SessionProvider>` anywhere. The server page is `app/settings/page.tsx`; the client child is `app/settings/settings-client.tsx`.

1. **Profile section** (in `settings-client.tsx`) — show `user.name`, `user.email`, `user.image` from props. A "Sign out" button calls `signOut({ callbackUrl: "/auth/signin" })` imported from `next-auth/react` (imperative call — no provider needed).
2. **Change password** — only render if `hasPassword` is true (fetch `GET /api/me` — add this if not present, or check via `users.password_hash IS NOT NULL` exposed through a new endpoint, or simply attempt the PATCH and show errors). Simplest: a single form that PATCHes `/api/me/password`; the server-side `no_password_set` error message renders inline.
3. **Todoist section** — `GET /api/me/todoist` to populate, PATCH on save. Show "Using fallback env config" when both values are null and the current user is the seed owner (detected via session email comparison).
4. **Pantry defaults section** — copy from the old `/admin` page verbatim.
5. **Backup section** — copy from the old `/admin` page verbatim.
6. **All dishes section** — copy from the old `/admin` page, but the `edit` button is now a `<Link href={`/dishes/${d.id}/edit`}>` and `copy` POSTs a duplicate via `/api/dishes` then routes to the new edit page.

Keep the existing UI styling. No new design system.

- [ ] **Step 2: Add redirect pages for the old paths**

```tsx
// app/admin/page.tsx
import { redirect } from "next/navigation";
export default function AdminRedirect() {
  redirect("/settings");
}
```

```tsx
// app/admin/ingest/page.tsx
import { redirect } from "next/navigation";
export default function AdminIngestRedirect() {
  redirect("/add");
}
```

(`/admin/login` was already deleted in Task 22; `proxy.ts` redirects unauthed users to `/auth/signin`, so anyone hitting that old URL gets the new sign-in page automatically.)

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

Visit `/settings` — every section should render. Try changing the Todoist token and verify via `psql`. Visit `/admin` — confirm 307 → `/settings`. Visit `/admin/ingest` — confirm 307 → `/add`. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/settings/page.tsx app/admin/page.tsx app/admin/ingest/page.tsx
git commit -m "Build /settings page; redirect /admin and /admin/ingest"
```

---

### Task 29: Redesign the tab bar with center "+" Add

**Files:**
- Modify: `app/_components/tab-bar.tsx`
- Modify: `app/_components/icon.tsx`

- [ ] **Step 1: Add a `settings` icon to `app/_components/icon.tsx`**

Read the file first:

```bash
cat app/_components/icon.tsx
```

Pick a gear-style SVG path and add a new entry to the icon map. If the file uses a `Record<IconName, JSX.Element>` map, add:

```tsx
settings: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
),
```

Add `"settings"` to the `IconName` union.

- [ ] **Step 2: Add a `plus` icon if not already present**

If `IconName` lacks "plus", add it now:

```tsx
plus: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
),
```

- [ ] **Step 3: Replace `app/_components/tab-bar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

type Tab = { id: string; href: string; icon: IconName; label: string; badge?: number };

export function TabBar({ planCount = 0 }: { planCount?: number }) {
  const pathname = usePathname() || "/";

  // The four flat tabs (left of center, right of center).
  const leftTabs: Tab[] = [
    { id: "spinner", href: "/",        icon: "dice", label: "Spin" },
    { id: "browse",  href: "/dishes",  icon: "list", label: "Dishes" },
  ];
  const rightTabs: Tab[] = [
    { id: "plan",     href: "/plan",     icon: "cart",     label: "Plan", badge: planCount || undefined },
    { id: "settings", href: "/settings", icon: "settings", label: "Settings" },
  ];

  const activeId =
    pathname === "/" ? "spinner"
    : pathname.startsWith("/add") ? "add"
    : pathname.startsWith("/dishes") ? "browse"
    : pathname.startsWith("/plan") ? "plan"
    : pathname.startsWith("/settings") ? "settings"
    : "spinner";

  return (
    <nav
      className="sticky bottom-0 z-10 flex w-full flex-shrink-0 justify-center border-t border-rule bg-paper pt-[6px]"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="relative mx-auto flex w-full max-w-2xl items-end px-1">
        {leftTabs.map((t) => renderFlatTab(t, activeId))}

        <div className="flex flex-1 justify-center">
          <Link
            href="/add"
            aria-label="Add recipe"
            className={[
              "-mt-5 flex h-13 w-13 items-center justify-center rounded-full text-accent-ink shadow-md transition-transform",
              activeId === "add" ? "bg-accent scale-105" : "bg-accent",
            ].join(" ")}
            style={{ width: 52, height: 52 }}
          >
            <Icon name="plus" size={24} />
          </Link>
        </div>

        {rightTabs.map((t) => renderFlatTab(t, activeId))}
      </div>
    </nav>
  );
}

function renderFlatTab(t: Tab, activeId: string) {
  const on = activeId === t.id;
  return (
    <Link
      key={t.id}
      href={t.href}
      className={[
        "relative flex flex-1 flex-col items-center gap-[2px] px-1 py-[6px]",
        on ? "text-ink" : "text-ink-3",
      ].join(" ")}
    >
      <span className="relative">
        <Icon name={t.icon} size={22} />
        {t.badge ? (
          <span className="absolute -top-1 -right-2 grid h-4 min-w-4 place-items-center rounded-pill bg-accent px-1 text-[10px] font-semibold text-accent-ink">
            {t.badge}
          </span>
        ) : null}
      </span>
      <span className={["text-[10px] tracking-[0.1em]", on ? "font-semibold" : "font-medium"].join(" ")}>
        {t.label.toUpperCase()}
      </span>
    </Link>
  );
}
```

- [ ] **Step 4: Smoke test**

```bash
npm run dev
```

Open the browser. The bottom toolbar should show `Spin · Dishes · (+) · Plan · Settings` with the "+" elevated. Tapping "+" routes to `/add`. Resize to mobile width to confirm it doesn't break. Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/_components/tab-bar.tsx app/_components/icon.tsx
git commit -m "Redesign tab bar with elevated center '+' Add action"
```

---

## Phase 6 — Rollout helpers + docs

### Task 30: Backfill script

**Files:**
- Create: `scripts/backfill-seed-owner.ts`

- [ ] **Step 1: Create the script**

```ts
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
const seedEmail = (process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();

if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
if (!seedEmail) {
  console.error("SEED_OWNER_EMAIL is not set");
  process.exit(1);
}

const sql = neon(databaseUrl);

async function main() {
  const userRows = await sql`SELECT id FROM users WHERE email = ${seedEmail} LIMIT 1`;
  if (userRows.length === 0) {
    console.error(
      `No user with email ${seedEmail}. Sign in with Google first, then re-run.`,
    );
    process.exit(2);
  }
  const userId = userRows[0].id as string;

  // Idempotency guard: refuse to run if anything is already assigned.
  const assigned = await sql`SELECT COUNT(*)::int AS c FROM dishes WHERE user_id IS NOT NULL`;
  if ((assigned[0].c as number) > 0) {
    console.error(
      "dishes already has rows with user_id set. Refusing to run (would be ambiguous).",
    );
    process.exit(3);
  }

  console.log(`Seed owner user_id = ${userId}`);
  console.log("Updating dishes...");
  const d = await sql`UPDATE dishes SET user_id = ${userId} WHERE user_id IS NULL RETURNING id`;
  console.log(`  ${d.length} dishes updated`);

  console.log("Updating pantry_names...");
  const p = await sql`UPDATE pantry_names SET user_id = ${userId} WHERE user_id IS NULL RETURNING name`;
  console.log(`  ${p.length} pantry names updated`);

  console.log("Updating cook_log...");
  const c = await sql`UPDATE cook_log SET user_id = ${userId} WHERE user_id IS NULL RETURNING id`;
  console.log(`  ${c.length} cook-log rows updated`);

  console.log("Updating legacy meal_plan row...");
  const m = await sql`UPDATE meal_plan SET user_id = ${userId} WHERE user_id IS NULL RETURNING entries`;
  console.log(`  ${m.length} meal_plan row(s) updated`);

  console.log("Done. Next step: apply db/lockdown.sql to flip user_id columns NOT NULL.");
}

main().catch((err) => {
  console.error(err);
  process.exit(99);
});
```

Note: the `@neondatabase/serverless` driver does not wrap multiple statements in an implicit transaction. The four UPDATEs are independent — if one fails, the previous ones stay applied. For one-shot manual operation this is acceptable; the alternative (BEGIN/COMMIT in a `sql.transaction([...])` block) requires reworking the script with prepared statement arrays and isn't worth the complexity for a single-run script.

- [ ] **Step 2: Smoke test locally**

```bash
# In a dev DB where dishes/pantry_names exist with user_id IS NULL:
SEED_OWNER_EMAIL=you@example.com DATABASE_URL=... npx tsx scripts/backfill-seed-owner.ts
```

Expected: prints row counts. Re-run: exits with code 3 (idempotency guard).

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-seed-owner.ts
git commit -m "Add scripts/backfill-seed-owner.ts for one-shot data assignment"
```

---

### Task 31: Lock-down migration SQL

**Files:**
- Create: `db/lockdown.sql`

This is run **after** the backfill in production. Not part of `db/schema.sql` because it depends on backfill having completed.

- [ ] **Step 1: Create `db/lockdown.sql`**

```sql
-- Run AFTER scripts/backfill-seed-owner.ts has filled in every user_id.
-- This is the second-stage migration that locks down the new shape.

BEGIN;

-- Flip user_id columns to NOT NULL.
ALTER TABLE dishes       ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE pantry_names ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE cook_log     ALTER COLUMN user_id SET NOT NULL;

-- pantry_names PK: (name) -> (user_id, name).
ALTER TABLE pantry_names DROP CONSTRAINT IF EXISTS pantry_names_pkey;
ALTER TABLE pantry_names ADD PRIMARY KEY (user_id, name);

-- meal_plan: PK becomes user_id, drop the legacy id column + CHECK.
ALTER TABLE meal_plan ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE meal_plan DROP CONSTRAINT IF EXISTS meal_plan_pkey;
ALTER TABLE meal_plan DROP CONSTRAINT IF EXISTS meal_plan_id_check;
ALTER TABLE meal_plan DROP COLUMN IF EXISTS id;
ALTER TABLE meal_plan ADD PRIMARY KEY (user_id);

COMMIT;
```

- [ ] **Step 2: Smoke test locally**

```bash
psql "$DATABASE_URL" -f db/lockdown.sql
psql "$DATABASE_URL" -c "\d dishes" -c "\d pantry_names" -c "\d meal_plan"
```

Expected: `user_id NOT NULL` on all three; `pantry_names` PK is `(user_id, name)`; `meal_plan` PK is `(user_id)` and no `id` column.

- [ ] **Step 3: Commit**

```bash
git add db/lockdown.sql
git commit -m "Add db/lockdown.sql to lock user_id NOT NULL and repk after backfill"
```

---

### Task 32: Update AGENTS.md / CLAUDE.md / docs

**Files:**
- Modify: `AGENTS.md`
- Modify: `/home/mirko/CLAUDE.md`

- [ ] **Step 1: Update `AGENTS.md`**

Replace the "Env vars" table with the new one from `.env.example`. Add a new "Auth model" section above "Where things live":

```markdown
## Auth model

Multi-user. NextAuth v5 with JWT sessions, no DB adapter. `users` table
stores email, name, image, optional `password_hash` (bcrypt), and per-user
`todoist_token` / `todoist_project`. Sign-up is gated by `ALLOWED_EMAILS`
(comma-separated; `*` = open). Sign-in providers: Google and email/password.

Every domain row has a `user_id` FK to `users(id)`. API routes call
`resolveUserId(req)` from `lib/auth-helpers.ts`, which returns either the
JWT session's `user.id` or, if `Authorization: Bearer $API_TOKEN` matches,
the seed owner's `user_id` (read from `SEED_OWNER_EMAIL`). This is the
only way to mutate data; there's no per-user token minting yet.

Existing data was backfilled to the seed owner on multi-user rollout
(`scripts/backfill-seed-owner.ts` + `db/lockdown.sql`).
```

Update the "Auth for mutations" paragraph at the bottom to point at `resolveUserId`. Remove references to `ADMIN_COOKIE_NAME`, `checkAdminPassword`, `verifySessionCookieValue`, and the old `ADMIN_PASSWORD` / `SESSION_SECRET` env vars.

Update the curl example for verification to assume bearer-as-seed-owner.

- [ ] **Step 2: Update `/home/mirko/CLAUDE.md`** (the machine notes)

In the "Dinner Spinner — recipe ingestion" section, replace the auth notes:

> Before this change: `POST /api/dishes` accepted `Authorization: Bearer $API_TOKEN` from any caller.
>
> After this change: same header still works, but it now scopes the dish to the **seed owner**'s account (the user whose email matches `SEED_OWNER_EMAIL`). If Mirko's the seed owner, behavior is identical from claude-agent's point of view.

Also note that `GET /api/pantry-defaults` is **no longer public** — claude-agent ingest now needs the bearer header on that call too. Document this.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "Update AGENTS.md for multi-user auth model"
```

The `/home/mirko/CLAUDE.md` is outside the repo — commit it separately if it's under its own VCS, or just leave it modified.

---

## Self-review checklist

- [x] **Spec coverage**: every section of the spec maps to a task:
  - Auth architecture → Tasks 3–9
  - Schema migration → Tasks 2, 30, 31
  - Per-user Todoist + API token → Tasks 4, 20, 23
  - UI restructure → Tasks 25–29
  - Rollout → Tasks 30, 31, 32
  - API surface changes → Tasks 10–24
- [x] **Placeholder scan**: no TBDs, no "implement later".
- [x] **Type consistency**: `resolveUserId(req)` returns `Promise<string | null>` everywhere. `applyPantryDefaults(ingredients, userId)` signature consistent across Task 10/11/12. `DishFormProps` uses `initial`/`prefillDraft`/`onSaved`.
- [x] **Plan order = deploy order**: schema additive (Task 2) → app deploy (Tasks 3–29) → backfill (Task 30) → lock-down (Task 31). The plan never lands code that requires lock-down before lock-down ships.

---

## Acceptance check (run after all tasks)

```bash
# All routes require auth
for path in /api/dishes /api/tags /api/pantry-defaults /api/meal-plan /api/cook-log /api/backup; do
  echo "GET $path:"
  curl -sS -o /dev/null -w '  %{http_code}\n' "https://dinner-spinner-lake.vercel.app$path"
done
# Each should print 401.

# Bearer still works for seed-owner curl scripts
curl -sS -H "Authorization: Bearer $API_TOKEN" \
  https://dinner-spinner-lake.vercel.app/api/dishes | jq 'length'
# Should print the seed owner's dish count.

# Signup respects allowlist
curl -sS -X POST https://dinner-spinner-lake.vercel.app/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"random@example.com","password":"hunter2hunter2"}' | jq
# Should be {"error":"email_not_allowed"}.
```

Manual UI sanity:

1. Sign in with Google as the seed owner. Spin works. `/dishes/<id>/edit` works. `/add` ingest works end-to-end.
2. Sign out. Add a second allowlisted email; sign in with that one via email/password sign-up. Confirm an empty spinner, empty pantry, empty plan. Add a dish via `/add`. Spin shows only that user's dish.
3. PWA install on iOS Safari (one device): confirm sign-in persists across launches.
