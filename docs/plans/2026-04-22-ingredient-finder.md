# What can I cook? — ingredient-based dish finder

Roadmap id `o-EpP4GZAmCw`. Complexity: m. Target version: **0.13.0**.

## Problem

Today the homepage offers two browse modes: **mood** (tag filter) and
**randomness** (spin). Neither answers the pragmatic question "I have
half an aubergine and some tomatoes about to turn — what can I cook?"
The data is already there — every dish has a structured `ingredients[]`
with normalized singular `name` fields. We just don't surface it.

## Desired behaviour

- A third mode on the homepage: **"What can I cook?"**
- User types / picks 2–3 ingredients.
- Server returns the set of dishes containing any of those ingredients,
  ranked by **match count** (most matches first) then by **average
  rating** (highest first) then by **title** (stable alphabetical).
- Each result shows its matched ingredients and the match count
  (`2 / 3 matches`).
- The ingredient set can be handed to the spinner: the spinner dial
  shows only the matching dishes, and the same `pickWithRationale`
  weighting runs over that pool.

## Non-goals

- **No fuzzy matching.** `tomato` does not match `cherry tomato`
  automatically. The user's standardized-name discipline (see AGENTS.md)
  is what makes this feature work. We do exact lowercase-trim matches on
  `name`, plus `alternatives[]` (so "butter" matches a dish that has
  "olive oil" with alternative "butter"). If this turns out to be too
  strict in practice, a future iteration can look at token overlap.
- **No ingredient-category buckets.** Just the raw normalized name.
- **No AND-mode / all-match requirement.** We rank, so "must match all"
  is unnecessary — the top results will naturally have all three.
- **Pantry ingredients are eligible but low-signal.** If the user types
  "salt", every dish matches and ranking collapses. We therefore
  **exclude ingredients flagged as pantry** from the match count — a
  recipe containing "salt" is not boosted for selecting "salt". This
  also means typing only pantry staples yields zero ranked matches,
  which is the right behaviour (every dish has salt).

## Design

### Pure ranking helper (`lib/ingredient-search.ts`, unit-tested)

```ts
export type SearchableDish = {
  id: number;
  title: string;
  ingredients: Array<Pick<Ingredient, "name" | "alternatives" | "pantry">>;
  averageRating: number | null;
};

export type Match = {
  dish: SearchableDish;
  matchCount: number;
  matchedNames: string[];    // the query terms that hit, in query order
};

export function normalizeIngredientQuery(raw: string): string[];
// lowercases, trims, dedupes, drops empties; stable order.

export function matchDishes(dishes, query): Match[];
// excludes dishes with matchCount === 0
// ranked: matchCount desc, averageRating desc (null → 0), title asc

export function ingredientMatchSet(dish): Set<string>;
// all lowercased-name ingredients excluding pantry, flattened with alternatives
```

Tests in `lib/ingredient-search.test.ts`:

- empty query → empty result
- `["tomato"]` matches a dish containing `tomato`
- pantry-flagged `salt` in dish is not a match for query `salt`
- a dish with ingredient `butter` and `alternatives: ["olive oil"]`
  matches `olive oil`
- ranking: 3-match beats 2-match beats 1-match
- tie-break: same matchCount → higher averageRating first
- tie-break: same matchCount + rating → title asc
- `normalizeIngredientQuery` dedupes, trims, lowercases, drops blanks

### API

Extend `GET /api/dishes` to accept `?ingredients=tomato,aubergine`
(comma-separated). When present:

- Build the matches via `matchDishes` over the existing row set (same
  rating sub-queries).
- Response row type grows two fields:
  `matchCount: number` and `matchedNames: string[]`.
- Ordering in the response is the ranked order.
- Ingredient filter and `tags=` filter compose (AND). If both are
  passed, dishes must match the tag filter AND have `matchCount >= 1`.

The ranking happens in JS (not SQL). The dataset is small (< 200 dishes)
and ranking logic with tie-breaks by rating + title stays simpler and
better-tested in JS than in SQL. When the DB grows we can revisit.

A new top-level type `Match` / `DishWithMatch` would ripple through the
whole app. Instead we attach the optional fields directly to the `Dish`
shape:

```ts
// lib/types.ts
export type Dish = {
  ... existing fields ...
  matchCount?: number;
  matchedNames?: string[];
};
```

The fields are only populated when the query includes `ingredients=`.
`rowToDish` doesn't set them; the API route layers them on after
ranking.

### UI — Homepage modes

The homepage becomes a 2-mode toggle:

- **Spin** — existing flow (default).
- **Pantry** — "What can I cook?"; shows an ingredient chip picker and
  a ranked dish list.

