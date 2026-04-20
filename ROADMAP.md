# Dinner Spinner — Roadmap

Brainstorm pool for future sessions. Nothing here is committed — pick and
prioritize as needed. Items are grouped by "why" rather than "when". Each
entry is a short problem statement + a sketch of an approach so the next
session can pick it up cold.

## Next up

A fresh batch of ideas after the first round shipped most of the v1 wishlist.

### Recipe import from URL

**Problem.** Adding a recipe means either typing it from scratch or pasting
into Nex and asking the agent to parse. Fine for the occasional dish, tedious
if you're trying to batch-import a dozen things from a food blog.

**Sketch.** New admin action: paste a URL → `POST /api/import` fetches the
page server-side, extracts a `schema.org/Recipe` JSON-LD block (most food
blogs embed one), maps to the dinner-spinner shape, pre-fills the admin
form. When JSON-LD isn't present, fall back to showing the page title and
leaving the form empty. Ingredient mapping still relies on the existing
vocabulary + pantry defaults logic — so imported rows still get pantry
flags and canonical names applied on save. Bonus: a retry button that
re-runs parsing if the initial extraction is off.

### ~~Week-view meal plan~~ ✅

Shipped in v0.4.0. `meal_plan` entries now carry an optional
`day?: 0..6` (0 = Monday). `/plan` renders a Pool column plus seven
day columns; each dish card has an inline day-picker chip row for
tap-to-move (HTML5 drag-and-drop deferred as a desktop polish
stretch). `lib/week-plan.ts` is the pure core —
`groupByDay`/`moveEntry`/`resetWeek` — with tests in
`lib/week-plan.test.ts`. "Reset week" strips day assignments without
removing dishes; "Clear all" still nukes the plan. Shopping-list
aggregation is unchanged: the whole week's entries flow in regardless
of slot.

### ~~Timers in cook mode~~ ✅

Shipped. `lib/timer-parse.ts::findTimers` extracts duration phrases
(`15 min`, `1 hour`, `1.5 hours`, `30min`, `2 hrs`) from step text.
`linkifyStep` now merges ingredient and timer spans non-overlappingly and
renders timer matches as amber inline buttons with a ⏱ glyph. Clicking
spawns a countdown in `useTimers` (React state, 250ms tick) and
`TimerPanel` stacks them fixed bottom-right. Finished timers play a
two-tone Web Audio beep, flash red, and stay until dismissed. Multiple
concurrent timers supported.

### ~~Dietary tags (auto-derived)~~ ✅

Shipped in v0.5.0. `lib/diet.ts` owns the per-ingredient attribute
table plus `computeDietFlags(ingredients)` which returns
`{ vegetarian, vegan, contains: Set<Allergen> }`. Allergens covered:
`dairy | eggs | gluten | nuts | fish | shellfish | soy`.
Classification is asymmetric on purpose — we only downgrade
vegetarian/vegan on a *positive* animal cue (table hit or substring
like `beef`/`chicken`), so unknown ingredients never accidentally
flip a dish non-veg. Allergen flags, conversely, err on the side of
warning. Dish detail renders a read-only chip row under the tag row;
`/dishes` gets a new "Diet" chip group in the filter sheet with
`vegetarian | vegan | no dairy | no gluten | no nuts` applied AND-wise
alongside existing tag filters. Nothing is persisted — editing an
ingredient updates the classification on next render.

### Star ratings + cook notes

**Problem.** After cooking a dish, you've got real feedback: "the chili
was too much", "need to halve the sugar next time", "kids loved it". No
place to put that today, and the spinner has no signal beyond the binary
favourite flag.

**Sketch.** Extend `cook_log` with `rating smallint` (1–5, nullable) and
`note text`. Dish-detail "Cooked it" button opens a small form: stars +
note textarea. History section on the dish detail shows past cooks with
their notes. Average rating feeds into spinner weight (favourites become
"anything ≥ 4"). Notes render as timestamped sticky notes above the
recipe.

### Remember last-chosen servings per dish

**Problem.** Every time you visit a dish page, servings resets to
`baseServings`. If you usually cook for 6 people, you re-click the +
button every single time.

