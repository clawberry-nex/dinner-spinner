# Dinner Spinner — Roadmap

Brainstorm pool for future sessions. Nothing here is committed — pick and
prioritize as needed. Items are grouped by "why" rather than "when". Each
entry is a short problem statement + a sketch of an approach so the next
session can pick it up cold.

## Known limitations

_All three items in this section were implemented in commit `670c431`.
Cross-ingredient density conversion (`cup flour ↔ g flour`) is still a
gap — documented under "Non-obvious wishlist" below._

### ~~Unit conversion in aggregation~~ ✅

Implemented via `lib/units.ts`. Weight (`g/kg/oz/lb`) and volume
(`ml/l/tsp/tbsp/cup/fl oz`) convert to canonical units before aggregating,
then display in the biggest sensible unit (kg/g, l/ml). Count/imprecise
units still group by literal. Density-based cross-category conversions
(cup flour ↔ g flour) remain out of scope — no per-ingredient density
table.

### ~~"Unscalable" flag for ingredients~~ ✅

Implemented as an optional `scalable: boolean` field on `Ingredient`.
`scalable: false` makes `scaleIngredient()` a no-op for that ingredient.
Admin form has a "fixed" checkbox next to "pantry".

### ~~Optional ingredients~~ ✅

Implemented as an optional `optional: boolean` field. Excluded from the
shopping list by default; `/plan` has an "include optional" toggle.
Dish detail + cook mode render an `(optional)` suffix.

## Feature ideas

### ~~Dish images~~ ✅ (URL input)

Shipped as a URL-paste flow: new `image_url` column on `dishes`, URL
input on the admin form with a live preview, hero image at the top of
`/dishes/[id]`, 48×48 thumbnail on `/dishes`. Placeholder gradient when
no image.

**Open follow-up**: a Vercel Blob store (`dinner-spinner-images`,
`store_ZNW6YfxPkg7c0mOr`, `iad1`) was already created but couldn't be
linked to the project via the CLI (needs an interactive dashboard
step). When that's wired up and `BLOB_READ_WRITE_TOKEN` is available
as an env var, swap the URL input for a file upload that uses
`@vercel/blob`'s `put()` server-side under a new `/api/upload` route.

### ~~Text search on `/dishes`~~ ✅

Shipped. Client-side filter input that matches against title +
subtitle, combined with the tag filter and the new "favourites only"
toggle. About 10 lines of logic in a `useMemo`.

### ~~Favourite dishes~~ ✅

Shipped. New `favorite` boolean column. Star button on dish detail,
star toggle on `/dishes`, filter chip for "just favourites", and a
favourite-aware weighted spinner. Dedicated `PATCH /api/dishes/[id]/favorite`
endpoint for the toggle so the client doesn't have to resend the whole
dish.

### ~~Cooking history~~ ✅

Shipped. New `cook_log` table (`dish_id`, `cooked_at`), `POST /api/cook-log`,
and the dish list response includes `lastCookedAt` via a correlated
subquery. "Cooked it" button on the dish detail page. "last cooked X
ago" stamp on the browse list. Spinner de-weights recently-cooked
dishes: `weight × min(1, daysSinceLast/14)`, with a 0.05 floor so a
dish cooked today isn't impossible. Favourites get 2× base weight.

### ~~Copy-dish shortcut~~ ✅

Shipped. "copy" button next to edit/delete in `/admin` populates the
draft with the source dish's fields, id cleared, title suffixed with
" (copy)". One handler, no new endpoint.

## Small cleanups / polish

### ~~Singularize `lasagna sheets` in STANDARD_INGREDIENTS~~ ✅

Done. Renamed to `lasagna sheet` in `lib/vocabulary.ts` + SQL
`jsonb_set` migration on existing rows.

### ~~Admin: bulk-pin flagged ingredients~~ ✅

Done. A `pin N pantry items to defaults` button appears below the
ingredient section whenever the current draft has pantry-flagged names
that aren't yet in the curated set.

### ~~`/plan`: persist meal plan server-side~~ ✅

Done. New `meal_plan` single-row table + `/api/meal-plan` GET/PUT with
admin auth. Shared `lib/meal-plan.ts` module exposes `useMealPlan()`
(for `/plan` and the browse page) and `mutatePlan()` (for the dish
detail "Add to plan" button). Reads localStorage first for instant UI,
then syncs from server. Writes to both, fire-and-forget PUT. Silently
falls back to localStorage-only if the user isn't admin-authed.

### ~~Mobile polish pass~~ ✅

Done. Admin ingredient row: narrower inputs that flex-wrap on narrow
screens, `text-base` (16px) font-size to prevent iOS auto-zoom on
focus, `inputMode="decimal"` on the quantity field, bigger touch
targets on the remove button and the checkbox labels.

### ~~Recipe step → ingredient linking~~ ✅

Done in cook mode. `linkifyStep` in `app/dishes/[id]/cook/cook-view.tsx`
scans step text for ingredient names (greedy longest match, plural
tolerance, word boundaries) and wraps each match in a clickable button.
Tapping scrolls the ingredient row into view and briefly highlights it.
`stopPropagation` so it doesn't toggle step-done. Dish detail page
still renders plain — only cook mode has the linking.

## Non-obvious wishlist

### ~~Multi-unit shopping list items~~ ✅

Done. `groupByName` in `lib/ingredients.ts` groups aggregated rows by
`(name, descriptor)` so `2 can coconut milk` + `400 ml coconut milk`
render as `2 can + 400 ml coconut milk` on one line. Todoist receives
pre-formatted strings via a new `{tasks: string[]}` body shape on
`/api/todoist` (the old `{ingredients}` shape still works for
backward-compat with curl scripts).

### ~~Ingredient substitutions~~ ✅

Done as a minimal schema: optional `alternatives?: string[]` on
`Ingredient`. Dish detail and cook mode render `(or X, Y)` after the
primary name. Shopping list uses only the primary. Admin form has a
compact `alternatives (comma-separated)` input below each ingredient
block. Quantity-differentiated alternatives (e.g. "60g butter OR 60ml
olive oil") aren't supported yet — keep it simple.

### Nutritional info per serving

Calories, protein, fat, carbs. Would either need a massive database of
ingredient nutrition or a third-party API (Edamam, Spoonacular). Meaningful
work; skip until there's a real reason to want this.
