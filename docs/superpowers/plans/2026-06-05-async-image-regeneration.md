# Async Image Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dish-photo regeneration async — POST kicks off generation and returns a job id immediately; the heavy work runs in Vercel `after()`; the client polls a job endpoint — so the UI never hangs on "Generating…".

**Architecture:** A new `image_jobs` table tracks each regenerate. `POST /api/dishes/[id]/image` inserts a `pending` job, runs `generateAndStoreImage()` (a shared helper) inside `after()`, and returns 202 `{jobId}`. A new `GET …/image/jobs/[jobId]` returns the job status; the edit-page client polls it. The generate→upload→update logic is extracted into `lib/dish-image.ts` and reused by the create-route's existing auto-gen.

**Tech Stack:** Next.js 16 App Router (route handlers, `after()` from `next/server`), `@neondatabase/serverless`, Vercel Blob, React 19. No ORM. Tests: Node built-in runner (`node --test`), but this feature is almost entirely I/O (routes/DB) with no meaningful pure-logic surface — verification is `tsc`/`next build`/`eslint` + a live end-to-end regenerate.

**Conventions:**
- Worktree: `/home/mirko/projects/dinner-spinner/.claude/worktrees/async-image-regen` (branch `worktree-async-image-regen`). cd there. Commit locally only; do NOT push.
- `lib/` relative imports use explicit `.ts` extensions where the file does (match neighbors); app code uses `@/…`.
- New route handlers need `npx next typegen` before `RouteContext<…>` types resolve under `tsc --noEmit` (run it in verification).
- `node --test` strips types but does NOT typecheck — the real gate is `next build` / `tsc --noEmit` (last round, two type bugs slipped past `node --test`).

---

## File Structure

**New:**
- `lib/dish-image.ts` — `generateAndStoreImage(dish, userId)`: buildImagePrompt → getProvider().generate → uploadDishImage → UPDATE dishes.image_url. Server-only. The single source for "make + store a dish image."
- `app/api/dishes/[id]/image/jobs/[jobId]/route.ts` — `GET`: poll a job (user-scoped).

**Modified:**
- `db/schema.sql` — add `image_jobs` table.
- `app/api/dishes/[id]/image/route.ts` — `POST` rewritten to async (insert job → `after()` runs helper → 202 `{jobId}`); `maxDuration=60`.
- `app/api/dishes/route.ts` — create-route `after()` delegates to the shared helper (drops its inline duplicate + now-unused imports).
- `app/_components/dish-form.tsx` — `generateImage` polls the job instead of awaiting a synchronous response.
- `AGENTS.md` — document the async image flow.

---

## Task 1: `image_jobs` table

**Files:** Modify `db/schema.sql` (append).

- [ ] **Step 1: Append the table** to the end of `db/schema.sql`:

```sql

-- Async dish-image regeneration jobs (2026-06). POST /api/dishes/[id]/image
-- inserts a pending row, runs generation in after(), and flips status to
-- done/failed; the edit page polls GET .../image/jobs/[jobId]. Rows are
-- opportunistically pruned (>1 day) on each POST — no cron. gen_random_uuid()
-- comes from pgcrypto (already enabled above).
CREATE TABLE IF NOT EXISTS image_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id     int  NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending',
  image_url   text,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_jobs_dish_id_idx ON image_jobs (dish_id);
CREATE INDEX IF NOT EXISTS image_jobs_created_at_idx ON image_jobs (created_at);
```

- [ ] **Step 2: Commit** (the controller applies the DDL to prod separately, like the recipe columns)

```bash
git add db/schema.sql
git commit -m "feat(db): image_jobs table for async image regeneration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

*(Controller, post-implementation: `psql "$DB" -c "CREATE TABLE IF NOT EXISTS image_jobs (...); CREATE INDEX …"` against prod — idempotent.)*

---

## Task 2: `lib/dish-image.ts` shared helper + create-route refactor

**Files:** Create `lib/dish-image.ts`; Modify `app/api/dishes/route.ts`.

- [ ] **Step 1: Create `lib/dish-image.ts`**

```ts
import "server-only";
import { sql } from "./db";
import { buildImagePrompt } from "./image-prompt";
import { getProvider } from "./image-provider";
import { uploadDishImage } from "./image-storage";

