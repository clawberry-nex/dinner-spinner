<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Dinner Spinner — project notes

Personal app: spin a button to pick a random dish, scale servings, build a
multi-dish shopping list, push it to Todoist. Single admin user.

## Deploy topology

- **Production**: https://dinner-spinner-lake.vercel.app (auto-deploys from `main`)
- **GitHub**: [clawberry-nex/dinner-spinner](https://github.com/clawberry-nex/dinner-spinner)
- **Predecessor** (archived, do not push to): [clawberry-nex/dinner-spinner-old](https://github.com/clawberry-nex/dinner-spinner-old) — an earlier MongoDB-based attempt
- **Vercel project**: `clawberry-nexs-projects/dinner-spinner`, linked to the GitHub repo
- **Database**: Neon Postgres (`eu-central-1`, project `ep-summer-forest-alqq4w27`). Single `dishes` table — see `db/schema.sql`.

## Stack

Next.js 16 (App Router) + TypeScript + Tailwind v4 + `@neondatabase/serverless` + `zod` + `react-markdown`. npm. No ORM, no migration framework.

## Where things live

- `app/page.tsx` — spinner (client component, tag filter via `GET /api/tags`)
- `app/dishes/[id]/page.tsx` + `dish-view.tsx` — server fetch + client serving stepper
- `app/plan/page.tsx` — meal plan, aggregates via `lib/ingredients.ts::aggregateIngredients`
- `app/admin/` — password login + dish CRUD UI
- `app/api/` — route handlers; mutation routes accept bearer `API_TOKEN` **or** signed admin cookie
- `lib/db.ts` — Neon client (throws if `DATABASE_URL` missing)
- `lib/auth.ts` — HMAC-signed session cookie + `checkAdminPassword` / `checkApiToken` (all constant-time comparisons)
- `lib/ingredients.ts` — `scaleIngredient`, `aggregateIngredients` (groups by lowercased `(name, unit)`), `formatQty`
- `lib/todoist.ts` — Todoist client. **Pinned to `/api/v1/`** — the old `/rest/v2/` returns 410 (deprecated). Response shape is `{results, next_cursor}`; handle pagination.
- `lib/types.ts` — Zod schemas + `Dish`/`Ingredient` types + `rowToDish` adapter
- `proxy.ts` — admin gate (Next 16 renamed Middleware → Proxy; the file sits at project root and exports `proxy`, not `middleware`). Matcher covers `/admin` and `/admin/:path*`, but the function short-circuits `/admin/login`.

## Env vars (all required in Vercel production env)

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `ADMIN_PASSWORD` | Cleartext password for `/admin` (compared constant-time) |
| `SESSION_SECRET` | HMAC key for admin session cookie, ≥16 chars |
| `API_TOKEN` | Bearer for `POST /api/dishes` from curl/scripts |
| `TODOIST_API_TOKEN` | Todoist API token |
| `TODOIST_PROJECT_NAME` | Name of the Todoist project that shopping tasks land in (`Shopping` in prod) |

`.env.example` ships the placeholder template; `.env*` is gitignored except for `.env.example`.

## Parsing recipes into ingredient rows

When ingesting a pasted recipe, do **not** cram everything into `name`. Each
ingredient is a JSON object:

```ts
{ quantity: number, unit?: string, descriptor?: string, name: string, preparation?: string, pantry?: boolean }
```

| Field | Meaning | Examples | Shown on shopping list? |
|---|---|---|---|
| `name` | Bare purchasable thing | `green chili`, `aubergine`, `tomato`, `garlic`, `red pepper` | always (unless pantry) |
| `descriptor` | Size/quality modifier that changes what you'd buy | `small`, `medium`, `large`, `ripe` | yes (unless pantry) |
| `preparation` | Cut/cook prep | `thinly sliced`, `peeled and cut into 3cm dice`, `chopped`, `trimmed` | **no** (dropped) |
| `unit` | Measurement unit if any | `g`, `ml`, `tbsp`, `piece`, `clove`, `handful` | yes (unless pantry) |
| `quantity` | Number (float OK) | `2`, `0.5`, `110` | yes (unless pantry) |
| `pantry` | True if Mirko always has this in stock | `true` for water, salt, pepper, olive oil, sugar, basic flour | **no** — pantry items are excluded from the shopping list and Todoist push entirely. Still shown on the dish detail in muted italic with a "pantry" badge. |

Rules:
- **`fresh` is implied** — never put `fresh` in `descriptor`. Everything's assumed fresh.
- **Colour that changes the product is part of `name`**, not descriptor. `green chili` and `red chili` are different items; `yellow pepper` and `red pepper` are different items.
- **Normalize to singular in `name`**: `tomatoes` → `tomato`, `small onions` → `onion`. This lets aggregation across dishes actually merge.
- **Use the standard vocabularies in `lib/vocabulary.ts`** for both `unit` and `name` whenever possible. Diverge only when nothing fits — then type a sensible custom value. The admin form uses these as `<datalist>` autocomplete hints.
- **Mark `pantry: true`** on items the user always has in stock. The authoritative list is **user-curated in the DB** (`pantry_names` table) and exposed at `GET /api/pantry-defaults` (no auth). Agents must fetch the list at runtime before ingesting a recipe — the hardcoded `lib/vocabulary.ts::PANTRY_DEFAULTS` set is only used to seed the table on a fresh install and as a fallback if the query fails in `lib/pantry.ts::applyPantryDefaults`. The server re-applies exact-match defaults on every POST/PATCH, but agents should still set `pantry` explicitly using **semantic judgment** for near-matches the exact check would miss: `"cumin"` and `"1 tsp cumin powder"` are both pantry even though neither matches the set exactly; `"smoked paprika"` is not pantry even though plain `"paprika"` might be. When in doubt, don't flag it.
- If an item is truly free-text ("salt and black pepper to taste"), just put it with `unit: "to taste"`, `quantity: 1`, and leave descriptor/preparation empty. Mark `pantry: true` for salt/pepper.

### Standard units (use these when possible)

`g`, `kg`, `oz`, `lb` · `ml`, `l`, `tsp`, `tbsp`, `cup`, `fl oz` · `piece`, `clove`, `wedge`, `slice`, `sprig`, `leaf`, `head`, `bulb`, `stalk`, `bunch`, `handful`, `can`, `jar`, `bottle`, `pack` · `pinch`, `dash`, `splash`, `drizzle`, `to taste`

> Use English: `piece` not `stuks`, `tbsp` not `el`, `tsp` not `tl`, `clove` not `teentjes`, etc. Always singular: `clove` not `cloves`, `sprig` not `sprigs`. The full canonical list lives in `lib/vocabulary.ts::STANDARD_UNITS`.

### Standard ingredient names (use these when possible)

The full list lives in `lib/vocabulary.ts::STANDARD_INGREDIENTS` (~150 items across vegetables, fruits, herbs, spices, proteins, dairy, pantry, nuts, sweets). Notable conventions:

- All **singular**: `onion`, `carrot`, `tomato`, `egg`, `clove` (when used as a name, e.g. for the spice).
- **Compound colours stay together**: `green chili`, `red pepper`, `yellow pepper`.
- **Cuts of meat are explicit**: `chicken thigh`, `chicken breast`, `beef mince`, `pork chop` — never just `chicken` or `pork`.
- **Dairy is specific**: `unsalted butter` is its own entry; so are `double cream`, `sour cream`, `cream cheese`.
- **Sauces & oils stay generic when possible**: `soy sauce` (not "Kikkoman"), `olive oil` (not "extra virgin Italian olive oil unless that matters to the recipe").
- If the recipe needs something not in the list (e.g. `gochujang`, `tahini`, `nduja`, `sumac`), just type it. Don't force a bad mapping.

### Worked examples

```
"2 small onions, cut into 3cm dice"
→ { quantity: 2, unit: "stuks", descriptor: "small", name: "onion", preparation: "cut into 3cm dice" }

"0.5 fresh green chilli, thinly sliced"
→ { quantity: 0.5, unit: "stuks", name: "green chili", preparation: "thinly sliced" }
  (no descriptor — "fresh" is implied; "green" stays with name)

"0.5 large aubergine, peeled and cut into 3cm dice"
→ { quantity: 0.5, unit: "stuks", descriptor: "large", name: "aubergine", preparation: "peeled and cut into 3cm dice" }

"2 medium tomatoes, peeled and chopped"
→ { quantity: 2, unit: "stuks", descriptor: "medium", name: "tomato", preparation: "peeled and chopped" }
  (plural → singular)

"4 cloves garlic, sliced"
→ { quantity: 4, unit: "cloves", name: "garlic", preparation: "sliced" }

"200 g French beans, trimmed"
→ { quantity: 200, unit: "g", name: "French beans", preparation: "trimmed" }
```

## Non-obvious things

- **Next 16 typegen**: `RouteContext<'/api/dishes/[id]'>` and `PageProps<'/dishes/[id]'>` are globally available types generated into `.next/dev/types/` by `next dev`, `next build`, or `next typegen`. If tsc complains about `Cannot find name 'RouteContext'`, run `npx next typegen` first.
- **`params` is a Promise**: always `await ctx.params` / `await props.params` in route handlers and pages.
- **Schema is applied manually**: no migration framework. On first setup (and after schema edits), run `psql "$DATABASE_URL" -f db/schema.sql`. The file uses `CREATE TABLE IF NOT EXISTS` so it's re-runnable for additive changes, but column alterations still need hand-written DDL.
- **Ingredient aggregation does no unit conversion**: `100 g flour` and `1 cup flour` list separately. Aggregation key is `(name.toLowerCase().trim(), (unit||'').toLowerCase().trim())`.
- **Servings scaling** multiplies `quantity * servings / baseServings`. `baseServings` is the source of truth — stored per dish.
- **Tag filter is AND, not OR**: a dish must contain every selected tag. Implemented with Postgres `tags @> $1::text[]`.
- **Auth for mutations**: `POST /api/dishes`, `PATCH|DELETE /api/dishes/[id]`, and `POST /api/todoist` all accept either a valid admin cookie **or** a bearer `API_TOKEN`. The bearer path exists so Mirko can curl-post dishes from scripts without touching the UI.

## Verification

After any deploy, curl these against the production URL to confirm the full chain:

```bash
BASE=https://dinner-spinner-lake.vercel.app
TOKEN="<API_TOKEN>"

# List (should be 200)
curl -sS $BASE/api/dishes

# Tag index
curl -sS $BASE/api/tags

# Filtered spin source (AND semantics)
curl -sS "$BASE/api/dishes?tags=vegetarian"

# Auth gate (should be 401 without bearer)
curl -sS -w '\n%{http_code}\n' -X POST $BASE/api/dishes -d '{"title":"x"}'

# Create via API
curl -sS -X POST $BASE/api/dishes \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"title":"Test","baseServings":4,"ingredients":[{"quantity":2,"unit":"pcs","name":"carrot"}]}'

# Todoist push (creates a real task!)
curl -sS -X POST $BASE/api/todoist \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"ingredients":[{"quantity":1,"name":"test item"}]}'
```
