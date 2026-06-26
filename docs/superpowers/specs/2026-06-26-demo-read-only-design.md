# Demo (read-only) — Design

**Date:** 2026-06-26
**Status:** Approved (design); implementation pending
**Branch:** `feat/demo-read-only`

## Summary

A public, no-login, **fully read-only** `/demo` experience inside the existing
Dinner Spinner app. A visitor with the link can spin the reel, browse a library,
open any recipe (scale servings, tap-to-highlight ingredients), and build an
**ephemeral** shopping list / week plan that lives only in their browser and is
never saved server-side. No authentication, no mutations reach the server.

The demo is driven by a **static snapshot of ~20 real recipes** baked into the
repo — no database access at runtime. The snapshot is generated once from the
production DB; until it contains real data the `/demo` route is dormant (404),
so nothing fake is ever exposed.

## Decisions (locked)

| Question | Decision |
|---|---|
| Where does the demo live? | A public `/demo` route **inside this app** (one deploy, shareable link). The real app's auth gate is untouched. |
| How are the ~20 recipes stored? | **Static snapshot** baked into the repo (`lib/demo/dishes.ts`), generated from real DB recipes. No DB at runtime. |
| What can a visitor do? | **Spin + open recipes + scale + ephemeral plan/list** (browser-only, never persisted). |
| Recipe content | **Real recipes** snapshotted from the DB (not hand-authored). |

## Context & constraints

- **Production DB is quota-blocked until 2026-07-01.** The `dinner-spinner` Neon
  project (`silent-forest-72984262`) shares an org-wide free-tier compute quota
  (`org-rough-term-83160188`) that is exhausted; `quota_reset_at` is
  `2026-07-01T00:00:00Z`. `garmin-tools-neon` is the dominant consumer (~110
  compute-hours); dinner-spinner is collateral. The live app's DB-backed
  requests are 402-ing in the meantime. This is a separate incident, flagged but
  out of scope for this task.
- **Consequence for the demo:** the snapshot-generation step (which reads the
  DB) cannot run until the quota resets (or the Neon plan is upgraded). The
  *demo, once built, does not depend on the DB at all* — only generating its
  seed data does.

## Sequencing

1. **Build the whole feature now** (all code), with the snapshot module shipping
   **empty** so `/demo` is dormant (returns 404). Zero risk of exposing fake
   content; the live app is unaffected.
2. **Generate the real snapshot later** — run `scripts/build-demo-snapshot.ts`
   against the live DB once the quota resets (~July 1) or Neon is upgraded.
   Commit the populated `lib/demo/dishes.ts` and deploy → `/demo` activates.

## Architecture — reuse via an `ExperienceConfig` context

The live pages couple to the server in a small, well-defined set of seams:
data reads (`GET /api/dishes`, `GET /api/tags`), plan persistence
(`PUT /api/meal-plan`), the Todoist push (`POST /api/todoist`), and `/dishes/x`
navigation. Rather than duplicate ~2,500 lines of UI (and let it drift), we
capture exactly those seams in a React context and render the **same**
components under both `/` and `/demo` with a different config.

```ts
// app/_experiences/experience-config.tsx  (client context + provider + hook)
type ExperienceConfig = {
  loadDishes(tags: string[]): Promise<Dish[]>;   // live: GET /api/dishes · demo: filter snapshot
  loadTags(): Promise<string[]>;                  // live: GET /api/tags    · demo: snapshot tags
  hrefBase: string;                               // "" (live)              · "/demo"
  planStorageKey: string;                         // "mealPlan"             · "demoMealPlan"
  persistPlanRemote?: (entries: PlanEntry[]) => void;   // live: PUT /api/meal-plan · demo: undefined (no-op)
  loadPlanRemote?: () => Promise<PlanEntry[] | null>;   // live: GET /api/meal-plan · demo: undefined
  readonly: boolean;                              // demo: true → hide favorite/cook/edit/add; Todoist → sign-up nudge
};
```

- **Live config**: real fetches, `hrefBase: ""`, `mealPlan` key, `readonly: false`.
- **Demo config**: snapshot-backed loaders (`lib/demo/source.ts`),
  `hrefBase: "/demo"`, `demoMealPlan` key, no remote persistence, `readonly: true`.
- The provider default value is the live config, so the existing pages behave
  identically once they read the config instead of hardcoding.

### Extraction plan (DRY where it pays)

| Live file | Action |
|---|---|
| `app/page.tsx` (spinner, ~900 lines, **no mutations**) | Extract body → `app/_experiences/spinner-experience.tsx`. Live route renders it with live config; demo route with demo config. Filmstrip/result UI reused untouched. |
| `app/plan/page.tsx` (~750 lines; has Todoist + meal-plan PUT) | Extract body → `app/_experiences/plan-experience.tsx`. Persistence/Todoist routed through the config; in demo they become no-op / sign-up nudge. Shopping-list aggregation reused untouched. |
| `app/dishes/[id]/dish-view.tsx` (~1,075 lines) | **Parameterize additively**: add `hrefBase`, a `planConfig` (storage key + optional remote persist), and treat demo as a read-only visitor. See note below. |
| `app/dishes/page.tsx` (full filtered/sorted library, ~770 lines) | **Not touched.** The demo gets a new lightweight read-only grid instead (lower risk). |

