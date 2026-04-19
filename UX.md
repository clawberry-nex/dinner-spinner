# Dinner Spinner — UX Document

A complete account of what the app is, who uses it, and everything they can do in it.

---

## 1. Product summary

**Dinner Spinner** is a personal recipe + meal-planning web app. A single admin (Mirko) maintains a curated library of dishes; anyone visiting the public URL can spin a wheel to pick what's for dinner, view the recipe, scale it to the number of diners, and cook it step-by-step with inline timers. The admin can additionally build a multi-dish meal plan, aggregate a combined shopping list, and push that list straight into Todoist.

**Core loop:** *spin → view → cook* (public) and *spin → view → plan → shop* (admin).

The product is deliberately *small*: one admin, one Postgres database, a handful of pages. Everything else is polish on that core loop — tag filters, favourites, cook-mode timers, pantry-aware shopping lists, Todoist integration.

---

## 2. Personas

### 2.1. The Cook (public, unauthenticated)
- **Who:** anyone with the URL — household members, guests, Mirko himself on a public machine.
- **Goals:** decide what to cook, follow the recipe, not forget what's simmering.
- **Mental model:** this is a "what's for dinner?" button, not a recipe database.
- **Constraints:** no login, no write access beyond an ephemeral local meal plan.

### 2.2. The Curator (admin, authenticated)
- **Who:** Mirko, the single admin user.
- **Goals:** ingest new recipes, fix typos, mark favourites, plan the week's shopping.
- **Mental model:** same app as the public user, plus CRUD tools and server-synced state.
- **Constraints:** single-user admin, password-gated, 30-day sessions.

### 2.3. The Script (API client, programmatic)
- **Who:** curl/scripts posting new dishes from outside the UI (e.g. a Claude agent parsing a pasted recipe).
- **Goals:** create/update dishes and pantry defaults without touching the browser.
- **Mental model:** a thin JSON-over-HTTPS contract, bearer-token authed.

---

## 3. High-level user stories

### 3.1. As the Cook
- **US-C1.** I want to hit one button and be told what to eat, so I can stop arguing with myself in the kitchen.
- **US-C2.** I want to bias the pick toward "quick" or "vegetarian" without having to scroll a list.
- **US-C3.** I want the recipe automatically resized for the number of people eating.
- **US-C4.** I want to browse everything available when I'm not in the mood to gamble.
- **US-C5.** I want a cooking view that keeps my screen awake, walks me step-by-step, highlights the ingredient each step refers to, and runs timers for me.
- **US-C6.** I want to mark a dish as "cooked today" so it's less likely to come up again this week.
- **US-C7.** I want to star dishes I like, so they come up more often.

### 3.2. As the Curator
- **US-A1.** I want to add a new dish — title, image (or emoji + accent fallback), tags, ingredients with structured fields, and a markdown recipe — via a form.
- **US-A2.** I want to edit, duplicate, or delete any dish.
- **US-A3.** I want my pantry staples (salt, oil, onion, …) to be tracked once and auto-excluded from every shopping list. I want to curate that list from the admin UI.
- **US-A4.** I want to build a plan of several dishes, with per-dish servings, and see one combined shopping list.
- **US-A5.** I want to send that shopping list to Todoist as individual tasks, so I can check them off in the supermarket.
- **US-A6.** I want the plan to persist across devices when I'm logged in.
- **US-A7.** I want optional ingredients to be hidden from the shopping list by default, with a one-click toggle to include them.
- **US-A8.** I want ingredients with a fixed "recipe-wide" quantity (1 bay leaf) to not scale with servings.

### 3.3. As the Script
- **US-S1.** I want to POST a new dish with a bearer token and have the server normalise pantry flags and ingredient shape for me.
- **US-S2.** I want to GET the authoritative pantry list before each ingest, without auth, so I can flag new dishes consistently.
- **US-S3.** I want validation errors to come back structured (Zod issues), not as plain strings.

---

## 4. Information architecture

```
/                       Spinner (home)
├── /dishes             Browse / search
│   └── /dishes/[id]    Detail + servings scale
│       └── /cook       Cook mode (steps + timers + wake-lock)
├── /plan               Meal plan + shopping list + Todoist
└── /admin              [gated]
    ├── /admin/login    Password form (public)
    └── /admin          Dish CRUD + pantry defaults
```