**Sketch.** Store `lastServings` in localStorage keyed by dish id on
every stepper change. Dish detail reads it on mount, falling back to
`baseServings`. Small "reset to base" link next to the stepper. Pure
client-side, no API.

### ~~PWA / install prompt~~ ✅

Shipped in v0.7.0. `app/manifest.webmanifest` with 192/512 +
maskable icons under `public/icons/`, matching the warm
cream/burnt-orange palette. Metadata-driven `<link rel="manifest">`,
`theme-color` viewport entries (light/dark), and `apple-touch-icon`
are wired up in `app/layout.tsx`. Hand-rolled `public/sw.js` (no
`next-pwa`): precaches the app shell (`/`, `/dishes`, `/offline`,
manifest, icons); network-first for navigations and
`/api/dishes/*` so recently-viewed dishes stay readable offline;
cache-first for `/_next/static`; stale-while-revalidate for
auxiliary APIs (tags, pantry defaults) and fonts/images; admin and
auth traffic is explicitly not cached. `lib/install-prompt.ts` +
tests hold the pure helpers (iOS UA detection, standalone
detection, 30-day dismissal cooldown); `app/_components/pwa.tsx`
registers the SW in production, captures
`beforeinstallprompt` on Android, and shows a Share-sheet hint on
iOS. Static `/offline` fallback page renders when both network and
runtime cache miss.

### Export / import JSON backup

**Problem.** All dishes live in one Neon Postgres row — you're trusting
Neon's backups for DR. A one-click "download everything as JSON"
button costs nothing and unblocks quick recovery + portability.

**Sketch.** `/admin` button → `GET /api/dishes?format=export` returns
all dishes (including pantry_names and meal_plan) as a single JSON
payload. "Import" button on the same page accepts that JSON,
upserting by id. Two handlers, no new routes needed if we extend
`/api/dishes` with a query param.

### Spinner "why this one?" explanation

**Problem.** The spinner silently weights favourites and recency, but
you have no way to know why a given dish came up. When it keeps
picking the same thing, you can't tell if the weighting is broken or
just unlucky.

**Sketch.** Return a 1-line rationale alongside the picked dish on
the spinner result: "picked from 7 vegetarian dishes; favourite
(2×); cooked 3 weeks ago (0.83×)". Tiny UI addition, trust builder.
Logic already exists in `pickWeighted` — just return the chosen
weight breakdown.

### Drag-to-reorder ingredients in admin

**Problem.** Ingredient order matters for the recipe read-through.
Today, inserting an ingredient in the middle means typing it at the
end and… that's it. No reorder at all.

**Sketch.** Add a ⋮⋮ grip handle to each ingredient row. Use the
native HTML5 drag-and-drop API for simplicity (no library). Reorder
mutates `draft.ingredients` array on drop. Keyboard-accessible
alternative: "move up / move down" buttons next to the × remove
button.

### Per-dish notes field

**Problem.** The recipe markdown holds the cooking steps. But there's
no good spot for persistent meta-notes like "Finn won't eat this if
there are mushrooms" or "Usually 1.5× the chili" that should stay
out of the recipe body.

**Sketch.** New `notes text` column on `dishes` (nullable). Admin
form has a small "Notes" textarea, separate from the recipe textarea.
Dish detail renders it as a yellow sticky-note style box above the
ingredient section, hidden when empty. Unlike ratings/cook-notes,
this is a single persistent note per dish — a "scratch pad" rather
than a log.

### Temporary skip ("don't spin this")

**Problem.** Sometimes you've got leftovers and specifically don't
want a dish to come up for a few days, but you don't want to
permanently unfavourite or delete it.

**Sketch.** Optional `skip_until timestamptz` column on `dishes`.
Button on dish detail: "skip for 3 / 7 / 14 days" → sets
`skip_until` to `now() + interval`. Spinner filters out dishes where
`skip_until > now()`. `/dishes` shows a small "skipped for Nd" chip
on those rows with a clear button. Expires silently — no cron
needed, just a comparison in the query.

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