**`dish-view.tsx` note.** It already supports a non-owner read-only visitor mode
(servings stepper + ingredients + method + tap-to-highlight all work for
visitors). Two additive changes for demo:
1. `hrefBase` for the back/share/profile links (share copies
   `${origin}${hrefBase}/dishes/${id}`).
2. A `planConfig` prop. Today only the **owner** action bar has "Add to plan";
   visitors have none. The demo needs an ephemeral add-to-plan affordance, so we
   add a minimal read-only-safe "Add to plan" control gated on `planConfig`
   (writes to the demo plan store, no API). Owner-only actions (cook log, edit,
   favorite, notes, history) stay gated on `isOwner` and remain off in the demo.
   The demo passes `ownerHandle/ownerName = null` (no "shared by" credit) and
   shows a "create your own" CTA footer instead.

### Lightweight demo library

`app/demo/dishes/page.tsx` — a read-only grid of the snapshot dishes (art +
title + diet/rating badge), each linking to `/demo/dishes/[id]`, with an
ephemeral "Add to plan" toggle. Reuses `DishArt` and shared atoms; does **not**
import the full library page's filter/sort machinery (deliberately simpler).

## Static snapshot

### `lib/demo/dishes.ts`
- `export const DEMO_DISHES: Dish[]` — ~20 dishes, full display fields plus
  canned `favorite` / `averageRating` / `ratingCount` / `cookCount` /
  `lastCookedAt` so the spinner's "why this one" rationale and library badges
  render with variety.
- `export const DEMO_TAGS: string[]` — union of tags across the demo dishes
  (mirrors `GET /api/tags`).
- **Privacy:** `notes` and `imageDescription` are stripped (set to `null`).
- Pure data — safe to import from both server and client components.
- **Ships empty** (`DEMO_DISHES = []`) until the real snapshot is generated.

### `lib/demo/source.ts`
- Builds the demo `ExperienceConfig.loadDishes` / `loadTags` from the snapshot.
- Tag filtering mirrors `/api/dishes` **AND-semantics** (a dish must contain
  every selected tag) and the same `ORDER BY title ASC`.

### `scripts/build-demo-snapshot.ts` (the deferred step)
- Connects to the DB (`DATABASE_URL`) and selects ~20 of the seed owner's
  `public = true` dishes that have `image_url`, a non-empty `recipe`, and
  ingredients — spread across tags/diets for variety.
- Computes the same rating/cook subqueries as `GET /api/dishes`
  (`last_cooked_at`, `cook_count`, `avg_rating`, `rating_count`).
- Strips `notes` and `imageDescription`.
- Writes a formatted `lib/demo/dishes.ts` (the `DEMO_DISHES` literal + derived
  `DEMO_TAGS`). Idempotent / re-runnable to refresh the demo.
- Image URLs point at the existing Vercel Blob assets (public; load fine even
  while the DB is down).

## Read-only guarantees (invariants)

1. Demo pages call **no mutating API** (`POST/PATCH/PUT/DELETE`). Plan
   persistence and Todoist are replaced by browser-local state and a sign-up
   nudge.
2. Demo reads the **bundled snapshot**, never `/api/*` or the DB — so the demo
   even works while the production DB is down.
3. The proxy keeps every real route auth-gated; the demo adds **only `/demo/*`
   page paths** to the public allowlist — **no API surface**. An anonymous
   visitor has no write path (the bearer `API_TOKEN` is not exposed).
4. **localStorage isolation:** the demo uses `demoMealPlan` /
   `demoSpinnerFilters` keys (distinct from the live `mealPlan` /
   `spinnerFilters`), so a visitor's demo state never collides with a real
   signed-in user's state on the same browser.

## Demo chrome & navigation

- Anonymous visitors already have the real tab bar hidden
  (`RootShell` passes `hideTabs={!isSignedIn}`).
- Add a self-contained **demo nav** (Decide · Library · Shop, scoped to
  `/demo/*`) plus a persistent **"Demo · read-only — create your own →"** banner
  linking to `/auth/signup`.
- Suppress the real tab bar on `/demo/*` even for signed-in users, and render
  the demo nav there instead, so the demo is self-consistent. Implemented in
  `RootShell`: `hideTabs = !isSignedIn || pathname.startsWith("/demo")`, and
  render `<DemoNav>` when `pathname.startsWith("/demo")`. The demo plan-count
  badge reads `demoMealPlan`.

## Routing & proxy

