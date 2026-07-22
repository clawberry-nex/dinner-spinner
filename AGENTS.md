<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Dinner Spinner — project notes

Personal app: spin a button to pick a random dish, scale servings, build a
multi-dish shopping list, push it to Todoist. Multi-user (NextAuth v5 with
Google + email/password). Sign-up is gated by an `ALLOWED_EMAILS` allowlist.

## Deploy topology

- **Production**: https://dinner-spinner.van-willigenburg.nl and https://dinner-spinner-lake.vercel.app (both serve the same Vercel deployment; `main` auto-deploys)
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
- `app/api/dishes/[id]/image/route.ts` — `POST` triggers async photo regeneration (see Non-obvious things). `app/api/dishes/[id]/image/jobs/[jobId]/route.ts` — poll endpoint for the edit-page progress UI.
- `lib/db.ts` — Neon client (throws if `DATABASE_URL` missing)
- `lib/auth.ts` — NextAuth v5 config (Google + Credentials, JWT sessions, allowlist gate, Google upsert with handle assignment). Exports `{ handlers, auth, signIn, signOut }`.
- `lib/auth-helpers.ts` — `parseAllowlist`, `isEmailAllowed`, `hashPassword`, `verifyPassword`, `resolveUserId(req)` (bridges JWT session and env `API_TOKEN` → seed owner), plus `HANDLE_REGEX`, `slugFromEmail`, `assignAvailableHandle` for profile handles. Server-only — client code mirrors the regex inline.
- `lib/ingredients.ts` — `scaleIngredient`, `aggregateIngredients` (groups by lowercased `(name, unit)`), `formatQty`
- `lib/todoist.ts` — Todoist client. Takes per-user `{ token, projectName }` as args (no longer reads env). **Pinned to `/api/v1/`** — the old `/rest/v2/` returns 410. Response shape is `{results, next_cursor}`; handle pagination.
- `lib/pantry.ts` — `applyPantryDefaults(ingredients, userId)`, `getPantryDefaults(userId)` — both user-scoped.
- `lib/dish-image.ts` — `generateAndStoreImage(dish, userId)`: prompt → provider → blob → update dish. Shared by create-route auto-gen and the async regenerate job. **All image generation now goes through the Nex API** (claude-agent's `/api/v1/images`, via `lib/nex-image.ts` + `lib/gemini-batch.ts`) — dinner-spinner no longer calls Gemini/Replicate directly (`GEMINI_API_KEY`/`REPLICATE_API_TOKEN` unused; auth is `NEX_API_TOKEN` with the `images:generate` scope). **Premium-model gating**: premium (seed owner + `PREMIUM_IMAGE_EMAILS`) → `nano-banana-pro` @2K (~$0.134/img); everyone else → `nano-banana-2` @1K (~$0.067/img, Pro-class at flash price). Gate is `lib/auth-helpers.ts::isPremiumImageUser`; `getProvider({ premium })` picks the model. Resilience is Gemini-only (Nex retries 503s; no Replicate fallback).
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

## Environment variables

Production serves more than one hostname. Keep `AUTH_TRUST_HOST=true` and
leave `AUTH_URL` **unset** in Vercel; pinning `AUTH_URL` breaks host-sensitive
auth and share metadata. `AUTH_URL=http://localhost:3000` is acceptable only
for local development.

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled connection string |
| `AUTH_SECRET` | JWT signing key (≥32 chars, e.g. `openssl rand -base64 32`) |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `AUTH_TRUST_HOST` | Set to `true`; NextAuth trusts the incoming Vercel/custom-domain host. |
| `ALLOWED_EMAILS` | Comma-separated lowercased allowlist. Set to `*` to disable. |
| `SEED_OWNER_EMAIL` | Email that owned pre-multi-user data; bearer-token requests resolve to this user. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token used to persist dish images. |
| `NEX_API_TOKEN` | Nex API token with `chat` and `images:generate` scopes; powers recipe ingest and image generation. |
| `API_TOKEN` | Optional bearer for domain API calls from curl/scripts (resolves to seed owner). |
| `TODOIST_API_TOKEN` | Optional seed-owner Todoist fallback. Other users set theirs via `/settings`. |
| `TODOIST_PROJECT_NAME` | Optional seed-owner Todoist project fallback. |
| `PREMIUM_IMAGE_EMAILS` | Optional comma-separated premium-image allowlist; unset means seed owner only, `*` means all users. |
| `CLAUDE_AGENT_URL` | Optional Nex API base override; defaults to the public Funnel endpoint. |
| `CRON_SECRET` | **Optional but recommended.** Bearer that authenticates the batch-import background-completion chain (`/api/import/advance-bg`) and the daily `vercel.json` cron sweep. Unset ⇒ background completion is off and imports only advance while the `/add` tab is open. `openssl rand -hex 32`. |

`.env.example` ships the placeholder template; `.env*` is gitignored except for `.env.example`.

**Intentionally absent in production**: `AUTH_URL`. **Removed** since the
single-admin era: `ADMIN_PASSWORD`, `SESSION_SECRET`. Direct provider variables
such as `GEMINI_API_KEY`, `REPLICATE_API_TOKEN`, `IMAGE_GEN_URL`, and
`IMAGE_GEN_TOKEN` are also unused; all image generation goes through Nex.

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
- **`optional` is about the INGREDIENT, not its amount.** Only set `optional: true` when the source itself marks the ingredient optional — "optional", "(optional)", "to serve", "to garnish". A *flexible quantity* ("to taste", "or less, to taste", "depending on how hot you like it") tunes the amount, NOT whether to include it — a core ingredient (garlic, lemon, agave, curry paste, nutmeg) must never be `optional` just because its quantity is to-taste. (Over-flagging silently drops it from the shopping list.)
- **Quantity & unit fidelity.** Keep the source's unit — never convert one unit to another (`2 lb` stays `2 lb`, not `2 kg`). For dual metric/imperial notation (`400g/14oz`, `5cm/2in`) use the **metric** value/unit. Write fractions as decimals (`½`→`0.5`, `1½`→`1.5`) and **sum compound amounts** into one number (`¼ cup + 2 tbsp` → `0.375 cup`). When the source gives no amount/unit, don't invent a precise one — use its own wording (`a good handful` → qty 1, unit `handful`).
- **A shared amount over several items is not per-item.** `50g chopped mix of parsley, basil and rosemary` is 50g total — split it across the three (or use one combined entry), never 50g each.
- The `recipe` field (cooking method) must be **Markdown numbered steps** ("1.", "2.", …) optionally under `## Section` headers (e.g. `## Make the dough`), written in the target language. **Inline ingredient references**: as you write the method, wrap every mention of an ingredient in a markdown-style link whose target is `#` + that ingredient's 0-based index in the `ingredients` array — `Beat [the eggs](#0) until pale.`, and `[the dough](#0,3,4)` for a phrase that names several (comma-separated indices). Include loose references ("the seeds", "the dough", "the sauce"). The label stays visible to the reader; the `(#index)` is hidden. Cook mode parses these to highlight ingredients as each step is read. Do **not** emit an ingredient `id` — at persistence the indices are rewritten to stable per-ingredient ids (see `docs/adr/0001-inline-ingredient-references.md`); there is no separate `methodRefs` array.

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

1. **Browser** (`<IngestInput>`): compresses photo to ≤2576px JPEG (`lib/image-compress.ts`) at quality 0.92 with a size-budgeted quality step-down that keeps the upload under the 4.5MB body cap, base64-encodes, POSTs to `/api/ingest` with `{input?, image?}`.
2. **`POST /api/ingest`** (`app/api/ingest/route.ts`): auths the user; if the input is a bare URL, scrapes it server-side first (see **URL imports** below); builds the prompt via `lib/ingest/prompt.ts::buildIngestPrompt`, calls claude-agent's `POST /api/v1/chat-async` (`lib/ingest/claude-agent.ts::startClaudeAgentJob`) with `model: image ? "opus" : "haiku"` and the `DISH_INPUT_JSON_SCHEMA`. claude-agent returns `{job_id}` in <1s. Route returns `{jobId, sourceImageUrl}` (HTTP 202) to the browser.
3. **Browser polls** `GET /api/ingest/jobs/[id]` every 1.5s for up to 3 min.
4. **`GET /api/ingest/jobs/[id]`** (`app/api/ingest/jobs/[id]/route.ts`): proxies claude-agent's `GET /api/v1/jobs/{id}` (`pollClaudeAgentJob`). When status flips to `done`, re-validates the `structured` payload against `DishInputSchema` (defense in depth — claude-agent enforces JSON Schema structurally but not all our semantic constraints) and returns `{status: "done", dish}`. On `failed`, returns the error envelope.
5. **Browser** auto-saves the parsed dish (`POST /api/dishes`, carrying `sourceImageUrl` + the `generateImage` toggle), then polls `GET /api/dishes/[id]` until the image lands and redirects to the dish page. (No review step — the manual form is a separate `/add` mode, not part of the ingest result.)

Why async — direct calls to `POST /api/v1/chat` from Vercel were hitting the 60s wall on real photos. `/chat-async` + polling makes the Vercel function ~1s regardless of how long the agent takes.

**URL imports** (`lib/ingest/scrape-url.ts`): when `findScrapeableUrl` finds an input dominated by one public http(s) URL, `POST /api/ingest` fetches the page server-side and hands the agent **clean recipe text** instead of the raw URL. This covers both a bare URL and Android Web Share text (title/short snippet + URL, with at most 500 non-URL characters), but deliberately leaves a full pasted recipe containing a source link untouched. Extraction prefers schema.org Recipe JSON-LD (name + `recipeIngredient` + `recipeInstructions`, handling HowToStep/HowToSection), then falls back to stripped page text. Why: heavy pages (a 1.1 MB Shopify food blog) made the agent WebFetch them itself and blow its 8-turn budget ("Reached maximum number of turns (8)"); a scraped page collapses to ~2 KB of text the agent structures in 1–2 turns. The scrape also returns the page's own recipe photo (`sourceImageUrl`, JSON-LD `image[]` → `og:image`/`twitter:image`). On the save, `createDishForUser` **downloads+stores** that photo (`lib/dish-image.ts::storeImageFromUrl` → `uploadDishImage`, never hotlinked) instead of generating one — unless the user ticks **"Generate a new image with AI"** (default off; only shown for URLs), or the download fails (then it falls back to generation). SSRF guard `assertPublicHttpUrl` (http/https only; blocks loopback/private/link-local/metadata hosts) runs on both the page fetch and the image download. On scrape failure or <40 chars extracted, it falls back to passing the raw input.

**Model: Opus for photos, Haiku for text** (`model: image ? "opus" : "haiku"`). Photo ingests run on Opus (`claude-opus-4-8`) for its **high-resolution vision** (up to a 2576px long edge): it reads small printed quantities (½, 175g) far more accurately than Haiku, which is what makes ingredient amounts come out right from a photo. Verified 4/4 valid structured outputs within claude-agent's 8-turn budget. Text-only ingests have no OCR problem, so they stay on Haiku — ~30× cheaper (~$0.005 vs ~$0.15/photo) and equally reliable. With the anyOf-free tool schema (see below) both models reliably call `submit_result` with a well-formed payload (incl. inline `[label](#index)` references in `recipe`) inside the 8-turn budget; **Sonnet** is the one to avoid — it exhausted that budget on this heavier translate+annotate prompt. (Not yet gated by user — every photo ingest pays the Opus cost; gate via `isPremiumImageUser` if other users start adding photos.)

**Translation**: the ingest prompt passes the user's `default_language` (from `users.default_language`; NULL = English) and instructs the model to write the `title`, `subtitle`, cooking method, and human-readable fields (`descriptor`, `preparation`) in that language. Ingredient `name` fields and `imageDescription` always stay canonical English (to keep aggregation and pantry matching language-neutral).

**No fabrication**: the prompt's "GROUND TRUTH" block (`lib/ingest/prompt.ts`) forbids inventing content the input doesn't contain — omit `recipe` when there are no instructions, return empty `ingredients` when none are listed, and keep the title faithful (don't rename into a different dish). Added after a batch stress test where Haiku fabricated a full method + 18 ingredients from a title-only source.

**Structured outputs from ingest** (`DISH_INPUT_JSON_SCHEMA`, `lib/ingest/schema.ts`):
- `ingredients[].section` — recipe part (e.g. `"Dough"`, `"Filling"`). Display grouping; never splits the shopping list.
- `recipe` — Markdown numbered steps under optional `## Section` headers, written in the target language, **with inline `[label](#index)` ingredient references** embedded in the text (`#index` = 0-based ingredient index, comma-separated for several). No separate top-level refs array; persistence rewrites each index to a stable ingredient id. Powers cook-mode highlighting.

**anyOf-free schema requirement (`stripNullFromAnyOf`)**: the `DISH_INPUT_JSON_SCHEMA` is post-processed by `stripNullFromAnyOf` (`lib/ingest/schema.ts`) before being sent to claude-agent. This removes the `{type:"null"}` branch from every `anyOf` in the schema. **This is required** because claude-agent reconstructs the schema via `json-schema-to-zod`, which does not support `anyOf` — it degrades `.nullable()` fields to `z.unknown()`, so a nullable field like `subtitle`/`recipe` would arrive unvalidated. (The old `methodRefs` nested array made this acute — it would arrive as a JSON string instead of an array; moving references inline into `recipe` removed that array entirely, see ADR-0001, but the strip still keeps the remaining nullable fields enforceable.) Keep the ingest schema anyOf-free.

**Literal-`\n` normalization (`normalizeEscapedWhitespace`)**: Haiku's structured output *nondeterministically* fills multiline string fields (notably `recipe`) with the two characters `\n` instead of a real newline; claude-agent passes it through verbatim. `lib/ingest/sanitize.ts::normalizeEscapedWhitespace` converts literal `\n`/`\r\n`/`\t` → real characters on `recipe`/`subtitle`/ingredient `preparation`/`descriptor`/`section`, called in BOTH ingest paths (`app/api/ingest/jobs/[id]` and the batch importer's `createDishFromStructured`). Without it, `parseMethod` — which splits on real `\n` — renders a `## Section`-leading method as a single H2 heading with zero steps, so the dish shows **no method** at all. `parseMethod` (`lib/recipe.ts`) also tolerates literal `\n` as a render-side backstop for any already-stored rows.

**Language setting**: users set their preferred recipe language in Settings → "Recipe language". API: `GET /PATCH /api/me/language`. DB column: `users.default_language` (VARCHAR, NULL = English).

## Batch import (`/add`)

A whole document of recipes (paste or `.txt`) imports via a resumable server-side state machine (one `import_jobs` row; engine in `lib/import/advance.ts`). Statuses: `detecting → detected → parsing → imaging → done` (`failed` on a fatal error). Each poll of `GET /api/import/jobs/[id]` runs **one bounded step** and persists, so the import survives navigation.

- **Detect** (`POST /api/import`): claude-agent splits the document into `{title, text}` chunks via **Sonnet** (`buildDetectPrompt`, `DETECT_JSON_SCHEMA`); chunk text is copied verbatim so the per-chunk parse reuses the single-ingest contract.
- **Parse + create**: each chunk → Haiku parse (`DISH_INPUT_JSON_SCHEMA`) → `normalizeEscapedWhitespace` → `createDishForUser(…, {autoImage:false})` (which assigns ingredient ids + rewrites the method's inline `#index` references to ids). Up to `PARSE_CONCURRENCY` (3) parse jobs in flight.
- **Imaging**:
  - **Premium** (seed owner + `PREMIUM_IMAGE_EMAILS`): large imports (> `IMAGE_SYNC_THRESHOLD`=12) use the `nano-banana-pro` **Nex batch** API (`/images/batch`, polled+applied in slices); small imports use the sync path.
  - **Non-premium**: always the **sync `nano-banana-2` path** (via Nex), generated **concurrently** — `IMAGE_SYNC_SLICE_FLUX`=6 images per step via `Promise.all` (~5–12s each; the constant name is legacy), skipping any dish that already has an image. (`IMAGE_SYNC_SLICE_PREMIUM`=1 keeps slow Nano Banana Pro small-imports to one per step.)
- **Background completion** (`CRON_SECRET`): on confirm — and again on resume — the server kicks `/api/import/advance-bg`, a `CRON_SECRET`-gated self-driving chain (does ~45s of work in `after()`, then hands off to a fresh invocation; capped at `MAX_HOPS`=60; stops on any terminal status) that advances the import to completion **even after the user closes the tab**. Browser polling still drives the live UI; the row's `locked_until` lock serializes the two so they never double-advance. A **daily** `vercel.json` cron (`GET /api/import/advance-bg`) sweeps any stale non-terminal import as a backstop — Hobby allows only daily crons, so the self-chain is the real-time mechanism. Unset `CRON_SECRET` ⇒ background completion is off and the import only advances while the `/add` tab is open (it will freeze mid-imaging if the tab closes). The route is reachable past the NextAuth proxy via its existing Bearer-token bypass.

Failed single-recipe ingests can be inspected for roughly 24 hours before Nex
prunes the job. Follow [docs/operations/ingest-debugging.md](docs/operations/ingest-debugging.md);
never copy a token id/prefix or a pulled production secret into project docs.

## Public demo (implemented, intentionally dormant)

`/demo/*` is an anonymous, read-only experience backed only by the bundled
`lib/demo/dishes.ts` snapshot. It never calls the domain API or database and
uses isolated browser storage. While `DEMO_DISHES` is empty, every demo route
returns 404; this is the current intentional state.

Activation is an explicit content release: pull the current production env,
run `npx tsx scripts/build-demo-snapshot.ts`, review the generated
`lib/demo/dishes.ts` for public-safe content, then commit and deploy that file.
The generator selects up to 20 public, imaged recipes owned by
`SEED_OWNER_EMAIL` and strips `notes` and `imageDescription`. Do not run it as a
routine build step. Design and implementation details live in
`docs/superpowers/specs/2026-06-26-demo-read-only-design.md`.

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
- **Share metadata must stay same-origin.** `app/layout.tsx::resolveSiteUrl` builds `metadataBase` from `x-forwarded-host`/`host`, and the OG image routes are public in `proxy.ts`. Do not replace this with `VERCEL_PROJECT_PRODUCTION_URL`, a fixed production alias, or a production `AUTH_URL`: the app serves multiple domains and WhatsApp drops cross-origin preview images.
- **Handle one-time rename**: `users.handle_changed_at` is `NULL` initially. The first successful PATCH /api/me/profile with a new handle stamps `now()`; subsequent rename attempts return `handle_already_changed`. Existing share links to the old handle will 404 — surfaced in the edit-profile form as a warning.
- **Backup imports** are scoped to the importing user. Dish-id collisions with another user's row are silently no-op'd (the conflict UPDATE is gated by `dishes.user_id = ${userId}`) to prevent cross-user clobber.
- **Cook-mode highlighting** parses inline `[label](#id)` references embedded in the method text (`lib/inline-refs.ts::parseInlineRefs`, each id resolved to an ingredient), falling back **per step** to literal ingredient-name string-matching for any step that carries no inline reference (hand-edited, legacy, or genuinely untagged). See ADR-0001.
- **Dish-photo regeneration is async.** `POST /api/dishes/[id]/image` inserts an `image_jobs` row (`status` pending→done/failed), runs `lib/dish-image.ts::generateAndStoreImage` in Vercel `after()` (`maxDuration=60`), and returns `202 {jobId}`. The edit-page `<DishForm>` polls `GET /api/dishes/[id]/image/jobs/[jobId]` every 2s (up to 3 min) until `done`/`failed`. `image_jobs` rows are pruned (>1 day) opportunistically on each POST — no cron. The create-route's auto-image-gen uses the same `generateAndStoreImage` helper (fire-and-forget via `after()`, no job row). Why async: a synchronous regenerate (~10-30s Nex gen) outran the client and looked "stuck on Generating…" even though the image saved server-side.

## Verification

Local verification (run type generation before TypeScript):

```bash
npm install --include=dev
npx next typegen
npx tsc --noEmit
npm run lint
npm run build
npx --yes tsx --test app/_experiences/config.test.ts lib/*.test.ts lib/**/*.test.ts
```

`npm run lint` is not currently green. In this checkout ESLint also descends
into `.claude/worktrees/v2-redesign`, which accounts for most of its 292 errors;
current `main` also has five errors across `demo-library.tsx`,
`batch-import.tsx`, `profile-view.tsx`, and `claude-agent.test.ts`. Do not
attribute that baseline to an unrelated change without checking paths.

The direct test command currently discovers 286 tests: 280 pass and six are a
known baseline. `install-prompt.test.ts`, `last-servings.test.ts`, and
`meal-plan.test.ts` use top-level await that tsx compiles as CJS; three
`theme.test.ts` assertions still expect the old `system` default while the app
now defaults to `dark`. Do not call either suite green, and treat additional
failures as regressions until these baselines are fixed.

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