Navigation is a **bottom tab bar** (Spin / Dishes / Plan / Admin) visible on all non-cook, non-login screens. The page header hosts the brand mark and a manual light/dark toggle; detail pages swap the brand for a back button. A "← Back" link lives only on cook mode.

---

## 5. Page-by-page UX

### 5.1. `/` — Spinner (home)

**Purpose:** one click picks a dish, the user goes to that dish's page.

**What the user sees**
- App header with brand mark and moon/sun toggle.
- "Tonight · *Tuesday*" uppercase eyebrow, "What's for *dinner?*" serif headline (accent-coloured italic "dinner?").
- Short description line: "N dishes in the pool. Filtered by *x + y*." or "Nothing ruled out."
- Tag filter row (chip pills).
- **Wheel stage** — a 280–340 px circular wheel with up to 10 conic-gradient slices (one per dish, coloured by each dish's `accent`). Emoji labels sit on each slice. A pointer triangle at the top marks the landing position. A **Tap · Spin** hub in the centre.
- Bottom tab bar (Spin active).

**What the user can do**
- Toggle any tag chip. Selected tags combine with **AND** — the dish must have *every* selected tag.
- Click the Spin hub → wheel accelerates (5+ revolutions over ~2.2 s), candidate titles flicker below the wheel, then a **Tonight's pick** overlay card reveals the winner with `DishArt`, title, subtitle, tag meta.
- From the reveal: **View recipe** (primary, → detail) / **Spin again** (ghost with dice icon) / × dismiss.
- Tag selections persist across sessions in `localStorage.spinnerFilters`.

**Weighting logic (non-obvious)**
Each candidate dish gets a weight:
- Base weight: `favorite ? 2 : 1` — favourites are twice as likely.
- Recency damper: if the dish has a `lastCookedAt`, multiply by `min(1, daysSinceLast / 14)`.
- Floor: weights never drop below `0.05` — recently-cooked dishes are still *possible*, just unlikely.
- Pick: weighted random draw from the cumulative distribution.

**States**
- *No tags selected:* all dishes eligible.
- *Filter matches nothing:* dashed-border card "No dishes match the current filter."
- *Spinning:* Spin hub shows "…" / "spinning"; wheel rotates; candidates flicker.

---

### 5.2. `/dishes` — Browse

**Purpose:** scan, search, filter, or jump into any dish without gambling.

**What the user sees**
- `AppHeader` with subtitle "*N of M*".
- Pill search input (title + subtitle, case-insensitive).
- **★ Favourites** chip + tag chips (AND semantics).
- If plan has entries: a small "*N in plan · view plan*" line above the list (link to `/plan`).
- **Editorial card grid** (1 column on mobile, 2 from `md`+):
  - Full-bleed `DishArt` (16:10 aspect; uses `imageUrl` if present, otherwise the emoji+accent gradient).
  - Serif title.
  - Italic subtitle.
  - Meta row: `· tag · tag · …` + last-cooked timestamp on the right.
  - Round star button (optimistic favourite toggle).
  - Small plan toggle (`+ add to plan` / `✓ in plan`).
- Bottom tab bar (Dishes active).

**What the user can do**
- Type in search → client-side `useMemo` filter, no network call.
- Click any tag or the Favourites chip to toggle — combines with search.
- Click ★ → optimistic toggle, reverts on 401/network failure (`PATCH /api/dishes/{id}/favorite`).
- Click plan toggle → adds at the dish's `baseServings` / removes entirely. Writes `localStorage.mealPlan` and fires `PUT /api/meal-plan` fire-and-forget.
- Click the title (or card body) → `/dishes/{id}`.

---

### 5.3. `/dishes/[id]` — Dish detail

**Purpose:** the canonical recipe view — image, ingredients, recipe, with live servings scaling and a one-click route into cook mode.

**What the user sees**
- `AppHeader` in back-button mode (pill chevron-left button).
- Hero `DishArt` (rounded `--radius-lg`). Uses `imageUrl` if present, else the `accent`-gradient + `emoji` fallback. Capped to 320 px tall on desktop.
- Title (serif, h1), italic subtitle, pill star button.
- Meta row: `· tag · tag · …` then `last cooked <relTime>`.
- **Servings card** (bordered `bg-paper`):
  - `SERVES` uppercase eyebrow + `base: N` under it.
  - Stepper: `−` / big number / `+`.
  - Primary **Cook mode** (ink variant with flame icon) + ghost **Cooked** button.
  - Full-width **Add to meal plan** ghost button — flips to **In plan (update to N)** with a check icon and `text-good` when already present.
- **Ingredients** — baseline-aligned rows, monospaced quantity column, serif-sans ingredient name. Pantry items italicise and grey out. Small `PANTRY` / `FIXED` badges. `(or …)` alternatives and `, preparation` suffixes.
- **The recipe** — rendered via `MarkdownLite`: headings in italic Fraunces, step numbers in accent monospace, bold inline.
- Bottom tab bar (Dishes active).

**What the user can do**
- Adjust servings with `±`. Every non-fixed ingredient's quantity updates client-side via `quantity × (scalable === false ? 1 : servings / baseServings)`.
- Click ★ → toggle favourite (optimistic).
- Click **Cooked** → `POST /api/cook-log {dishId}`. On success, `lastCookedAt` updates in-place and a toast confirms.
- Click **Add to meal plan** → inserts/updates at the current servings; toast confirms.
- Click **Cook mode** → `/dishes/{id}/cook?servings=N`.

**Non-obvious details**
- Quantity formatting rounds to 2 decimals and strips trailing zeros — `2.50` → `2.5`, `3.00` → `3`.
- The `lastCookedAt` display is relative (*today*, *2w ago*, …) but the stored value is a precise ISO timestamp.
- Public visitors can still hit the add-to-plan / cooked buttons; API mutations return 401 silently, and the optimistic UI reverts without toast.

---

### 5.4. `/dishes/[id]/cook` — Cook mode

**Purpose:** a low-friction, kitchen-safe view for actually cooking the dish — one thumb, greasy fingers, phone on a stand.

**Layout: split.** Top half = ingredient rail (capped to `40vh`), bottom half = scrolling steps. No tab bar.

**What the user sees**
- Compact header on `bg-paper`: **✕ Exit** button (→ detail page), `COOKING` eyebrow + dish title, compact `±` servings stepper with numeric display + wake-lock status line ("screen lock prevented" / "screen may auto-lock" / "…").
- **Ingredient rail** — 2-column grid (1 column below `sm`). Each row: monospaced qty+unit, descriptor in muted, ingredient name, `(optional)` suffix. Pantry items italic + `text-ink-3`. Tapping from a step highlights the row in `bg-accent-tint` and scrolls into view (1.6 s fade).
- **Recipe steps** — markdown-parsed into sections:
  - `## Heading` → italic accent-coloured `h2`.
  - `1.` / `- ` / `* ` → step cards (border, padding, round step-number badge). Done steps: muted line-through with accent `✓` in the badge.
  - Ingredient names inside step text: dotted-underline emerald buttons (tap → highlight + scroll ingredient).
  - Duration phrases (`15 min`, `2 hours`, `1.5h`): amber ⏱ pills (tap → start countdown).
- **Timer panel** (bottom-right, stacks multiple): amber cards, MM:SS or H:MM:SS, two-tone beep on finish (880 → 660 Hz), red flash + *done* label, ✕ to dismiss.

**What the user can do**
- Bump servings up/down (recomputes all ingredient quantities).
- Tap any step to mark done / undone.
- Tap an ingredient name inside step text → highlight + scroll the ingredient row.
- Tap a duration phrase → start a countdown timer; run as many as you like.
- Dismiss any finished or still-ticking timer.
- **✕ Exit** → dish detail.

**Non-obvious details**
- **Screen wake lock** via `navigator.wakeLock.request('screen')`. Re-acquired on visibility change. Degrades silently on unsupported browsers.
- **Ingredient matching** in step text is greedy-longest-match, case-insensitive, plural-tolerant (strips trailing `s`), minimum 3 chars, enforced word boundaries.
- **Timer regex**: `/\b(\d+(?:\.\d+)?)\s*(minutes?|mins?|hours?|hrs?|h)\b/gi`. Converts to seconds.
- **Overlapping spans** (e.g. *thyme* inside a step that also mentions *15 min*) resolve by earliest start; longer match breaks ties.

---

### 5.5. `/plan` — Meal plan & shopping list

**Purpose:** combine multiple dishes into one shopping trip.

**What the user sees**
- `AppHeader title="Plan"`.
- **Empty state:** dashed card *No dishes in your plan yet. Spin one and add it from the dish page.*
- When there are plan entries, three panels (Dishes + Shopping list side-by-side on `md+`, Pantry check always full-width):

**5.5.a. Dishes**
- Rounded card list inside `bg-paper`. Each row: serif title (link to detail), `−`/`+` stepper, monospaced servings number, **remove** link in `text-warn`. **Clear all** link below the list.

**5.5.b. Shopping list**
- Section header "*Shopping list*" + **include optional** checkbox.
- Bulleted list of aggregated ingredients, alphabetical.
- Multi-unit rows combine into one line: *2 can + 400 ml coconut milk*.
- Empty state: *No ingredients across these dishes.*
- **Send to Todoist** (primary pill) — only rendered when `shopping.length > 0 && authenticated`.
- Status line below the button: *Sending…* → *Created N tasks.* (in `text-good`) or a `text-warn` error.

**5.5.c. Pantry check** *(only when non-empty)*
- Smaller italic header "*Pantry check (N)*" with subtext *Skipped from the shopping list because you already have them. Glance over to make sure you're not running low.*
- Italic grey list with quantities in monospace.

**What the user can do**
- Adjust any dish's servings with `±` → instant re-aggregation + fire-and-forget sync.
- `remove` one dish, or `Clear all` to wipe.
- Toggle `include optional` → optional ingredients move in/out of the shopping list (pantry + optional still excluded — the flags compose).
- Click `Send to Todoist` → `POST /api/todoist {tasks: string[]}`.

**Non-obvious details**
- Todoist button visibility is guarded by `GET /api/auth/check`. Public visitors never see it.
- The plan is **offline-first**: it writes to `localStorage.mealPlan` immediately and syncs via `PUT /api/meal-plan` in the background. Unauthenticated users get a local-only plan.
- **Aggregation** groups by `(name, unit-category, descriptor)` case-insensitively:
  - Weights (`g`, `kg`, `oz`, `lb`) all convert via grams and display in the largest sensible unit.
  - Volumes (`ml`, `l`, `tsp`, `tbsp`, `cup`, `fl oz`) all convert via ml.
  - Count and imprecise units (`piece`, `clove`, `to taste`, …) only aggregate with exact-matching units.
  - **No cross-category conversion** — `1 cup flour` and `200 g flour` stay as two separate lines.
  - `preparation` text is intentionally dropped.
- **Pantry items are excluded entirely** from the shopping list. They show up only in the Pantry check block, never pushed to Todoist.

---

### 5.6. `/admin/login` — Login

**Purpose:** the only gate into the admin area.

**What the user sees**
- Centered card on `bg-bg`: large `BrandMark`, `Admin` serif heading, pill password input with centered placeholder.
- Primary **Log in** pill button (disabled when empty or in-flight; shows "…" while loading).
- Error: `Wrong password` (401) or generic `Error` (network) in `text-warn`.
- No tab bar.

**What the user can do**
- Type password → `POST /api/admin/login`. On success, a signed `admin_session` cookie is set (HttpOnly, SameSite=Lax, Secure in prod, 30-day max-age) and the browser redirects to `/admin`.

---

### 5.7. `/admin` — Dish CRUD + pantry defaults

**Purpose:** everything the Curator does when not cooking.

Gated by `proxy.ts` — unauthenticated visitors are redirected to `/admin/login`. Rendered inside the normal shell (tab bar visible, Admin tab active). Header is `AppHeader title="Admin"` with a `Log out` button in the right slot.

**Three stacked sections:**

**5.7.a. New / Edit dish form**
- Header flips between *New dish* and *Edit dish*.
- **Title** (required).
- **Subtitle**.
- **Tags** — comma-separated text input, with existing tags shown as `+ tagname` quick-add chips pulled from `GET /api/tags`.
- **Base servings** — number, min=1, default 4.
- **Image URL** — URL input, live preview if populated.
- **Emoji** — short text input (max 8 chars). Drives the `DishArt` fallback centre character when no image is set.
- **Accent** — short text input (max 60 chars). CSS colour (typically an `oklch(...)` string). Drives the `DishArt` gradient.
- **★ Favourite** checkbox.
- **Ingredients** — a list of rows, each row has:
  - Row 1: `qty` (decimal input) · `unit` (datalist of `STANDARD_UNITS`) · `descriptor` · `name` (datalist of `STANDARD_INGREDIENTS` + all DB ingredient names) · **×** remove.
  - Row 2: `preparation` · `pantry` checkbox (+ optional *pin to defaults* link if flagged but not already in the curated list) · `fixed` checkbox · `optional` checkbox.
  - Row 3: `alternatives` — comma-separated.
  - **+ add ingredient** to append a blank row.
  - If any ingredient is flagged pantry but isn't in the curated defaults, a **pin N pantry items to defaults** button appears for one-click bulk add.
- **Recipe** — monospaced markdown textarea.
- **Submit** button — `Create` or `Update` depending on mode. `Cancel edit` link when editing.
- Status line below the buttons (*Created.*, *Updated.*, validation errors).

**5.7.b. All dishes list**
- Every dish. Each row: title · subtitle · tags · `edit` · `copy` · `delete`.

**5.7.c. Pantry defaults**
- Intro text explaining this list's role.
- Add form: text input with datalist autocomplete + `Add` button.
- Existing defaults rendered as chips with an × remove affordance.
- Empty state: *No pantry defaults yet.*

**What the Curator can do**
- **Create** — fill form → `POST /api/dishes`. Server runs `applyPantryDefaults`.
- **Edit** — `edit` link → form populates. Submit → `PATCH /api/dishes/{id}`.
- **Copy** — `copy` link → form pre-fills, id cleared, title suffixed with ` (copy)`.
- **Delete** — browser confirm → `DELETE /api/dishes/{id}`.
- **Pin a pantry name** — via the curated-list admin, or per-ingredient *pin to defaults*, or bulk *pin N items*.
- **Log out** — `DELETE /api/admin/login` → `/admin/login`.

**Non-obvious details**
- Typing a name into an ingredient row auto-checks `pantry` if the name is in the hardcoded `PANTRY_DEFAULTS` set.
- Ingredients with `quantity: 0` are filtered out on save.
- Alternatives: input is free-text comma-separated; stored as `string[]`; re-joined on edit.
- Validation uses Zod (`DishInputSchema`); errors surface in the status line.

---

## 6. Feature catalogue

### 6.1. Weighted random spin
See §5.1. Key invariants: favourites 2×, recency damps to 0 over 14 days with a 5 % floor, filters are AND.

### 6.2. Tag filtering (AND)
Same semantics everywhere. Postgres `tags @> $1::text[]`, client-side `.every(...)` mirror.

### 6.3. Full-text search
Only on `/dishes`. Case-insensitive substring match against `title + subtitle`.

### 6.4. Favourites
Boolean on each dish. Star shown anywhere a dish is listed. Optimistic with server revert. Spinner weight 2×; browse has a "favourites only" chip.

### 6.5. Cook log & "last cooked"
`cook_log` table, FK-cascaded to `dishes`. `✓ Cooked` button inserts a row with `cooked_at = now()`. Exposed as relative dates in the UI.

### 6.6. Servings scaling
Per-ingredient `quantity × servings / baseServings`. Fixed items (`scalable: false`) bypass the multiplier.

### 6.7. Meal plan
Local-first, server-synced. Stored in `meal_plan.entries` JSONB (single row id=1). Every mutation writes `localStorage.mealPlan` immediately and fires `PUT /api/meal-plan` without waiting.

### 6.8. Shopping list aggregation
`aggregateIngredients` groups non-pantry, optionally non-optional ingredients by `(nameLower, unitCategory, descriptorLower)`, sums within category, drops `preparation`. `groupByName` collapses multi-unit same-name rows.

### 6.9. Pantry items
Every ingredient can be flagged `pantry: true`. Hidden from shopping list, italicised + `pantry` badge on dish detail, surfaced in the Pantry check block on `/plan`. Three ways to flag:
1. **Admin form** — tick the checkbox.
2. **Auto-detect on submit** — server-side `applyPantryDefaults` flags any ingredient whose name matches the curated `pantry_names` list.
3. **Script ingest** — any API caller benefits from the same auto-flagging; scripts are expected to also flag near-matches the exact check misses.

### 6.10. Optional ingredients
`optional: true` flag. Rendered with `(optional)` suffix. Excluded from shopping list unless `/plan → include optional` is toggled on. Pantry + optional compose.

### 6.11. Fixed (non-scalable) ingredients
`scalable: false` flag (UI label: *fixed*). The scaler is a no-op. `FIXED` badge on detail and cook mode.

### 6.12. Alternatives
`alternatives: string[]`. Rendered on dish detail as `name (or alt1, alt2)`. Only the primary name goes on the shopping list.

### 6.13. Todoist push
`POST /api/todoist {tasks: string[]}` (pre-formatted). Server resolves project by name (case-insensitive, paginated), creates one v1 task per string. Gated by `GET /api/auth/check`.

### 6.14. Cook mode timers
Detected via regex in step text. Independent countdowns, stacked bottom-right, two-tone Web Audio beep on finish.

### 6.15. Screen wake-lock
`navigator.wakeLock.request('screen')` in cook mode. Re-acquires on visibility change. Graceful no-op on unsupported browsers.

### 6.16. Ingredient ↔ step linking (cook mode)
Ingredient names inside step text become dotted-underline emerald buttons. Tap → scroll + highlight the ingredient row.

### 6.17. Admin CRUD + pantry defaults
Full covered in §5.7.

### 6.18. Copy-dish shortcut
`copy` action on each admin row; form pre-fills with everything except id, title suffixed with ` (copy)`.

### 6.19. Server-side JSON API
All UI actions are backed by a consistent bearer-or-cookie API (§7). Scripts use the bearer path; the browser uses the cookie.

### 6.20. Dark mode
Driven by a manual moon/sun toggle in the app header. `prefers-color-scheme` supplies the initial value; chosen mode persists in `localStorage.ds_dark`. A tiny pre-hydration script sets `data-mode` on `<html>` before React boots, preventing flash.

### 6.21. DishArt placeholder
When a dish has no `imageUrl`, a gradient placeholder renders: 135° `linear-gradient` seeded from the dish's `accent` (default `oklch(70% 0.14 40)`), with its `emoji` centred (default `🍽️`) and a faint paper-texture overlay. Both fields are authored via the admin form and round-trip through `POST/PATCH /api/dishes`.

---

## 7. API contract (UX-relevant)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/dishes` | public | List dishes; `?tags=a,b` for AND filter. |
| POST | `/api/dishes` | bearer or cookie | Create dish. Applies pantry defaults. |
| GET | `/api/dishes/{id}` | public | Single dish, incl. `lastCookedAt`. |
| PATCH | `/api/dishes/{id}` | bearer or cookie | Full update. |
| DELETE | `/api/dishes/{id}` | bearer or cookie | Delete (cascades to cook_log). |
| PATCH | `/api/dishes/{id}/favorite` | bearer or cookie | Lightweight favourite toggle. |
| GET | `/api/tags` | public | Distinct tags, sorted. |
| GET | `/api/ingredient-names` | public | Distinct ingredient names, used as datalist. |
| POST | `/api/cook-log` | bearer or cookie | Log a cook event. |
| GET | `/api/meal-plan` | cookie | Plan state, 401 if public. |
| PUT | `/api/meal-plan` | cookie | Replace plan state. |
| POST | `/api/todoist` | bearer or cookie | Push tasks. 502 on Todoist error. |
| POST | `/api/admin/login` | public | Set session cookie. |
| DELETE | `/api/admin/login` | public | Clear cookie. |
| GET | `/api/auth/check` | public | `{authenticated: boolean}` — used to show/hide Todoist button. |
| GET | `/api/pantry-defaults` | public | Curated pantry list. |
| POST | `/api/pantry-defaults` | bearer or cookie | Add a name. |
| DELETE | `/api/pantry-defaults?name=` | bearer or cookie | Remove a name. |

---

## 8. Data model touchpoints

The UX depends on four tables:

- **`dishes`** — one row per dish. Columns: `id`, `title`, `subtitle`, `recipe`, `tags text[]`, `ingredients jsonb`, `base_servings`, `favorite`, `image_url`, **`emoji`**, **`accent`**, timestamps. GIN index on `tags` for fast array containment.
- **`cook_log`** — append-only history; `(dish_id, cooked_at DESC)` index. ON DELETE CASCADE.
- **`meal_plan`** — single-row table (CHECK `id = 1`), `entries` JSONB.
- **`pantry_names`** — primary key on `name` (lowercased).

The **`Ingredient`** shape (Zod) drives most UI behaviour: `{ quantity, unit?, name, descriptor?, preparation?, pantry?, scalable?, optional?, alternatives? }`. See §6 for how each flag behaves.

---

## 9. States, empty states, and error states

| Surface | State | Message / behaviour |
|---|---|---|
| Spinner | loading tags | silent; button usable when empty |
| Spinner | filter matches nothing | *No dishes match the current filter.* |
| Spinner | spinning | hub disabled; wheel rotates; candidates flicker |
| Browse | loading | *Loading dishes…* |
| Browse | DB empty | *No dishes yet.* |
| Browse | filter empty | *No dishes match the current filter.* |
| Dish detail | missing dish | 404 (server) |
| Dish detail | no ingredients | *No ingredients listed.* |
| Cook mode | no recipe text | *No recipe text.* |
| Cook mode | wake-lock unsupported | *screen may auto-lock* |
| Cook mode | wake-lock acquired | *screen lock prevented* |
| Cook mode | wake-lock pending | *…* |
| Plan | no entries | *No dishes in your plan yet. Spin one and add it from the dish page.* |
| Plan | no ingredients | *No ingredients across these dishes.* |
| Plan | Todoist pending | button → *Sending…* |
| Plan | Todoist success | *Created N tasks.* (text-good) |
| Plan | Todoist error | error message (text-warn); button re-enabled |
| Admin | creating | button disabled |
| Admin | save success | *Created.* / *Updated.* |
| Admin | validation failure | Zod issues summarised |
| Admin | delete | native browser confirm |
| Admin | pantry empty | *No pantry defaults yet.* |
| Login | wrong password | *Wrong password* |
| Login | network error | *Error* |

---

## 10. Non-obvious UX decisions worth calling out

1. **Public vs. admin is fuzzy by design.** Public users can add to plan, toggle favourites, and hit cook mode — writes that need auth silently no-op (favourite reverts; meal plan stays local).
2. **Todoist button hidden, not disabled, for unauthenticated users.** The button never renders if `/api/auth/check` returns `authenticated: false`.
3. **Multi-unit shopping list items collapse to one line.** *2 can + 400 ml coconut milk* is one task in Todoist, not two.
4. **Preparation text is dropped from the shopping list.** You shop for *onion*, not *onion, thinly sliced*.
5. **Scalable flag default is true, and it's inverted in the UI label ("fixed").** The label reflects the rarer case.
6. **Tag filter is AND, not OR.**
7. **Spinner floor weight 0.05.** Recently-cooked dishes are still eventually possible.
8. **The meal-plan table has a single row.** A CHECK constraint enforces `id = 1`.
9. **Pantry semantics are three-layered:** (a) the hardcoded `PANTRY_DEFAULTS` for UI hints, (b) the DB `pantry_names` for server-side auto-flagging, (c) the per-ingredient `pantry` bool actually stored. Layer (b) is the authoritative list.
10. **Admin session is 30 days.** No refresh flow; just log in again after a month.
11. **Bearer + cookie auth on the same endpoints.** Cookie-authed user and `API_TOKEN`-wielding script call the exact same URLs.
12. **Per-dish `emoji` and `accent` drive the DishArt fallback.** When a dish has no `imageUrl`, the placeholder renders a 135° gradient seeded from `accent` (default `oklch(70% 0.14 40)`) with the `emoji` centred (default `🍽️`). Authored in the admin form and persisted through `POST /api/dishes` / `PATCH /api/dishes/{id}`.
13. **Manual dark mode toggle.** Defaults to `prefers-color-scheme` on first visit but remembers the user's choice in `localStorage.ds_dark`. A pre-hydration inline script avoids flash of unthemed content.
14. **Bottom tab bar is the primary nav.** Spin / Dishes / Plan / Admin. Hidden in cook mode and on the admin-login screen; visible everywhere else. The Plan tab shows a badge with the count of dishes in the local plan.

---

## 11. Roadmap

### 11.1. Shipped
- Cook-mode timers with Web Audio beep.
- Weight/volume unit conversion in aggregation.
- `scalable: false` / fixed quantities.
- `optional: true` + `/plan` toggle.
- Dish images.
- Text search on `/dishes`.
- Favourites + spinner weighting.
- Cook log + "last cooked" + recency damping.
- Copy-dish shortcut.
- Singularised ingredient vocabulary.
- Bulk-pin pantry items.
- Server-persisted meal plan.
- Mobile polish (decimal `inputMode`, touch-friendly controls, 16 px inputs).
- Recipe-step → ingredient linking.
- Multi-unit shopping rows.
- Ingredient alternatives.
- "Hide Todoist for public visitors."
- Inline timers rendered directly inside step text.
- **Cookbook-styled visual redesign** (Fraunces / Inter / JetBrains Mono, oklch-based palette, light + dark).
- **Bottom tab bar** + **manual dark-mode toggle**.
- **Wheel-style spinner** with "Tonight's pick" landed-reveal + spin-again.
- **Split cook-mode layout** (ingredient rail top, steps bottom).
- **Editorial dish cards** with full-bleed hero art.
- **Per-dish `emoji` + `accent`** → DishArt gradient placeholder.

### 11.2. Not yet shipped (v2 wishlist)
1. Recipe import from URL (schema.org/Recipe JSON-LD → form prefill).
2. Week-view meal plan (Mon–Sun, drag-to-move, per-day shopping list).
3. Auto-derived dietary tags (vegetarian / vegan / contains-dairy).
4. Star ratings + persistent cook notes, ratings feeding spinner weight.
5. Remember last-chosen servings per dish.
6. PWA / install prompt (manifest + service worker).
7. Export / import JSON backup.
8. Spinner "why this one?" explanation (*favourite 2×, cooked 3w ago*).
9. Drag-to-reorder ingredients.
10. Per-dish sticky-note field.
11. Temporary skip (*don't spin this for 7/14 days*).
12. Nutritional info per serving (requires 3rd-party API).

### 11.3. Explicit non-goals
- Per-ingredient density conversion (`1 cup flour ↔ g flour`).
- Multi-user / per-household plans.
- Mobile native app — PWA is the ceiling.

---

## 12. Environment dependencies

- `DATABASE_URL` — Neon Postgres.
- `ADMIN_PASSWORD` — the one password.
- `SESSION_SECRET` — HMAC key; rotating it logs everyone out.
- `API_TOKEN` — bearer for scripted ingest.
- `TODOIST_API_TOKEN` + `TODOIST_PROJECT_NAME` — without these, `POST /api/todoist` returns 502.

---

## 13. Accessibility & device notes

- Semantic markup (buttons, labels, nav, headings).
- Icon-only buttons carry `aria-label` / `title`.
- Colour is never the sole signal — icons, badges, labels accompany state changes.
- Inputs use `text-base` (16 px) to prevent iOS Safari auto-zoom on focus.
- `inputMode="decimal"` on quantity fields.
- Cook-mode grid stacks to one column below `sm`.
- No keyboard shortcuts beyond native focus/enter/escape behaviour.
- Dark mode honours both manual toggle and system preference (manual wins once set).

---

## 14. Onboarding

There isn't one. The home page *is* the onboarding: one obvious button (Spin), one obvious interaction. Admin discovery is deliberately low — `/admin` is a private door, not a marketed feature.