// Generate a dish photo, store it in blob, and point the dish row at it.
// The single source for image generation — shared by the create-route's
// fire-and-forget auto-gen and the async regenerate job. User-scoped so a
// stale/forged dish id can't write to another user's row.
export async function generateAndStoreImage(
  dish: {
    id: number;
    title: string;
    subtitle: string | null;
    imageDescription: string | null;
  },
  userId: string,
): Promise<string> {
  const prompt = buildImagePrompt({
    title: dish.title,
    subtitle: dish.subtitle,
    imageDescription: dish.imageDescription,
  });
  const { bytes, mime } = await getProvider().generate(prompt);
  const imageUrl = await uploadDishImage(dish.id, bytes, mime);
  await sql`
    UPDATE dishes SET image_url = ${imageUrl}, updated_at = now()
     WHERE id = ${dish.id} AND user_id = ${userId}
  `;
  return imageUrl;
}
```

- [ ] **Step 2: Refactor the create-route `after()` to use it** (`app/api/dishes/route.ts`). Replace the auto-image-gen `after(...)` block (currently does buildImagePrompt + getProvider().generate + uploadDishImage + UPDATE inline) with:

```ts
  if (dish.imageUrl == null) {
    after(async () => {
      try {
        await generateAndStoreImage(dish, userId);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`auto image-gen failed for dish ${dish.id}:`, err);
      }
    });
  }
```

Add the import:
```ts
import { generateAndStoreImage } from "@/lib/dish-image";
```
Remove the now-unused imports from `app/api/dishes/route.ts` (they moved into the helper): `buildImagePrompt`, `getProvider`, `uploadDishImage`. Keep `after` (still used).

- [ ] **Step 3: Verify**

```bash
cd /home/mirko/projects/dinner-spinner/.claude/worktrees/async-image-regen
npx eslint lib/dish-image.ts app/api/dishes/route.ts
grep -n "buildImagePrompt\|getProvider\|uploadDishImage" app/api/dishes/route.ts || echo "unused imports removed — good"
```
Expected: eslint clean; the grep prints "unused imports removed — good" (those symbols now live only in the helper).

- [ ] **Step 4: Commit**

```bash
git add lib/dish-image.ts app/api/dishes/route.ts
git commit -m "refactor(images): extract generateAndStoreImage; create-route reuses it

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Async POST + GET-jobs routes

**Files:** Modify `app/api/dishes/[id]/image/route.ts`; Create `app/api/dishes/[id]/image/jobs/[jobId]/route.ts`.

- [ ] **Step 1: Rewrite `app/api/dishes/[id]/image/route.ts` to the async POST**

