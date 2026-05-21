# Multi-user authentication — design

**Status:** Approved 2026-05-21
**Scope:** Convert dinner-spinner from a single-user app (admin cookie + global API token) into a multi-user app with Google sign-in and email/password accounts. Each user gets isolated dishes, pantry, meal plan, cook log, and Todoist integration. UI gains a new `/add` page (AI-ingest-first) and renames `/admin` → `/settings`.

---

## Goals

- Users can sign in with Google OAuth or with an email + password.
- Sign-ups are gated by an `ALLOWED_EMAILS` env-var allowlist; design supports a future flip to open sign-up by removing or wildcarding the var.
- Every domain row (`dishes`, `pantry_names`, `meal_plan`, `cook_log`) is scoped by `user_id`. Users see only their own data.
- The existing data is preserved and assigned to the seed owner's account on first sign-in.
- The Mirko-curl-from-scripts pathway (`Authorization: Bearer $API_TOKEN`) keeps working, scoped to the seed owner.
- "Add recipe" becomes a top-level surface (lower toolbar "+" button), with AI ingest as the default flow and a manual-form fallback.
- The renamed `/settings` page holds account, Todoist, pantry-defaults, backup, and the dish-list-with-edit-links.

## Non-goals

- No email verification on sign-up (allowlist is the gate).
- No per-user API token minting UI (deferred until other users need scripted access).
- No multi-provider account linking (one Google or one email/password per user; can't merge).
- No magic-link / passwordless email auth.
- No E2E credentials provider yet (no tests to support yet).
- No migration to Drizzle ORM; we stay on `@neondatabase/serverless` raw SQL.
- No per-user Vercel Blob namespacing (existing image URLs remain URL-only access).

---

## Auth architecture

NextAuth v5 (beta) with **JWT sessions** and **no DB adapter**. Mirrors lpg-route-planner's library choice, but skips `@auth/drizzle-adapter` so we don't have to introduce Drizzle.

### Files

- **`lib/auth.ts`** (replaces today's HMAC-cookie file). Exports `{ handlers, auth, signIn, signOut }` from `NextAuth({...})`. Configures:
  - **Google provider** using `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.
  - **Credentials provider** for email + password. `authorize()` does:
    1. Lowercase + trim email.
    2. Look up `users` row by email via raw SQL.
    3. If row exists and has a non-null `password_hash`, `bcryptjs.compare(submittedPassword, password_hash)`. Return `{ id, email, name }` on match, `null` on mismatch.
  - **`signIn` callback** runs the allowlist check on both providers' identities. Returns `false` for emails not in `ALLOWED_EMAILS`. Returning `false` produces an error on `/auth/signin`. Allowlist is parsed as comma-separated lowercased emails; `ALLOWED_EMAILS=*` (or unset in non-production) means "anyone".
  - **`signIn` callback** also upserts the user row when the Google provider runs (`INSERT INTO users (email, name, image) VALUES (...) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, image = EXCLUDED.image RETURNING id`). Email/password sign-ups go through a separate `/api/auth/signup` route (see below).
  - **`jwt` callback** writes the DB `user.id` (uuid) into `token.sub`.
  - **`session` callback** copies `token.sub` to `session.user.id`.
  - Custom pages: `signIn: "/auth/signin"`. No custom error/sign-out page.
- **`app/api/auth/[...nextauth]/route.ts`** — `export const { GET, POST } = handlers`.
- **`app/api/auth/signup/route.ts`** — `POST` accepts `{ email, password, name }`, runs allowlist check, refuses if email already exists, `bcryptjs.hash(password, 10)`, inserts into `users`, returns `{ ok: true }`. Client then calls `signIn("credentials", ...)` to log in.
- **`proxy.ts`** — rewrites to use the NextAuth `auth()` middleware wrapper (`export default auth((req) => {...})`). Matcher and gating rules: see "Route protection" below.

### Sessions

- **JWT only.** No sessions table. NextAuth's `accounts` / `sessions` / `verificationTokens` tables are not created — we don't need them at JWT scope with a single provider per user.
- Session cookie is NextAuth's default name. `AUTH_SECRET` (≥32 chars) signs the JWT.
- Cookies are httpOnly, secure in prod, SameSite=Lax.

### Env vars

| Name | Purpose | Notes |
|---|---|---|
| `AUTH_SECRET` | JWT signing secret | `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | Google OAuth client ID | New OAuth app in Google Cloud Console |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret | Same |
| `AUTH_URL` | Canonical app URL | `https://dinner-spinner-lake.vercel.app` in prod |
| `ALLOWED_EMAILS` | Comma-separated allowlist | E.g. `mirko@…,partner@…`. Set to `*` to disable. |
| `SEED_OWNER_EMAIL` | Email that owns the existing data | Used by the backfill script + the API-token resolver. |
| `DATABASE_URL` | Neon connection string | Unchanged. |
| `TODOIST_API_TOKEN` | Optional fallback Todoist token | Only used for the seed owner if `users.todoist_token` is null. |
| `TODOIST_PROJECT_NAME` | Optional fallback project name | Same. |
| `API_TOKEN` | Long-lived bearer token | Resolves to the seed owner's `user_id` server-side. |

**Removed** env vars: `ADMIN_PASSWORD`, `SESSION_SECRET`. The old admin login is fully replaced.

### Route protection

`proxy.ts` matcher and rules:

```ts
export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Public read endpoints stay public.
  const publicGet =
    pathname === "/" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/offline");
  if (publicGet) return;

  // Everything else requires auth.
  if (!req.auth) {
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
  }
});
```

API routes that today are unauthenticated (`GET /api/dishes`, `GET /api/tags`, `GET /api/pantry-defaults`, etc.) become authenticated. The existing client components on `/` (spinner) and `/dishes/[id]` continue to fetch via these endpoints; the cookie carries the session, and the responses are user-scoped. No client-vs-server boundary changes for those pages.

### Server-side session access

Every route handler / server component imports `auth` and:

```ts
import { auth } from "@/lib/auth";
import { resolveUserId } from "@/lib/auth-helpers";

export async function GET(req: Request) {
  const userId = await resolveUserId(req); // session OR bearer-token-as-seed-owner
  if (!userId) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  // ...query scoped to userId
}
```

`resolveUserId` is a new helper in `lib/auth-helpers.ts`:

1. If `Authorization: Bearer <token>` is present and matches `API_TOKEN` (constant-time), look up the seed owner by `SEED_OWNER_EMAIL`. Return their `user_id` (or `null` if no such user).
2. Else `const session = await auth();` and return `session?.user?.id ?? null`.

Existing `lib/auth.ts::checkAdminPassword` and `checkApiToken` are deleted; nothing else imports them after the refactor.

---

## Schema migration

Append to `db/schema.sql` (additive, re-runnable):

```sql
-- gen_random_uuid() is in the pgcrypto extension. Neon ships it on by default.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  name            text,
  image           text,
  password_hash   text,
  todoist_token   text,
  todoist_project text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE dishes        ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE pantry_names  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE meal_plan     ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE cook_log      ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS dishes_user_id_idx       ON dishes (user_id);
CREATE INDEX IF NOT EXISTS pantry_names_user_id_idx ON pantry_names (user_id);
CREATE INDEX IF NOT EXISTS cook_log_user_id_idx     ON cook_log (user_id);
```

After backfill, columns become `NOT NULL` via a follow-up migration:

```sql
-- Run only after every existing row has user_id set.
ALTER TABLE dishes       ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE pantry_names ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE cook_log     ALTER COLUMN user_id SET NOT NULL;
-- meal_plan is repk'd below.
```

### Shape changes worth flagging

- **`pantry_names`** PK changes from `(name)` to `(user_id, name)`. Different users can have the same pantry name.
  ```sql
  ALTER TABLE pantry_names DROP CONSTRAINT pantry_names_pkey;
  ALTER TABLE pantry_names ADD PRIMARY KEY (user_id, name);
  ```
- **`meal_plan`** is repk'd: PK becomes `user_id`, drop the `CHECK (id = 1)` and the `id` column, drop the seed `INSERT`.
  ```sql
  ALTER TABLE meal_plan DROP CONSTRAINT IF EXISTS meal_plan_pkey;
  ALTER TABLE meal_plan DROP CONSTRAINT IF EXISTS meal_plan_id_check;
  ALTER TABLE meal_plan DROP COLUMN IF EXISTS id;
  ALTER TABLE meal_plan ADD PRIMARY KEY (user_id);
  ```
  Application code that today reads `SELECT entries FROM meal_plan WHERE id = 1` reads `WHERE user_id = $1` instead.

### Backfill script

`scripts/backfill-seed-owner.ts` (one-shot, run locally against prod DB):

1. `SELECT id FROM users WHERE email = $SEED_OWNER_EMAIL`. Fails fast if seed owner hasn't signed in yet.
2. Refuses to run if `SELECT COUNT(*) FROM dishes WHERE user_id IS NOT NULL` > 0 (idempotency guard).
3. `UPDATE dishes SET user_id = $1 WHERE user_id IS NULL;` and same for `pantry_names`, `cook_log`.
4. The legacy `meal_plan` row (with `id=1`, no `user_id`) gets a `user_id`: `UPDATE meal_plan SET user_id = $1 WHERE id = 1 AND user_id IS NULL`. The lock-down migration that follows drops the `id` column and repks on `user_id`.
5. Prints row counts touched.

After backfill succeeds, run the `SET NOT NULL` migration above.

---

## Per-user Todoist + API token

### Todoist

- `lib/todoist.ts` no longer reads `process.env.TODOIST_API_TOKEN` directly. New signature: `pushShoppingList({ token, projectName, ingredients })`. Caller supplies the per-user creds.
- `POST /api/todoist`:
  1. Resolves `user_id` via `resolveUserId`.
  2. Loads `users.todoist_token` and `users.todoist_project`.
  3. If both null AND the user is the seed owner, falls back to env-var `TODOIST_API_TOKEN` / `TODOIST_PROJECT_NAME`.
  4. If still null, returns 400 `{ error: "todoist_not_configured" }`.
- `/settings` shows a "Todoist" section: read current values from `users.todoist_token` / `users.todoist_project` (masked), let the user paste new ones, `PATCH /api/me/todoist`.

### API token

- `lib/auth-helpers.ts::resolveUserId` (defined above) bridges bearer-token requests to the seed owner.
- All mutation routes that today accept the bearer token (`POST /api/dishes`, `PATCH|DELETE /api/dishes/[id]`, `POST /api/todoist`, `POST /api/backup`) call `resolveUserId` and reject `null`. The check is no longer "is this an admin", it's "who is this".
- Per-user token minting UI is **not in this change**.

---

## UI restructure

### Tab bar (`app/_components/tab-bar.tsx`)

New shape: `[Spin] [Dishes] [+ Add] [Plan] [Settings]`.

- Four flat tab labels + one raised center action.
- The "+" is rendered as a filled accent-colored circle, ~52px, slightly elevated above the bar (negative top margin, soft shadow). Tapping it navigates to `/add`.
- The four flat tabs use the existing label/icon style. Settings replaces Admin (route `/settings`, icon swaps from `chef` to a settings/gear glyph — add `"settings"` to `app/_components/icon.tsx`).
- Tab ordering rationale: Spin/Dishes/Plan are the "consume" tabs (left/right of the "+"); Settings is the rightmost "config" tab; Add is the centerpiece because it's the most-used create action.

### `/add` page (new)

`app/add/page.tsx`. Client component, owns its own state.

- **Default view:** the ingest input (paste / URL / image upload), copied/refactored out of today's `app/admin/ingest/page.tsx`.
- A **"Or fill in manually"** link below the ingest input shows the manual form (`<DishForm>` component, see below) with an empty draft.
- Submitting the ingest input runs `POST /api/ingest`, then on success swaps the view to show the manual form pre-filled with the parsed draft — same behavior as today's "From Ingest" handoff, but inlined into a single page instead of a sessionStorage redirect to `/admin`.
- Save action: `POST /api/dishes` with the user's session cookie. New row's `user_id` is set server-side from the session. Successful save routes to `/dishes/<new_id>`.
- Cancel returns to the previous page (or `/` if no referrer).

### `/dishes/[id]/edit` page (new)

`app/dishes/[id]/edit/page.tsx`. Server component that fetches the dish (404 if not owned by the session user), wraps `<DishForm initial={dish} />`.

- Save action: `PATCH /api/dishes/[id]`. Server checks `dishes.user_id = session.user.id` before applying the update; 404 (not 403) on mismatch to avoid leaking existence.
- Delete action stays here (the "delete" button on today's admin list moves to the edit page).

### `<DishForm>` shared component

Extract the form portion of today's `app/admin/page.tsx` (the entire `<form onSubmit={save}>` block plus its handlers — `updateIngredient`, `addIngredient`, drag/drop reorder, etc.) into `app/_components/dish-form.tsx`. Props:

```ts
type DishFormProps = {
  initial?: Dish;          // undefined = create mode
  onSaved?: (id: number) => void;
  tagSuggestions: string[];
  ingredientNameOptions: string[];
  pantryDefaultsSet: Set<string>;
};
```

`<DishForm>` knows how to issue `POST /api/dishes` vs `PATCH /api/dishes/[id]` based on whether `initial` was supplied. The pantry/backup/dish-list logic stays on `/settings`.

This refactor is on the critical path because the form needs to render in both `/add` and `/dishes/[id]/edit`.

### `/settings` page (renamed from `/admin`)

`app/settings/page.tsx`. Replaces `app/admin/page.tsx`. Sections:

1. **Profile** — name, email (read-only), avatar (Google image if present). Sign-out button.
2. **Change password** — visible only if `users.password_hash IS NOT NULL`. `PATCH /api/me/password` requires current password.
3. **Todoist** — token + project name fields, `PATCH /api/me/todoist`. Shows "Using fallback env config" for the seed owner when the user-row fields are null.
4. **Pantry defaults** — same as today, now scoped to the user.
5. **Backup** — download/upload JSON, scoped to the user (export contains only the user's data).
6. **All dishes** — same list as today, but `edit` links route to `/dishes/[id]/edit` instead of triggering inline-form load. `copy` becomes a button that POSTs a duplicate via `/api/dishes` then routes to `/dishes/<new_id>/edit`. `delete` stays inline (still useful for bulk cleanup).

The new/edit dish form is **not** on this page.

### `/auth/signin` and `/auth/signup` pages (new)

`app/auth/signin/page.tsx` and `app/auth/signup/page.tsx`.

- Centered card, no nav chrome.
- Sign-in page: "Sign in with Google" primary button (`onClick={() => signIn("google")}`); below it a divider; below that an email + password form that POSTs to NextAuth's credentials endpoint via `signIn("credentials", { email, password, callbackUrl })`. Link to `/auth/signup`.
- Sign-up page: name + email + password fields. POSTs to `/api/auth/signup`, then calls `signIn("credentials", ...)` on success. Shows allowlist error inline if rejected. Link to `/auth/signin`.

### Redirects

- `/admin` → 301 redirect to `/settings` (handled in `proxy.ts` or a top-level `app/admin/page.tsx` that just calls `redirect("/settings")`).
- `/admin/login` → 301 redirect to `/auth/signin`.
- `/admin/ingest` → 301 redirect to `/add`.
- These redirects exist for one release (bookmarks, muscle memory). Remove in the next minor release.

---

## API surface changes

| Route | Before | After |
|---|---|---|
| `GET /api/dishes` | Public, returns all | Auth required (session OR bearer), returns dishes WHERE user_id = me |
| `POST /api/dishes` | Admin cookie OR bearer | Session OR bearer; sets user_id from resolver |
| `GET /api/dishes/[id]` | Public | Auth required; 404 if not owned by me |
| `PATCH \| DELETE /api/dishes/[id]` | Admin cookie OR bearer | Session OR bearer; 404 if not owned by me |
| `GET /api/tags` | Public | Auth required; user-scoped |
| `GET /api/pantry-defaults` | **Public** | Auth required; user-scoped |
| `POST \| DELETE /api/pantry-defaults` | Admin cookie OR bearer | Session OR bearer; user-scoped |
| `GET \| POST /api/meal-plan` | Public | Auth required; user-scoped |
| `GET \| POST /api/cook-log` | Public | Auth required; user-scoped |
| `GET \| POST /api/backup` | Admin cookie | Session OR bearer; user-scoped exports |
| `POST /api/todoist` | Admin cookie OR bearer | Session OR bearer; uses user's Todoist creds (env fallback for seed owner) |
| `POST /api/ingest` | Admin cookie | Session OR bearer; no data write (just parses) |
| `POST /api/dishes/[id]/image` | Admin cookie OR bearer | Session OR bearer; 404 if not owned by me |
| `POST /api/dishes/images/backfill` | Admin cookie | Session OR bearer; only touches user's dishes |
| `POST /api/admin/login` | Cleartext password | **Removed** |
| **New:** `GET /api/auth/*` | — | NextAuth handlers |
| **New:** `POST /api/auth/signup` | — | Self-serve email/password sign-up (subject to allowlist) |
| **New:** `PATCH /api/me/todoist` | — | Update `users.todoist_token` / `users.todoist_project` |
| **New:** `PATCH /api/me/password` | — | Change password (requires current password) |

---

## Rollout

One sitting, in order:

1. **Pre-deploy:** create Google OAuth client in Google Cloud Console, set redirect URI to `https://dinner-spinner-lake.vercel.app/api/auth/callback/google`. Add all new env vars to Vercel (production env).
2. **Schema migration:** `psql "$DATABASE_URL" -f db/schema.sql` against prod. Adds `users` table, nullable `user_id` columns, indexes. The legacy `meal_plan` row still has its old shape (id=1, no user_id) at this point.
3. **Deploy app version.** Auth is live. Old session cookies are invalid; you get redirected to `/auth/signin`.
4. **Seed owner signs in with Google.** Their `users` row is created via the `signIn` callback.
5. **Run backfill:** `tsx scripts/backfill-seed-owner.ts` locally with prod `DATABASE_URL` + `SEED_OWNER_EMAIL` env. Assigns all existing rows to the seed owner. Migrates the legacy `meal_plan` row to a per-user row.
6. **Lock-down migration:** `psql ... -c "ALTER TABLE dishes ALTER COLUMN user_id SET NOT NULL"` (etc.). Drops the legacy `meal_plan` PK / CHECK / id column.
7. **Smoke test:** spin works, dish detail works, dish edit works, plan works, Todoist push works, ingest works, backup download works.

### Rollback path

The schema additions are non-destructive — new columns are nullable, the `users` table is new. If the deploy is bad:

1. Revert to the previous Vercel deployment (one click).
2. The previous app version ignores the new columns. Works fine.
3. If you also need to undo the schema: `DROP TABLE users CASCADE` plus `ALTER TABLE … DROP COLUMN user_id` per table. Safe because the previous app version doesn't read those columns.

Once Step 6 (lock-down) runs, rollback gets harder — you'd have to reverse the lock-down first. Hold off on Step 6 for a day or two after the deploy.

---

## Risks & open items

- **`/api/pantry-defaults` was public** and used by external scripts. It's now authenticated. Your claude-agent ingest pipeline that calls it from nex must include the `Authorization: Bearer $API_TOKEN` header; otherwise it gets a 401. The bearer maps to the seed owner, so your data shows up. Document this in CLAUDE.md after deploy.
- **Vercel Blob URLs remain shared** (URL-only access, no auth on the blob itself). Only the dish row that references the URL is private. Acceptable — image URLs leak nothing identifying.
- **PWA first launch** routes through `/auth/signin` if not signed in. iOS installs that have the old session cookie will get redirected. Worth one install test post-deploy.
- **No E2E Credentials provider** ports over because there are no E2E tests yet. Add when tests arrive.
- **Backfill failure mid-run** would leave some rows assigned and others not. Mitigation: the script runs in a single transaction (`BEGIN; ... COMMIT;`). On error, rolls back, leaves everything `NULL`, safe to retry.
- **Seed owner forgets to sign in before running backfill.** Script fails fast with a clear message ("no user with email $SEED_OWNER_EMAIL — sign in first").
- **A user could sign in with Google after being removed from `ALLOWED_EMAILS`** if they already have a `users` row and an unexpired JWT. JWTs are 30 days. Mitigation if needed: a `users.disabled boolean` column and a session callback that rejects disabled users. Defer until needed.

---

## Out of scope (for future changes)

- Per-user API token minting UI (when other users want curl access).
- Account deletion ("delete my data" button).
- Multi-provider linking on one account (Google + password on the same user).
- Sharing dishes between users (a "make this dish public" toggle).
- Magic-link / passwordless email sign-in.
- Rate limiting on `/api/auth/signup`.

---

## File-level change summary

**New:**
- `lib/auth.ts` (replacement)
- `lib/auth-helpers.ts` (resolveUserId, bcrypt wrappers)
- `app/api/auth/[...nextauth]/route.ts`
- `app/api/auth/signup/route.ts`
- `app/api/me/todoist/route.ts`
- `app/api/me/password/route.ts`
- `app/auth/signin/page.tsx`
- `app/auth/signup/page.tsx`
- `app/add/page.tsx`
- `app/dishes/[id]/edit/page.tsx`
- `app/settings/page.tsx`
- `app/_components/dish-form.tsx`
- `scripts/backfill-seed-owner.ts`

**Modified:**
- `db/schema.sql` (users table, user_id columns, repk'd meal_plan + pantry_names)
- `proxy.ts` (NextAuth middleware, expanded matcher)
- `app/_components/tab-bar.tsx` (5-slot layout with center "+", icon set update)
- `app/_components/icon.tsx` (add settings glyph)
- `app/page.tsx` (server component, reads session, filters dishes by user_id)
- All `app/api/*` route handlers (auth + user_id scoping)
- `lib/todoist.ts` (no longer reads env directly)
- `lib/db.ts` (no change to the file itself; every call site that issues queries gets a `user_id` parameter)
- `lib/types.ts` (User type)
- `package.json` (add `next-auth@beta`, `bcryptjs`, `@types/bcryptjs`)
- `.env.example` (new auth env vars, document the removals)
- `AGENTS.md` / `CLAUDE.md` (auth model, allowlist, seed owner, API token semantics)

**Removed:**
- `app/admin/page.tsx` (becomes `app/settings/page.tsx` via rename + slim-down)
- `app/admin/login/page.tsx` (replaced by `/auth/signin`)
- `app/admin/ingest/page.tsx` (becomes `/add`)
- `app/api/admin/login/route.ts`
- Cleartext-cookie helpers in old `lib/auth.ts` (`createSessionCookieValue`, `verifySessionCookieValue`, `checkAdminPassword`)
