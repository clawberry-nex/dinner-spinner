# Plan: Ability to sort recipes

Roadmap item `1DI67FFnJGlI` — "Added Ability to sort recipes" (e.g. by date added,
number of cooks, etc.).

Running autonomously; design decisions below were made without user input and are
recorded here + in commit messages.

## Where sorting belongs

The only surface where a user **browses their full recipe collection** is the
profile / "Your kitchen" page (`/u/[handle]`), rendered by
`app/u/[handle]/profile-view.tsx::DishGrid`. The spinner (`app/page.tsx`) picks a
dish at random (order irrelevant) and `/plan` aggregates ingredients — neither is a
browse view. So the sort control goes on the profile dish grid. There is no separate
"all recipes" list page.

## Decision: client-side sort (not a URL/server param)

The app already does collection-level interaction **client-side** with localStorage
persistence (the spinner's tag filter). A server-side `?sort=` param would force a
full server-component re-fetch + reload on every sort change — heavier and off-pattern.
The full dish array is already in the client component, so sorting there is instant.

Trade-off: the client needs every sort dimension present on the `Dish` objects. The
owner profile query is extended to compute the missing aggregates (cook count, avg
rating, rating count). The visitor query stays minimal and visitors only get the
public-safe sorts (cook/rating data is owner-private — never sent to visitors).

## Sort options

Shared (everyone, incl. anon visitors):
- **Suggested** (default) — reproduces today's order: `favorite` first, then most
  recently cooked, then newest. No visual regression for existing users on load.
- **Recently added** — `createdAt` desc.
- **Oldest first** — `createdAt` asc.
- **Name (A–Z)** — `title`, locale-aware, case-insensitive, numeric.

Owner-only (needs cook log data):
- **Most cooked** — total cook count desc.
- **Recently cooked** — `lastCookedAt` desc, nulls last.
- **Top rated** — `averageRating` desc nulls last, tiebreak rating count.

All comparators end with a stable `id` tiebreak so equal keys keep a deterministic order.

## Data change

`cook_log` has no "total cooks" exposed today — only `rating_count` (rows *with* a
rating) and `avg_rating`. "Number of cooks" = **all** cook_log rows. So:

1. Add `cookCount: number` to the `Dish` type and `rowToDish` (reads `row.cook_count`,
   defaults `0` when the column isn't selected — backward compatible with every other
   dish query).
2. Extend the **owner** branch of the `app/u/[handle]/page.tsx` query to also select
   `cook_count`, `avg_rating`, `rating_count` subqueries (the visitor branch is left
   untouched — public-safe minimal payload). Keep the existing `ORDER BY` so SSR still
   renders the "Suggested" order (matches the client default → no hydration flash).

No DB schema/migration change — these are correlated subqueries over existing tables.

## New pure module (TDD target)

`lib/dish-sort.ts`:
- `type SortKey` — the 7 keys above.
- `SORT_OPTIONS: { key, label, ownerOnly }[]` and `DEFAULT_SORT = "suggested"`.
- `availableSortOptions(isOwner)` — filters out owner-only for visitors.
- `isSortKey(v)` — runtime guard for the persisted localStorage value.
- `sortDishes(dishes, key)` — pure, non-mutating, stable; generic over a structural
  `SortableDish` subset of `Dish` so tests build light objects.

Comparator details:
- Suggested: favorite desc → lastCookedAt desc nulls last → id desc.
- recent: createdAt desc → id desc. oldest: createdAt asc → id asc.
- name: `localeCompare(sensitivity:"base", numeric:true)` → id asc.
- cooked-most: cookCount desc → lastCookedAt desc nulls last → id desc.
- cooked-recent: lastCookedAt desc nulls last → id desc.
- rating: averageRating desc nulls last → ratingCount desc → id desc.

## UI

`DishGrid` becomes stateful: holds `sort` (default `DEFAULT_SORT`), hydrates from
`localStorage["dishSort"]` after mount (same pattern as the spinner — avoids hydration
mismatch), persists on change, falls back to default if the persisted key isn't in the
viewer's available options. Sorts via `useMemo(() => sortDishes(dishes, sort), …)`.

A compact, accessible sort control sits in the grid's header row (right side). Use a
native `<select>` styled to the design tokens (`appearance-none`, `filter` + `chevD`
icons) — native is keyboard/mobile accessible for free and needs no outside-click logic.
The "N shown on your public page" note moves under the section label so the right side
is just the control.

## Test plan (red first)

`lib/dish-sort.test.ts` (node:test + tsx):
- each sort key orders a fixed fixture as expected (incl. nulls-last for never-cooked /
  never-rated);
- `sortDishes` does not mutate its input and returns a new array;
- ties broken deterministically by id;
- `availableSortOptions(false)` excludes owner-only keys; `(true)` includes all;
- `isSortKey` accepts valid keys, rejects junk/owner-only-correctly (it just validates
  membership, owner-gating is separate).

## Steps

1. (red) Write `lib/dish-sort.test.ts`. 2. (green) Implement `lib/dish-sort.ts`.
3. Add `cookCount` to `Dish` + `rowToDish`. 4. Extend owner profile query.
5. Wire the sort control + state into `DishGrid`. 6. `tsc --noEmit`, run tests, `next build`.
7. Commit on feature branch → merge → version bump + CHANGELOG → push → mark roadmap shipped.

## Out of scope

Spinner pick order (random by design); `/plan`; server-side/shareable sort URLs;
sorting the `/api/dishes` payload.
