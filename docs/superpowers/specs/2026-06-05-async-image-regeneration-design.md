# Async Image Regeneration — Design

**Date:** 2026-06-05
**Status:** Approved (design)
**Author:** brainstormed with Mirko

## Problem

Regenerating a dish photo from the edit page hangs the UI on "Generating…" and
appears to do nothing. Root-caused live: `POST /api/dishes/[id]/image` is
**synchronous** — it blocks the serverless function while
`getProvider().generate()` runs (Replicate `flux-1.1-pro` via `Prefer: wait`,
~30–60s). The browser gives up before it returns, so the user sees no result —
even though the Vercel function runs to completion and **saves the new image in
the background** (confirmed: dish #32's photo was regenerated successfully at
~07:27 while the user only saw "Generating…" stuck). So it's a UX/latency
problem, not a connectivity break.

## Decision

**Approach A — local job + Vercel `after()`, provider-agnostic.** The POST kicks
off generation, returns immediately with a job id, and the heavy work runs in
`after()` (the same post-response mechanism the create-dish route already uses
for auto image-gen). The client polls a job endpoint until done/failed. Chosen
over the Replicate-native prediction approach because it reuses the existing
provider abstraction (works for Replicate/Gemini/HTTP), needs no
Replicate-specific code or re-upload idempotency handling, and its only
limitation (the gen runs inside our function, bounded by Vercel's ~60s cap) is
the *same* ceiling `Prefer: wait` already imposes today — no regression, and
flux finishes well under it.

## Data model

New table (`db/schema.sql`), user-scoped, mirroring the spirit of claude-agent's
job rows:

```sql
CREATE TABLE IF NOT EXISTS image_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id     int  NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'pending',   -- 'pending' | 'done' | 'failed'
  image_url   text,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_jobs_dish_id_idx ON image_jobs (dish_id);
CREATE INDEX IF NOT EXISTS image_jobs_created_at_idx ON image_jobs (created_at);
```

Applied to prod the same way as the recipe-feature columns (idempotent
`CREATE TABLE IF NOT EXISTS`, run by the controller).

## Shared helper — `lib/dish-image.ts` (new)

The generate→upload→update logic is currently **duplicated** between
`app/api/dishes/route.ts` (create-route `after()` auto-gen) and
`app/api/dishes/[id]/image/route.ts`. Extract it once:

```ts
// lib/dish-image.ts (server-only)
export async function generateAndStoreImage(
  dish: { id: number; title: string; subtitle: string | null; imageDescription: string | null },
  userId: string,
): Promise<string> {
  const prompt = buildImagePrompt({ title, subtitle, imageDescription });
  const { bytes, mime } = await getProvider().generate(prompt);
  const imageUrl = await uploadDishImage(dish.id, bytes, mime);
  await sql`UPDATE dishes SET image_url = ${imageUrl}, updated_at = now()
            WHERE id = ${dish.id} AND user_id = ${userId}`;
  return imageUrl;
}
```

Both the create-route `after()` and the new regenerate job call this. (The
create-route's existing behavior is preserved — it just delegates to the helper.)

## Surfaces

**1. `POST /api/dishes/[id]/image`** (rewritten to async)
- Auth (`resolveUserId`) + ownership (`SELECT … WHERE id AND user_id`) — unchanged.
- `INSERT INTO image_jobs (dish_id, user_id, status) VALUES (…, 'pending') RETURNING id` → `jobId`.
- `after(async () => { try { const url = await generateAndStoreImage(dish, userId); await sql\`UPDATE image_jobs SET status='done', image_url=${url}, updated_at=now() WHERE id=${jobId}\`; } catch (e) { await sql\`UPDATE image_jobs SET status='failed', error=${msg}, updated_at=now() WHERE id=${jobId}\`; } })`.
- Opportunistic cleanup (bounds growth, no cron): `DELETE FROM image_jobs WHERE created_at < now() - interval '1 day'`.
- Return **HTTP 202 `{ jobId }`**. `export const maxDuration = 60` so `after()` has budget.

**2. `GET /api/dishes/[id]/image/jobs/[jobId]`** (new)
- Auth + the job must match `user_id` (and `dish_id` = the route's id). 404 otherwise (don't leak existence).
- Returns `{ status, imageUrl?, error? }`.

**3. Client — `app/_components/dish-form.tsx::generateImage`** (rewritten)
- POST → `{ jobId }`. Then poll `GET …/image/jobs/[jobId]` every ~2s, up to ~3 min, keeping `generatingImage` true ("Generating…").
- `status==='done'` → `setDraft(d => ({...d, imageUrl}))`, stop.
- `status==='failed'` → `setImageMsg(error)`, stop.
- Poll timeout → `setImageMsg("Still generating — refresh in a moment.")`, stop.
- This is the **only** caller of the endpoint (confirmed). The create-route auto-gen path is separate and **unchanged** (still fire-and-forget via `after()` → helper).

## Error handling

Provider/upload failures are caught inside `after()` and recorded as the job's
`status='failed'` + `error`, then surfaced to the client (no more silent hang).
A gen exceeding the ~60s function cap means `after()` is killed before it writes
a terminal status; the client's poll timeout then shows "still generating —
refresh in a moment" (the same graceful fallback). Job not found / not owned → 404.

## Back-compat

The POST response shape changes from `{ imageUrl }` (sync) to `{ jobId }`
(202, async). The lone caller (`dish-form::generateImage`) is updated in the same
change. No other consumer. The create-dish auto-gen is untouched.

## Testing / verification

- Light unit coverage where it's pure: `generateAndStoreImage` is I/O-bound, so
  no meaningful unit test; the provider/`buildImagePrompt` are unchanged and
  already covered.
- `npx tsc --noEmit` (after `next typegen`) + `next build` + `npx eslint` — the
  type/compile gate (this is where the previous round's type bugs surfaced).
- **Live end-to-end:** trigger a regenerate against prod, observe the
  `image_jobs` row go `pending → done`, confirm the dish's `image_url` changes
  and the UI shows the new photo without hanging. Also force a failure (e.g.
  temporarily bad prompt) to confirm the `failed` path surfaces an error.

## Out of scope

- Replicate-native prediction polling (Approach B) — not needed; A covers prod.
- Changing the create-route's fire-and-forget auto-gen UX (works as-is; only
  refactored to call the shared helper).
- A cleanup cron — the opportunistic 1-day delete on POST suffices for this app's
  scale.
