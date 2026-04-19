# Dinner Spinner — UX notes

## §5 Page walkthroughs

### §5.1 `/` — Spinner

Users land on a wheel-style spinner. Tags can be toggled to narrow the pool; hitting Spin picks a weighted-random dish and reveals it with a "Tonight's pick" animation. The header surfaces a manual light/dark toggle; the app chrome provides a bottom tab bar to Spin / Dishes / Plan / Admin.

### §5.2 `/dishes` — Browse

A scrollable grid of editorial dish cards. Tapping a card navigates to the dish detail. The bottom tab bar is always visible.

### §5.3 `/dishes/[id]` — Dish detail

Shows the dish with a full-bleed hero. The hero uses `imageUrl` if present, or a gradient placeholder built from the dish's `emoji` + `accent` fields. Below the hero: ingredient list (with pantry/optional indicators), recipe in rendered Markdown, and an "Add to plan" toggle.

### §5.4 `/dishes/[id]/cook` — Cook mode

Split layout: left pane shows ingredients scaled to the chosen serving count; right pane shows the step-by-step recipe with tappable ingredient highlights and inline timer chips. The tab bar is hidden in cook mode to maximise screen space.

### §5.5 `/plan` — Meal plan

Lists the dishes currently in the plan, allows adjusting servings, and aggregates the shopping list. A "Push to Todoist" button is visible to authenticated users. The bottom tab bar is always visible.

### §5.6 `/admin/login` — Login

Simple password form. The tab bar is hidden here.

## §6 Design decisions

### §6.20 Dark mode

Dark mode is driven by a manual toggle in the app header, with `prefers-color-scheme` as the initial default. The chosen mode persists in `localStorage.ds_dark`.

## §10 Non-obvious decisions

1. **Tag filter is AND, not OR.** A dish must have every selected tag. Implemented with Postgres `tags @> $1::text[]`.
2. **Servings scaling multiplies `quantity * servings / baseServings`**, unless `scalable: false`, in which case it's a no-op.
3. **Optional ingredients** (`optional: true`) are excluded from the shopping list by default. `/plan` has an "include optional" toggle.
4. **Pantry items** (`pantry: true`) are excluded from the shopping list entirely but shown on the dish detail in a muted italic style.
5. **Ingredient aggregation converts within the same unit category** (weight via grams, volume via ml) but not across categories. Key is `(name, unitCategory, descriptor)`.
6. **Auth for mutations** accepts either a valid admin cookie or a bearer `API_TOKEN`.
7. **Todoist API is pinned to `/api/v1/`** — the old `/rest/v2/` returns 410.
8. **`params` is a Promise** in Next.js 16 — always `await ctx.params` / `await props.params`.
9. **No migration framework** — schema is applied manually via `psql "$DATABASE_URL" -f db/schema.sql`.
10. **`proxy.ts` exports `proxy`**, not `middleware` — Next.js 16 renamed the Middleware file convention.
11. **Todoist button is hidden for unauthenticated visitors** — the `/api/session` endpoint is checked client-side on the plan page.
12. **Per-dish `emoji` and `accent` drive the DishArt fallback.** When a dish has no `imageUrl`, the placeholder renders a 135° gradient seeded from `accent` (default `oklch(70% 0.14 40)`) with the `emoji` centred (default `🍽️`). These fields are authored in the admin form and round-trip through `POST /api/dishes` and `PATCH /api/dishes/{id}`.

## §11 Roadmap

### §11.1 Shipped

- Core recipe app: spin, scale, plan, Todoist push.
- Pantry defaults: user-curated via admin, applied on ingest and server save.
- Unit conversion in aggregation (weight, volume).
- Scalable/optional/alternatives ingredient flags.
- Cook mode with ingredient highlighting and inline timers.
- Cookbook-styled visual redesign (Fraunces / Inter / JetBrains Mono, oklch-based palette, light + dark).
- Bottom tab bar + manual dark-mode toggle.
- Wheel-style spinner with "Tonight's pick" landed-reveal and spin-again.
- Split cook-mode layout.
- Editorial dish cards with full-bleed hero art.
