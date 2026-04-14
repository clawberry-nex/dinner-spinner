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

### Dish images

**Problem.** Dishes are text-only. The spinner, browse page, and dish
detail would all be more useful with a photo.

**Sketch.** Add an optional `image_url` column on `dishes`. Store images
via Vercel Blob (built-in, no extra service). Admin form gets a file upload
that POSTs to a signed upload URL, then saves the resulting public URL on
the dish. Fallback to a placeholder gradient in the UI.

### Text search on `/dishes`

**Problem.** With enough dishes, tag filtering alone isn't enough. Sometimes
you just want to search for "lasagna" or "curry".

**Sketch.** Postgres full-text search or a simple ILIKE over `title || ' ' ||
subtitle`. Client-side filter input on `/dishes` next to the tag bar.
Trivial — maybe 30 lines.

### Favourite dishes

**Problem.** No way to mark a dish as a favourite or de-prioritize
something you cooked and didn't like.

**Sketch.** New `favorite: boolean` column on `dishes`. Star button on dish
detail and in the browse list. Spinner optionally prefers favourites
(weighted random). Filter chip on `/dishes` for "just favourites".

### Cooking history

**Problem.** The spinner doesn't know what you've cooked recently, so it
might pick the same dish three weeks in a row.

**Sketch.** New `cook_log` table: `(dish_id, cooked_at)`. Mark as cooked
via a button on the dish detail page or automatically on "Send to
Todoist". Spinner can de-weight dishes cooked in the last N days. `/dishes`
can show "last cooked: 12 days ago".

### Copy-dish shortcut

**Problem.** When you want to riff on an existing dish (e.g. "curry madras
but with lamb"), you have to retype everything.

**Sketch.** "Duplicate" button next to "edit" and "delete" in `/admin`.
POSTs a new dish with the source's fields copied, title suffixed with
" (copy)". One-handler implementation.

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