Mode is local component state plus URL query: `?mode=pantry` deep-links
into the pantry mode. No localStorage for mode — this is a session
intent, not a setting.

The pantry-mode UI:

```
┌─ Tonight · Wednesday ─────────────────┐
│ What can I                            │
│ cook?                                 │
│ <small: typing ingredients ...>       │
│                                       │
│ [🍅 tomato ×] [🍆 aubergine ×]        │
│ + add ingredient                      │
│                                       │
│ 3 dishes match                        │
│ ┌───────────────────────────────────┐ │
│ │ DishArt  Aubergine parmigiana     │ │
│ │          2 / 2 · tomato, aubergine│ │
│ └───────────────────────────────────┘ │
│ ...                                   │
│ [Spin these] (only if >= 2 dishes)    │
└───────────────────────────────────────┘
```

The input is a text field with a `<datalist>` of ingredient names
sourced from `/api/ingredient-names` union `STANDARD_INGREDIENTS`.
Selecting a suggestion / pressing Enter adds a chip and clears the
input. A chip has an `×` to remove.

"Spin these" sets `mode=spin` and passes the matching dish IDs via a
`pool` query param so the spinner can honour the set without re-querying
with the ingredients (matchCount tie-breaking would be irrelevant in the
spinner — the weighting is the rating/favorite/recency logic that
already exists).

Concretely: `router.push('/?mode=spin&pool=1,5,8')`. Spin mode, if
`pool` is present, filters the dish list to that ID set before rendering
the wheel. Tag chips are hidden in that case (since the set is
constrained differently) — we show a small "showing 3 dishes matching
tomato + aubergine · clear" breadcrumb that clears `pool` and returns to
normal spin.

### Autocomplete source

Same pattern as admin: merge `STANDARD_INGREDIENTS` with the names in
use across dishes (from `/api/ingredient-names`). Dedupe lowercase.

## File changes

- **add** `lib/ingredient-search.ts` (pure helper, TDD)
- **add** `lib/ingredient-search.test.ts`
- **edit** `lib/types.ts` — add optional `matchCount`, `matchedNames` to `Dish`
- **edit** `app/api/dishes/route.ts` — handle `?ingredients=`
- **edit** `app/page.tsx` — mode toggle, pantry UI
- **add** `app/_components/ingredient-picker.tsx` — reusable chip input
- **edit** `package.json` — bump to 0.13.0
- **edit** `CHANGELOG.md` — entry if file exists (check first; create if not)
- **edit** `docs/plans/` — this file

## Decisions made (no human to ask)

1. **Ranking scope: any-match, not all-match.** Rationale: "all-match"
   with 3 chips and strict names often returns zero dishes; the user
   experience suffers. Ranked any-match gracefully degrades: a perfect
   3/3 hit wins; a partial 2/3 still shows.
2. **Pantry items excluded from match count.** See Non-goals above.
3. **Alternatives count as matches.** A dish listing "butter" with
   `alternatives: ["olive oil"]` matches a query for "olive oil". This
   mirrors the user's mental model: "I have olive oil — what can I
   cook?" should surface a recipe that tells you to use butter *or*
   olive oil.
4. **Descriptor-less name matching.** `green chili` and `red chili` are
   distinct names and therefore match independently. That's consistent
   with how aggregation already works.
5. **No new table, no SQL ranking.** Keep the feature DB-schema-free so
   it ships fast and is easy to revert. Re-evaluate if the dish list
   grows past a few hundred.
6. **URL-driven, not localStorage-driven.** Mode + pool in the URL so
   shares / reloads preserve state; clears on next spin.
7. **Version bump 0.12.1 → 0.13.0.** New user-facing feature = minor.

## Verification

After deploy, against prod URL:

```bash
BASE=https://dinner-spinner-lake.vercel.app

# tomato only
curl -sS "$BASE/api/dishes?ingredients=tomato" | jq 'map({title, matchCount, matchedNames}) | .[:5]'

# tomato + aubergine combined
curl -sS "$BASE/api/dishes?ingredients=tomato,aubergine" | jq '.[0:5]'

# empty ingredient query → all dishes, no matchCount field populated
curl -sS "$BASE/api/dishes?ingredients=" | jq 'map(has("matchCount")) | unique'

# tag + ingredient composition
curl -sS "$BASE/api/dishes?tags=vegetarian&ingredients=tomato" | jq 'length'
```

Manually:
- Visit `/`, toggle to pantry mode, type "tomato", confirm results.
- "Spin these" narrows the spinner pool.
- Deep-link `/?mode=pantry` boots into pantry mode.