New routes (all under `app/demo/`):
- `app/demo/layout.tsx` — wraps children in the demo `ExperienceConfig` provider.
- `app/demo/page.tsx` — spinner (`<SpinnerExperience>`).
- `app/demo/dishes/page.tsx` — lightweight library grid.
- `app/demo/dishes/[id]/page.tsx` — server component: looks up the dish in
  `DEMO_DISHES`; `notFound()` if missing or snapshot empty; renders the
  parameterized `DishView` in demo mode.
- `app/demo/plan/page.tsx` — ephemeral plan (`<PlanExperience>`).

`proxy.ts` — add to the public-path exemptions:
```ts
pathname === "/demo" || pathname.startsWith("/demo/")
```
No API allowlisting needed (demo data is static-imported).

**Dormancy:** while `DEMO_DISHES` is empty, every demo page renders `notFound()`
(spinner/library/plan check `DEMO_DISHES.length` server-side; dish detail
already 404s on miss). The route effectively does not exist until real data
lands.

## Scope

**In:** spin → result rationale; browse library; open recipe (scale servings,
tap-to-highlight ingredients); ephemeral shopping list / week plan (browser-only,
`demoMealPlan`).

**Out (owner-only, hidden in demo):** add/edit recipe, favorite toggle, cook log
+ history, real meal-plan persistence, Todoist push, full-screen cook-mode
step-through (`/dishes/[id]/cook`).

## Files

**Add**
- `lib/demo/dishes.ts` (snapshot; ships empty)
- `lib/demo/source.ts` (demo config loaders)
- `app/_experiences/experience-config.tsx` (context + provider + `useExperienceConfig`)
- `app/_experiences/spinner-experience.tsx` (extracted spinner body)
- `app/_experiences/plan-experience.tsx` (extracted plan body)
- `app/_components/demo-nav.tsx` (demo nav + banner)
- `app/demo/layout.tsx`, `app/demo/page.tsx`, `app/demo/dishes/page.tsx`,
  `app/demo/dishes/[id]/page.tsx`, `app/demo/plan/page.tsx`
- `scripts/build-demo-snapshot.ts`

**Modify (behavior-preserving for live)**
- `app/page.tsx` → thin wrapper rendering `<SpinnerExperience>` with live config
- `app/plan/page.tsx` → thin wrapper rendering `<PlanExperience>` with live config
- `app/dishes/[id]/dish-view.tsx` → additive **optional** `hrefBase` + `planConfig`
  params (default to live behavior; only the demo dish route passes them, so
  `app/dishes/[id]/page.tsx` stays untouched)
- `proxy.ts` → allow `/demo/*`
- `app/_components/root-shell.tsx` → demo-aware tab hiding + demo nav + demo plan count

**Reused untouched:** `lib/ingredients.ts`, `lib/spinner.ts`, `lib/week-plan.ts`,
`lib/diet.ts`, `lib/recipe.ts`, `lib/inline-refs.ts`, `app/_components/ui.tsx`,
`app/_components/icon.tsx`, `lib/types.ts`.

## Activation steps (deferred)

1. DB reachable (quota reset on 2026-07-01, or Neon plan upgrade).
2. `npx tsx scripts/build-demo-snapshot.ts` → populates `lib/demo/dishes.ts`.
3. Review the generated snapshot (count, variety, no private fields).
4. Commit + deploy → `/demo` activates.

(Optional: schedule step 2 for the quota reset so the demo self-activates.)

## Testing & verification

- **Unit (`npx tsx --test`):** `lib/demo/source.ts` tag filtering (AND-semantics,
  ordering) and the demo plan store (separate key, ephemeral, no remote calls)
  against inline fixture dishes.
- **Behavior-preserving check:** the live `/`, `/plan`, `/dishes/[id]` render
  identically after extraction (manual + existing tests).
- **Read-only audit:** grep the `app/demo/**` + experiences for any
  `method: "POST|PATCH|PUT|DELETE"` or `/api/` mutation; confirm none fire in
  demo mode.
- **Smoke (local, uncommitted fixture):** temporarily populate `DEMO_DISHES`
  with a few fixture dishes and drive `/demo` (spin, open, scale, add to plan,
  view list) via the browser; confirm no network calls to `/api/*` for data or
  mutations. Revert the fixture before commit (snapshot ships empty).

## Risks & mitigations

- **Regressing the live spinner/plan during extraction** → keep changes
  mechanical (move body, read config); verify `/` and `/plan` behave identically;
  default config is the live config.
- **Accidentally shipping fake recipes** → snapshot ships empty and `/demo`
  404s until the real generator runs; local smoke fixtures are never committed.
- **Demo state colliding with a real user's plan** → separate localStorage keys.
- **Leaking private fields** → generator strips `notes` + `imageDescription`;
  verification audits the generated file.

## Out of scope / future

- Fixing the Neon quota incident (upgrade or wait for July 1 reset).
- Full filtered/sorted library in the demo (lightweight grid for now).
- Cook-mode step-through in the demo.
- Per-user demo personalization.