```ts
import type { NextRequest } from "next/server";
import { after } from "next/server";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import { generateAndStoreImage } from "@/lib/dish-image";

// after() runs the ~30-60s generation post-response; give it budget.
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]/image">,
) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) {
    return Response.json({ error: "Bad id" }, { status: 400 });
  }
  const rows = await sql`
    SELECT * FROM dishes WHERE id = ${dishId} AND user_id = ${userId}
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const dish = rowToDish(rows[0]);

  // Opportunistic prune — keep image_jobs small without a cron.
  await sql`DELETE FROM image_jobs WHERE created_at < now() - interval '1 day'`;

  const jobRows = await sql`
    INSERT INTO image_jobs (dish_id, user_id, status)
    VALUES (${dishId}, ${userId}, 'pending')
    RETURNING id
  `;
  const jobId = jobRows[0].id as string;

  after(async () => {
    try {
      const imageUrl = await generateAndStoreImage(dish, userId);
      await sql`
        UPDATE image_jobs SET status = 'done', image_url = ${imageUrl}, updated_at = now()
         WHERE id = ${jobId}
      `;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "image generation failed";
      await sql`
        UPDATE image_jobs SET status = 'failed', error = ${message}, updated_at = now()
         WHERE id = ${jobId}
      `.catch(() => {});
    }
  });

  return Response.json({ jobId }, { status: 202 });
}
```

- [ ] **Step 2: Create `app/api/dishes/[id]/image/jobs/[jobId]/route.ts`**

```ts
import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]/image/jobs/[jobId]">,
) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id, jobId } = await ctx.params;
  const dishId = Number(id);
  // Guard: a non-uuid jobId would make the uuid comparison throw in Postgres.
  if (!Number.isFinite(dishId) || !UUID_RE.test(jobId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await sql`
    SELECT status, image_url, error FROM image_jobs
     WHERE id = ${jobId} AND dish_id = ${dishId} AND user_id = ${userId}
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const r = rows[0];
  return Response.json({
    status: r.status as string,
    imageUrl: (r.image_url as string | null) ?? null,
    error: (r.error as string | null) ?? null,
  });
}
```

- [ ] **Step 3: Verify**

```bash
cd /home/mirko/projects/dinner-spinner/.claude/worktrees/async-image-regen
npx next typegen >/dev/null 2>&1
npx eslint "app/api/dishes/[id]/image/route.ts" "app/api/dishes/[id]/image/jobs/[jobId]/route.ts"
```
Expected: eslint clean. (Typegen makes the new `RouteContext<".../jobs/[jobId]">` resolve.)

- [ ] **Step 4: Commit**

```bash
git add "app/api/dishes/[id]/image/route.ts" "app/api/dishes/[id]/image/jobs/[jobId]/route.ts"
git commit -m "feat(api): async image regeneration (job + poll endpoints)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Client polling (`dish-form.tsx::generateImage`)

**Files:** Modify `app/_components/dish-form.tsx` (the `generateImage` function only; `generatingImage`/`imageMsg` state already exists at lines 232-233).

- [ ] **Step 1: Replace `generateImage`** with the polling version:

```ts
  async function generateImage() {
    if (!draft.id) return;
    setGeneratingImage(true);
    setImageMsg(null);
    try {
      const res = await fetch(`/api/dishes/${draft.id}/image`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };
      if (!res.ok || !data.jobId) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const jobId = data.jobId;
      const deadline = Date.now() + 180_000; // poll up to 3 min
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch(
          `/api/dishes/${draft.id}/image/jobs/${jobId}`,
        );
        const pd = (await poll.json().catch(() => ({}))) as {
          status?: string;
          imageUrl?: string | null;
          error?: string | null;
        };
        if (!poll.ok) throw new Error(pd.error ?? `HTTP ${poll.status}`);
        if (pd.status === "done" && pd.imageUrl) {
          setDraft((d) => ({ ...d, imageUrl: pd.imageUrl! }));
          return;
        }
        if (pd.status === "failed") {
          throw new Error(pd.error ?? "Generation failed");
        }
      }
      setImageMsg("Still generating — refresh in a moment.");
    } catch (err) {
      setImageMsg(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGeneratingImage(false);
    }
  }
```

`generatingImage` stays true for the whole poll loop, so the existing button keeps showing "Generating…" (no other JSX change needed).

- [ ] **Step 2: Verify**

```bash
cd /home/mirko/projects/dinner-spinner/.claude/worktrees/async-image-regen
npx eslint app/_components/dish-form.tsx
```
Expected: clean (a pre-existing unused-eslint-disable warning in `reload()` may remain — leave it).

- [ ] **Step 3: Commit**

```bash
git add app/_components/dish-form.tsx
git commit -m "feat(form): poll the image job instead of blocking on a sync request

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Docs

**Files:** Modify `AGENTS.md`.

- [ ] **Step 1:** In the relevant section (e.g. "Where things live" near the dish API routes, or the AI-ingest/non-obvious area), add a concise note:

> Dish-photo **regeneration is async**: `POST /api/dishes/[id]/image` inserts an `image_jobs` row, runs `lib/dish-image.ts::generateAndStoreImage` in Vercel `after()`, and returns `202 {jobId}`; the edit-page form polls `GET /api/dishes/[id]/image/jobs/[jobId]` until `done`/`failed`. `image_jobs` rows are pruned (>1 day) opportunistically on each POST. The create-route's auto-gen uses the same `generateAndStoreImage` helper (fire-and-forget, no job).

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: async image regeneration flow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Step 1: Type-check + build + lint** (the real gate — `node --test` doesn't typecheck)

```bash
cd /home/mirko/projects/dinner-spinner/.claude/worktrees/async-image-regen
npx next typegen >/dev/null 2>&1
npx tsc --noEmit
npx eslint
```
Expected: `tsc` clean (0 errors). eslint: no NEW errors (pre-existing `prefer-const` in `claude-agent.test.ts` and a couple of `_unused`/eslint-disable warnings are not from this work).

- [ ] **Step 2: Build** (page-data collection needs env; run with prod env sourced)

```bash
set -a; . /home/mirko/projects/dinner-spinner/.env.production.local; set +a
npx next build 2>&1 | tail -20
```
Expected: "Compiled successfully" + "Finished TypeScript" + route manifest lists `/api/dishes/[id]/image/jobs/[jobId]`.

- [ ] **Step 3: Existing unit suite still green** (no regressions)

```bash
node --test 'lib/**/*.test.ts' 2>&1 | grep -E "^# (tests|pass|fail)"
```
Expected: only the 5 pre-existing `image-provider` env tests fail (unchanged); everything else passes.

- [ ] **Step 4: Live end-to-end** (controller, after merge + deploy + applying the DDL to prod): regenerate a dish photo via the edit page (or `POST /api/dishes/<id>/image` with the bearer token → `{jobId}`, then `GET …/image/jobs/<jobId>` → watch `pending` → `done` with `imageUrl`). Confirm the dish's `image_url` changed and the UI shows the new photo without hanging. Optionally confirm the `failed` path surfaces an error.

---

## Spec coverage map

| Spec section | Task |
|---|---|
| `image_jobs` data model | 1 |
| `generateAndStoreImage` shared helper + de-dup create-route | 2 |
| Async `POST` (insert job, after(), maxDuration, opportunistic prune, 202) | 3 |
| `GET …/jobs/[jobId]` poll endpoint | 3 |
| Client polling in `dish-form::generateImage` | 4 |
| Error handling (failed path → client), back-compat (`{imageUrl}`→`{jobId}`, lone caller updated) | 3, 4 |
| Docs | 5 |
| Verification (tsc/build/eslint/live e2e) | Final verification |
| Out of scope (Replicate-native, create-route UX change, cleanup cron) | — (documented, not built) |
