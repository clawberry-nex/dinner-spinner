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

### Singularize `lasagna sheets` in STANDARD_INGREDIENTS

The entry in `lib/vocabulary.ts::STANDARD_INGREDIENTS` is plural, against
the "always singular" rule codified everywhere else. Cosmetic only;
aggregation still works because every dish uses the same form. Rename to
`lasagna sheet` and migrate existing rows via SQL `jsonb_set`.

### Admin: bulk-pin flagged ingredients

Today the "pin to defaults" link is per-ingredient. On a freshly-imported
recipe with 5 new pantry items, you'd click it 5 times. Add a "pin all
flagged pantry items" shortcut at the bottom of the ingredient section
that POSTs all of them in a batch.

### `/plan`: persist meal plan server-side

**Problem.** Meal plan is stored in `localStorage`, so it's lost when you
clear browser data or switch devices.

**Sketch.** New `meal_plan` row (single row or single-user table) holding
the current plan. GET/PUT API. Client still caches in `localStorage` for
instant loads but syncs to server on change.

### Mobile polish pass

The admin form's two-row ingredient layout hasn't been tested on a narrow
screen. Likely needs some flex-wrap adjustments and bigger touch targets
for the pantry/pin buttons.

### Recipe step → ingredient linking

**Problem.** In the recipe markdown, ingredient names are plain text.
Clicking them could scroll the ingredient list into view (or highlight
the row). Bonus: auto-check off ingredients as you follow the recipe.

**Sketch.** Nice-to-have. Probably needs a custom ReactMarkdown renderer
that spots ingredient names in the text and wraps them in clickable spans.
Accuracy depends on how consistently the recipe text uses the same form
as the ingredient `name`.

## Non-obvious wishlist

### Multi-unit shopping list items

Related to unit conversion but distinct: when aggregation can't collapse
because units truly differ (e.g. `2 can coconut milk` + `400 ml coconut
milk`), the current list shows them as two separate lines. Could render
them grouped under one heading: `coconut milk: 2 can + 400 ml` so it's
clearer they're the same thing.

### Ingredient substitutions

"Use butter or olive oil" kind of flexibility. Would need a new schema
(either a `substitutes: string[]` array on the ingredient, or a separate
concept entirely). Low priority — most recipes are fine as-written.

### Nutritional info per serving

Calories, protein, fat, carbs. Would either need a massive database of
ingredient nutrition or a third-party API (Edamam, Spoonacular). Meaningful
work; skip until there's a real reason to want this.
