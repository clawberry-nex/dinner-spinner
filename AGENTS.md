<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Dinner Spinner — project notes

Personal app: spin a button to pick a random dish, scale servings, build a
multi-dish shopping list, push it to Todoist. Multi-user (NextAuth v5 with
Google + email/password). Sign-up is gated by an `ALLOWED_EMAILS` allowlist.

## Deploy topology

- **Production**: https://dinner-spinner-lake.vercel.app (auto-deploys from `main`)
- **GitHub**: [clawberry-nex/dinner-spinner](https://github.com/clawberry-nex/dinner-spinner)
- **Predecessor** (archived, do not push to): [clawberry-nex/dinner-spinner-old](https://github.com/clawberry-nex/dinner-spinner-old) — an earlier MongoDB-based attempt
- **Vercel project**: `clawberry-nexs-projects/dinner-spinner`, linked to the GitHub repo
- **Database**: Neon Postgres (`eu-central-1`, project `ep-summer-forest-alqq4w27`). Schema in `db/schema.sql`. Post-rollout lock-down in `db/lockdown.sql` (one-shot, runs after backfill).

## Stack

Next.js 16 (App Router) + TypeScript + Tailwind v4 + `@neondatabase/serverless` + `zod` + `react-markdown`. npm. No ORM, no migration framework.

## Where things live

- `app/page.tsx` — spinner (client component, tag filter via `GET /api/tags`)
- `app/dishes/[id]/page.tsx` + `dish-view.tsx` — server fetch + client serving stepper. **Anon-readable when `public=true`**; owner-only UI (edit/favorite/cook/plan/notes/history) is hidden for visitors.
- `app/dishes/[id]/edit/page.tsx` — dedicated edit page, wraps `<DishForm>`
- `app/u/[handle]/page.tsx` + `edit-profile.tsx` — public profile page. Owner sees all their dishes (lock badge on private); visitor sees only public. Open-web reachable (no auth required); `<meta name="robots" content="noindex">` set.
- `app/me/page.tsx` — server redirect to `/u/<your-handle>`. Anon → `/auth/signin?callbackUrl=/me`.
- `app/add/page.tsx` — Add Recipe: AI ingest by default, manual form fallback
- `app/plan/page.tsx` — meal plan, aggregates via `lib/ingredients.ts::aggregateIngredients`
- `app/settings/page.tsx` — Profile / Password / Todoist / Pantry / Backup. Entry point is the gear icon on the owner's profile page (not the tab bar). Replaces `/admin` (`/admin` and `/admin/ingest` are 307 redirects for back-compat).
- `app/auth/signin/page.tsx`, `app/auth/signup/page.tsx` — NextAuth sign-in/up UI
- `app/_components/dish-form.tsx` — shared `<DishForm>` used by `/add` and `/dishes/[id]/edit`. Has a **Public** checkbox (default checked) that drives `dishes.public`.
- `app/_components/tab-bar.tsx` — 4 flat tabs + raised center "+" Add. Right side is `Plan · You(user icon → /me)`. **Hidden for anon visitors** so shared profile/dish links render as standalone pages (driven by `isSignedIn` plumbed from `app/layout.tsx` → `RootShell` → `AppShell`).
- `app/api/auth/[...nextauth]/route.ts` — NextAuth handlers
- `app/api/auth/signup/route.ts` — email/password sign-up (subject to allowlist). Assigns a handle on first insert via `assignAvailableHandle`.
- `app/api/me/profile/route.ts` — GET + PATCH for `handle` + `bio`. Handle is one-time editable (gated by `users.handle_changed_at`).
- `app/api/me/todoist/route.ts`, `app/api/me/password/route.ts` — per-user self-management
- `app/api/` — all domain routes are user-scoped. Mutations accept session cookie OR bearer `API_TOKEN` (the latter resolves to the seed owner). See `lib/auth-helpers.ts::resolveUserId`. **`GET /api/dishes/[id]`** is the one exception — it serves public dishes anonymously.
- `lib/db.ts` — Neon client (throws if `DATABASE_URL` missing)
- `lib/auth.ts` — NextAuth v5 config (Google + Credentials, JWT sessions, allowlist gate, Google upsert with handle assignment). Exports `{ handlers, auth, signIn, signOut }`.
- `lib/auth-helpers.ts` — `parseAllowlist`, `isEmailAllowed`, `hashPassword`, `verifyPassword`, `resolveUserId(req)` (bridges JWT session and env `API_TOKEN` → seed owner), plus `HANDLE_REGEX`, `slugFromEmail`, `assignAvailableHandle` for profile handles. Server-only — client code mirrors the regex inline.
- `lib/ingredients.ts` — `scaleIngredient`, `aggregateIngredients` (groups by lowercased `(name, unit)`), `formatQty`
- `lib/todoist.ts` — Todoist client. Takes per-user `{ token, projectName }` as args (no longer reads env). **Pinned to `/api/v1/`** — the old `/rest/v2/` returns 410. Response shape is `{results, next_cursor}`; handle pagination.
- `lib/pantry.ts` — `applyPantryDefaults(ingredients, userId)`, `getPantryDefaults(userId)` — both user-scoped.
- `lib/types.ts` — Zod schemas + `Dish`/`Ingredient` types + `rowToDish` adapter. Also `Profile`/`rowToProfile`.
- `proxy.ts` — NextAuth middleware (Next 16 renamed Middleware → Proxy). Public-path exemptions: `/auth/*`, `/api/auth/*`, manifest/icons/favicon/offline, **`/u/*`, `/dishes/[id]` (page), `GET /api/dishes/[id]`**. Everything else requires a session; API routes return 401 JSON, pages redirect to `/auth/signin`.
- `scripts/backfill-seed-owner.ts` — one-shot: assigns existing rows to seed owner. Run after seed owner's first Google sign-in.
- `scripts/backfill-handles.ts` — one-shot: assigns a profile handle to every user that doesn't have one yet, derived from email local-part with collision suffixes. Run after adding `users.handle`, then `ALTER TABLE users ALTER COLUMN handle SET NOT NULL`.
- `db/lockdown.sql` — second-stage migration (NOT NULL + meal_plan/pantry_names PK changes). Run after backfill.

## Auth model

NextAuth v5 with JWT sessions, no DB adapter. `users` table stores email,
name, image, optional `password_hash` (bcrypt), per-user
`todoist_token` / `todoist_project`, and public-profile fields `handle`
(unique, `[a-z0-9_-]{3,30}`), `bio`, and `handle_changed_at` (NULL until
the user uses their one-time rename). Sign-up is gated by `ALLOWED_EMAILS`
(comma-separated, lowercased; `*` = open). Sign-in providers: Google and
email/password. Both paths call `assignAvailableHandle(slugFromEmail(...))`
on insert so every user starts with a valid handle.

Every domain row has a `user_id` FK to `users(id)`. API routes call
`resolveUserId(req)` from `lib/auth-helpers.ts`, which returns either the
JWT session's `user.id` or, if `Authorization: Bearer $API_TOKEN` matches,
the seed owner's `user_id` (read from `SEED_OWNER_EMAIL`). The bearer path
is the only way for curl-from-scripts to mutate data; per-user token
minting is not yet implemented.

**Public-profile reads are the exception** to the user-scoped model:

- `GET /u/[handle]` (page) — open to anyone with the URL. Visitors see
  only `public=true` dishes; the owner sees all their dishes with a lock
  badge on private ones.
- `GET /dishes/[id]` (page) and `GET /api/dishes/[id]` — anon-readable
  when the dish is `public=true`. Private dishes 404 to non-owners.
- Both routes set `<meta name="robots" content="noindex">` — the share-
  via-link use case doesn't need SEO and we don't want crawlers indexing
  user-generated content by default.

Cross-user **private** reads return **404** (not 403) so existence isn't
leaked. Cross-user **edits** (PATCH/DELETE on another user's dish)
always 404 regardless of visibility.

## Env vars (all required in Vercel production env)

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `AUTH_SECRET` | JWT signing key (≥32 chars, e.g. `openssl rand -base64 32`) |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `AUTH_URL` | Canonical app URL (e.g. `https://dinner-spinner-lake.vercel.app`) |
| `ALLOWED_EMAILS` | Comma-separated lowercased allowlist. Set to `*` to disable. |
| `SEED_OWNER_EMAIL` | Email that owned pre-multi-user data; bearer-token requests resolve to this user. |
| `API_TOKEN` | Bearer for `POST /api/dishes` from curl/scripts (resolves to seed owner). |
| `TODOIST_API_TOKEN` | Optional seed-owner Todoist fallback. Other users set theirs via `/settings`. |
| `TODOIST_PROJECT_NAME` | Optional seed-owner Todoist project fallback. |

`.env.example` ships the placeholder template; `.env*` is gitignored except for `.env.example`.

**Removed** since the single-admin era: `ADMIN_PASSWORD`, `SESSION_SECRET`.

## Parsing recipes into ingredient rows

When ingesting a pasted recipe, do **not** cram everything into `name`. Each
ingredient is a JSON object:

```ts
{
  quantity: number,
  unit?: string,
  descriptor?: string,
  name: string,
  preparation?: string,
  pantry?: boolean,
  scalable?: boolean,     // default true
  optional?: boolean,     // default false
  alternatives?: string[], // e.g. ["olive oil"] for "butter or olive oil"
  section?: string,        // recipe part: "Dough"/"Filling" — display grouping, NOT a shopping-list split
}
```

| Field | Meaning | Examples | Shown on shopping list? |
|---|---|---|---|
| `name` | Bare purchasable thing | `green chili`, `aubergine`, `tomato`, `garlic`, `red pepper` | yes (unless pantry / skipped optional) |
| `descriptor` | Size/quality modifier that changes what you'd buy | `small`, `medium`, `large`, `ripe` | yes (unless pantry / skipped optional) |
| `preparation` | Cut/cook prep | `thinly sliced`, `peeled and cut into 3cm dice`, `chopped`, `trimmed` | **no** (dropped) |
| `unit` | Measurement unit if any | `g`, `ml`, `tbsp`, `piece`, `clove`, `handful` | yes (unless pantry / skipped optional) |
| `quantity` | Number (float OK) | `2`, `0.5`, `110` | yes (unless pantry / skipped optional) |
| `pantry` | True if Mirko always has this in stock | `true` for water, salt, pepper, olive oil, sugar, basic flour | **no** — excluded from shopping list / Todoist entirely. Still shown on dish detail. |
| `scalable` | `false` if the quantity is FIXED regardless of servings. Default = scalable. | `false` for `1 bay leaf`, `1 cinnamon stick`, `1 stock cube`, `1 star anise` | yes, with the literal fixed quantity (scaler is a no-op). |
| `optional` | `true` if the recipe explicitly lists the ingredient as optional / garnish. Default = required. | `true` for `(optional) coriander garnish`, `(optional) chilli flakes`, `lime wedges to serve` | excluded by default; user can opt in via `/plan` toggle. |
| `alternatives` | Alternative ingredient names the user can swap in. Only the primary goes on the shopping list. | `["olive oil"]` for "butter or olive oil", `["ghee"]` for "butter or ghee". | no — only the primary is shopped for. |
| `section` | The recipe part this ingredient belongs to (multi-part recipes). Display-only — grouped on the dish/cook views; never splits the shopping list. | `Dough`, `Filling`, `Toppings` | no (organizational only) |

Rules:
- **`fresh` is implied** — never put `fresh` in `descriptor`. Everything's assumed fresh.
- **Colour that changes the product is part of `name`**, not descriptor. `green chili` and `red chili` are different items; `yellow pepper` and `red pepper` are different items.
- **Normalize to singular in `name`**: `tomatoes` → `tomato`, `small onions` → `onion`. This lets aggregation across dishes actually merge.
- **Use the standard vocabularies in `lib/vocabulary.ts`** for both `unit` and `name` whenever possible. Diverge only when nothing fits — then type a sensible custom value. The admin form uses these as `<datalist>` autocomplete hints.
- **Mark `pantry: true`** on items the user always has in stock. The authoritative list is **user-curated in the DB** (`pantry_names` table, scoped by `user_id`) and exposed at `GET /api/pantry-defaults` (auth required; bearer `API_TOKEN` returns the seed owner's list). Agents must fetch the list at runtime before ingesting a recipe — the hardcoded `lib/vocabulary.ts::PANTRY_DEFAULTS` set is only a fallback in `lib/pantry.ts::getPantryDefaults` if the query fails. The server re-applies exact-match defaults on every POST/PATCH, but agents should still set `pantry` explicitly using **semantic judgment** for near-matches the exact check would miss: `"cumin"` and `"1 tsp cumin powder"` are both pantry even though neither matches the set exactly; `"smoked paprika"` is not pantry even though plain `"paprika"` might be. When in doubt, don't flag it.
- If an item is truly free-text ("salt and black pepper to taste"), just put it with `unit: "to taste"`, `quantity: 1`, and leave descriptor/preparation empty. Mark `pantry: true` for salt/pepper.
- The `recipe` field (cooking method) must be **Markdown numbered steps** ("1.", "2.", …) optionally under `## Section` headers (e.g. `## Make the dough`), written in the target language. The top-level `methodRefs` array lists `{phrase, ingredients[]}` objects where `phrase` is an exact substring of the written method text and `ingredients` is an array of 0-based ingredient indices — used by cook mode to highlight ingredients as each step is read. Every ingredient that appears by name in the method should have a corresponding entry.

### Standard units (use these when possible)

`g`, `kg`, `oz`, `lb` · `ml`, `l`, `tsp`, `tbsp`, `cup`, `fl oz` · `piece`, `clove`, `wedge`, `slice`, `sprig`, `leaf`, `head`, `bulb`, `stalk`, `bunch`, `handful`, `can`, `jar`, `bottle`, `pack` · `pinch`, `dash`, `splash`, `drizzle`, `to taste`

> Use English: `piece` not `stuks`, `tbsp` not `el`, `tsp` not `tl`, `clove` not `teentjes`, etc. Always singular: `clove` not `cloves`, `sprig` not `sprigs`. The full canonical list lives in `lib/vocabulary.ts::STANDARD_UNITS`.

### Standard ingredient names (use these when possible)

The full list lives in `lib/vocabulary.ts::STANDARD_INGREDIENTS` (~200 items across vegetables, fruits, herbs, spices, proteins, dairy, pantry, nuts, sweets). Notable conventions:

- All **singular**: `onion`, `carrot`, `tomato`, `egg`, `clove` (when used as a name, e.g. for the spice).
- **Compound colours stay together**: `green chili`, `red pepper`, `yellow pepper`.
- **Cuts of meat are explicit**: `chicken thigh`, `chicken breast`, `beef mince`, `pork chop` — never just `chicken` or `pork`.
- **Dairy is specific**: `unsalted butter` is its own entry; so are `double cream`, `sour cream`, `cream cheese`.
- **Sauces & oils stay generic when possible**: `soy sauce` (not "Kikkoman"), `olive oil` (not "extra virgin Italian olive oil unless that matters to the recipe").
- If the recipe needs something not in the list (e.g. `gochujang`, `tahini`, `nduja`, `sumac`), just type it. Don't force a bad mapping.

### Worked examples

```
"2 small onions, cut into 3cm dice"
→ { quantity: 2, unit: "piece", descriptor: "small", name: "onion", preparation: "cut into 3cm dice" }

"0.5 fresh green chilli, thinly sliced"
→ { quantity: 0.5, unit: "piece", name: "green chili", preparation: "thinly sliced" }
  (no descriptor — "fresh" is implied; "green" stays with name)

"0.5 large aubergine, peeled and cut into 3cm dice"
→ { quantity: 0.5, unit: "piece", descriptor: "large", name: "aubergine", preparation: "peeled and cut into 3cm dice" }

"2 medium tomatoes, peeled and chopped"
→ { quantity: 2, unit: "piece", descriptor: "medium", name: "tomato", preparation: "peeled and chopped" }
  (plural → singular)

"4 cloves garlic, sliced"
→ { quantity: 4, unit: "clove", name: "garlic", preparation: "sliced" }

"200 g French beans, trimmed"
→ { quantity: 200, unit: "g", name: "French beans", preparation: "trimmed" }
```

## AI ingest pipeline (`/add`)

The ingest flow is **async** because Vercel Hobby caps function duration at 60s and vision on a recipe photo can take 60–90s. Pipeline:

1. **Browser** (`<IngestInput>`): compresses photo to ≤1280px JPEG, base64-encodes, POSTs to `/api/ingest` with `{input?, image?}`.
2. **`POST /api/ingest`** (`app/api/ingest/route.ts`): auths the user, builds the prompt via `lib/ingest/prompt.ts::buildIngestPrompt`, calls claude-agent's `POST /api/v1/chat-async` (`lib/ingest/claude-agent.ts::startClaudeAgentJob`) with `model: "haiku"` and the `DISH_INPUT_JSON_SCHEMA`. claude-agent returns `{job_id}` in <1s. Route returns `{jobId}` (HTTP 202) to the browser.
3. **Browser polls** `GET /api/ingest/jobs/[id]` every 1.5s for up to 3 min.
4. **`GET /api/ingest/jobs/[id]`** (`app/api/ingest/jobs/[id]/route.ts`): proxies claude-agent's `GET /api/v1/jobs/{id}` (`pollClaudeAgentJob`). When status flips to `done`, re-validates the `structured` payload against `DishInputSchema` (defense in depth — claude-agent enforces JSON Schema structurally but not all our semantic constraints) and returns `{status: "done", dish}`. On `failed`, returns the error envelope.
5. **Browser** swaps the form to manual mode with the parsed dish prefilled. User reviews and saves.

Why async — direct calls to `POST /api/v1/chat` from Vercel were hitting the 60s wall on real photos. `/chat-async` + polling makes the Vercel function ~1s regardless of how long the agent takes.

**Model: Haiku** (not Sonnet). With the anyOf-free tool schema (see below), Haiku reliably produces a valid structured payload — including a well-formed `methodRefs` array — within claude-agent's 8-turn structured-output budget. Sonnet was exhausting that budget on the heavier normalized prompt before emitting a valid result.

**Translation**: the ingest prompt passes the user's `default_language` (from `users.default_language`; NULL = English) and instructs the model to write the `title`, `subtitle`, cooking method, and human-readable fields (`descriptor`, `preparation`) in that language. Ingredient `name` fields and `imageDescription` always stay canonical English (to keep aggregation and pantry matching language-neutral).

**Structured outputs from ingest** (`DISH_INPUT_JSON_SCHEMA`, `lib/ingest/schema.ts`):
- `ingredients[].section` — recipe part (e.g. `"Dough"`, `"Filling"`). Display grouping; never splits the shopping list.
- `methodRefs` — top-level array of `{phrase: string, ingredients: number[]}`. `phrase` is an exact substring of the written method text; `ingredients` are 0-based indices into the ingredients array. Powers cook-mode highlighting.
- `recipe` — Markdown numbered steps under optional `## Section` headers, written in the target language.

**anyOf-free schema requirement (`stripNullFromAnyOf`)**: the `DISH_INPUT_JSON_SCHEMA` is post-processed by `stripNullFromAnyOf` (`lib/ingest/schema.ts`) before being sent to claude-agent. This removes the `{type:"null"}` branch from every `anyOf` in the schema. **This is required** because claude-agent reconstructs the schema via `json-schema-to-zod`, which does not support `anyOf` — it degrades `.nullable()` fields to `z.unknown()`. Without stripping, complex fields like `methodRefs` arrive as a JSON string instead of a real array, breaking the whole structured-output contract. Keep the ingest schema anyOf-free.

**Language setting**: users set their preferred recipe language in Settings → "Recipe language". API: `GET /PATCH /api/me/language`. DB column: `users.default_language` (VARCHAR, NULL = English).

## Non-obvious things

- **Next 16 typegen**: `RouteContext<'/api/dishes/[id]'>` and `PageProps<'/dishes/[id]'>` are globally available types generated into `.next/dev/types/` by `next dev`, `next build`, or `next typegen`. If tsc complains about `Cannot find name 'RouteContext'`, run `npx next typegen` first.
- **`params` is a Promise**: always `await ctx.params` / `await props.params` in route handlers and pages.
- **Schema is applied manually**: no migration framework. On first setup (and after schema edits), run `psql "$DATABASE_URL" -f db/schema.sql`. The file uses `CREATE TABLE IF NOT EXISTS` so it's re-runnable for additive changes, but column alterations still need hand-written DDL.
- **Ingredient aggregation converts within same-category units but not across**: weights merge via grams (`1 kg + 500 g → 1.5 kg`), volumes merge via ml (`2 tbsp + 30 ml → 60 ml`). Density conversions (`1 cup flour` ↔ `g flour`) are NOT supported and list separately — we don't have per-ingredient density. Aggregation key is `(name, unitCategory, descriptor)` where category is `weight` / `volume` / literal unit for count/imprecise. See `lib/units.ts` and `lib/ingredients.ts::aggregate`.
- **Servings scaling** multiplies `quantity * servings / baseServings`, unless `scalable: false` (then it's a no-op). `baseServings` is the source of truth — stored per dish.
- **Optional ingredients** (`optional: true`) are excluded from the shopping list by default. `/plan` has an "include optional" toggle that flips it. Pantry and optional flags compose — a pantry+optional item is excluded by both conditions.
- **Tag filter is AND, not OR**: a dish must contain every selected tag. Implemented with Postgres `tags @> $1::text[]`.
- **Auth for everything (with two carve-outs)**: every API route requires a session OR bearer `API_TOKEN` via `resolveUserId(req)`. **Exceptions**: the public-profile page (`/u/[handle]`) and public-dish reads (`/dishes/[id]` page, `GET /api/dishes/[id]`) are anon-readable when the dish is `public=true`. Everything else (mutations, meal plan, cook log, pantry, settings, ingest) still requires a session. The bearer-token path resolves to the **seed owner**'s `user_id`. Per-user token minting doesn't exist yet.
- **Cross-user isolation**: cross-user **private** reads return 404 (not 403). Public dish reads use `WHERE id = $1 AND (public = true OR user_id = $viewer)` so private dishes still 404 to non-owners. PATCH/DELETE still scope by `user_id` so cross-user mutations 404.
- **Tab bar hides for anon visitors**: `app/layout.tsx` calls `auth()` and plumbs `isSignedIn` through `RootShell` → `AppShell`. Anon visitors on `/u/[handle]` or a public `/dishes/[id]` get a standalone-looking page with no bottom nav, matching the share-link mental model.
- **Handle one-time rename**: `users.handle_changed_at` is `NULL` initially. The first successful PATCH /api/me/profile with a new handle stamps `now()`; subsequent rename attempts return `handle_already_changed`. Existing share links to the old handle will 404 — surfaced in the edit-profile form as a warning.
- **Backup imports** are scoped to the importing user. Dish-id collisions with another user's row are silently no-op'd (the conflict UPDATE is gated by `dishes.user_id = ${userId}`) to prevent cross-user clobber.
- **Cook-mode highlighting** resolves ingredient references by first looking up each step phrase in `dishes.method_refs` (ingest-resolved `{phrase, ingredients[]}` pairs), falling back to literal ingredient name string-matching when `method_refs` is absent or a phrase is not found.

## Verification

After any deploy, curl these against the production URL to confirm the full chain. EVERY domain endpoint requires auth now — the bearer-token path resolves to the seed owner.

```bash
BASE=https://dinner-spinner-lake.vercel.app
TOKEN="<API_TOKEN>"

# Unauthenticated should be 401
curl -sS -w '\n%{http_code}\n' $BASE/api/dishes
# {"error":"unauthorized"}
# 401

# Authenticated list (seed owner's dishes)
curl -sS -H "Authorization: Bearer $TOKEN" $BASE/api/dishes | jq 'length'

# Tag index (auth required)
curl -sS -H "Authorization: Bearer $TOKEN" $BASE/api/tags

# Filtered spin source (AND semantics)
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/dishes?tags=vegetarian"

# Sign-up gate
curl -sS -X POST $BASE/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"random@example.com","password":"hunter2hunter2"}'
# {"error":"email_not_allowed"} if not on ALLOWED_EMAILS

# Create via API (as seed owner)
curl -sS -X POST $BASE/api/dishes \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"title":"Test","baseServings":4,"ingredients":[{"quantity":2,"unit":"piece","name":"carrot"}]}'

# Todoist push (creates a real task! seed owner has env fallback for token+project)
curl -sS -X POST $BASE/api/todoist \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"ingredients":[{"quantity":1,"name":"test item"}]}'
```

## Rollout (one-time, when deploying multi-user)

```bash
# 1. Pre-deploy: Google OAuth client created, env vars set in Vercel.
# 2. Schema migration (additive, safe to run against prod):
psql "$DATABASE_URL" -f db/schema.sql

# 3. Deploy. Seed owner signs in with Google (creates their users row).

# 4. Backfill existing rows to seed owner:
SEED_OWNER_EMAIL=you@example.com npx tsx scripts/backfill-seed-owner.ts

# 5. Lock-down (NOT NULL + meal_plan/pantry_names PK changes):
psql "$DATABASE_URL" -f db/lockdown.sql

# 6. Smoke test via the curl section above.
```
