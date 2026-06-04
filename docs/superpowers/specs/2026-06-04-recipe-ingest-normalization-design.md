# Recipe Ingest Normalization & Presentation — Design

**Date:** 2026-06-04
**Status:** Approved (pending spec review)
**Author:** brainstormed with Mirko

## Problem

Ingesting a recipe via URL (https://www.dekokendezussen.nl/recepten/vegetarische-turkse-pizza/,
stored as dish #48) surfaced four issues, all tracing to the same under-specified
ingest step:

1. **Inconsistent method formatting.** The method was stored as `## headers` + prose
   paragraphs instead of numbered steps, so it rendered without step numbers on the
   dish page. Other recipes ingest as numbered lists. Format is non-deterministic.
2. **Cook-mode ingredient highlighting broken.** Tapping an ingredient referenced in
   the method does nothing for this dish.
3. **Recipe left in Dutch** while ingredient names were translated to English.
4. **Multi-part recipes have no visible structure.** Dough / Filling / Toppings
   ingredients are one flat list, so the same item appears twice with no context
   (e.g. "2 tomato" filling + "1 tomato" topping look like a mistake).

### Root cause

`lib/ingest/prompt.ts` never asks for numbered steps (line 41 is literally
`- recipe: markdown instructions, only if input had them.`), never asks to translate
the *method* (line 28 only translates ingredient vocab), and has no ingredient-section
concept. Cook-mode highlighting (`cook-view.tsx::findIngredientSpans`, lines 26-56) is a
literal word-boundary regex on the exact English ingredient `name` — it cannot bridge
Dutch method text → English names (#2/#3 are the same defect), **and** even in perfect
English it misses every loose reference ("the seeds", "the dough", "the sauce", pronouns).
Additionally, the code runs **Haiku** (`route.ts:91`) though `AGENTS.md` documents Sonnet.

## Decisions (from brainstorming)

| # | Decision |
|---|----------|
| Highlighting | **Resolve references at ingest.** The model authors the translated method text and the ingredient links in one pass; cook mode does a precise lookup, not a regex guess. |
| Storage of links | **Flat phrase→ingredient sidecar** (`dishes.method_refs` JSONB), not a fully-structured method field. Language-proof + loose-reference-proof, zero edit-form disruption, graceful fallback. |
| Translation | **English default; translate all text fields** (title, subtitle, method, descriptor, preparation). Ingredient `name` stays canonical English vocab; `image_description` stays English. |
| Step numbering | **Restart per section** (Dough 1,2 / Filling 1,2,3 / Toppings 1,2). |
| Backfill | **Backfill the offenders** (non-English / unsectioned / no refs) via a one-shot script with a **dry-run preview** reviewed before apply. |
| Model | Move ingest to **Sonnet** (richer task: translation + reference resolution); reconcile the AGENTS.md drift. Re-test Haiku afterward if cost matters. |
| Scope | **One coordinated change**, all five workstreams. |

### Why the sidecar, not a structured method

The model writes the (translated) method text and the links together, so each link's
`phrase` is always an exact substring of text it just wrote:

```jsonc
// new nullable column dishes.method_refs (JSONB)
[
  { "phrase": "the seeds", "ingredients": [3] },      // → cumin seeds (loose ref)
  { "phrase": "the dough", "ingredients": [0, 1, 2] }, // → flour, water, yeast (composite)
  { "phrase": "onion",     "ingredients": [6] }
]
```

Cook mode finds each `phrase` in the rendered method and makes it tappable. No
step-index alignment to maintain; if the user later hand-edits the method, phrases that
still appear keep working and the rest fall back to today's string matcher. A
fully-structured method (sections→steps→links as source of truth) was rejected: it
forces an edit-screen rewrite and a larger migration for marginal gain.

## Data model changes

| Change | Location | DDL? |
|---|---|---|
| `Ingredient.section?: string \| null` | inside existing `dishes.ingredients` JSONB | **No** (schemaless JSONB; Zod + types only) |
| `dishes.method_refs JSONB` (nullable) | `db/schema.sql` | `ALTER TABLE dishes ADD COLUMN IF NOT EXISTS method_refs jsonb;` |
| `users.default_language text` (nullable, NULL→English) | `db/schema.sql` | `ALTER TABLE users ADD COLUMN IF NOT EXISTS default_language text;` |

### Schema / types (`lib/types.ts`)

- `IngredientSchema` (lines 3-21): add
  `section: z.string().trim().max(40).nullable().optional()`.
- `DishInputSchema` (lines 25-46): add
  `methodRefs: z.array(z.object({ phrase: z.string().trim().min(1).max(80), ingredients: z.array(z.number().int().nonnegative()).min(1) })).optional()`.
- `Dish` type + `rowToDish` (lines 120-144): map the `method_refs` column → `dish.methodRefs`.
- `DishPatchSchema` (line ~64): include `methodRefs` so edits preserve it.
- `lib/ingest/schema.ts` (`DISH_INPUT_JSON_SCHEMA`, line 12) auto-derives via
  `z.toJSONSchema` — no manual edit.

**Server-side validation (defense in depth, in `app/api/ingest/jobs/[id]/route.ts`
re-validation and in the create/patch routes):** drop any `methodRefs[].ingredients`
index that is out of range for the dish's `ingredients` array rather than failing the
whole ingest.

## Workstream 1 — Ingest prompt (`lib/ingest/prompt.ts`)

`buildIngestPrompt` gains a `targetLanguage: string` input (default `"English"`).
Add/replace instructions:

- **Language block:** "Output ALL human-readable text — title, subtitle, recipe steps,
  `## Section` headers, `descriptor`, `preparation` — in **{targetLanguage}** (translate
  if the source is another language). EXCEPTIONS that stay canonical English: ingredient
  `name` (use the standard English vocabulary) and `image_description`." Keep the existing
  Dutch→English vocab hints (line 28) because `name` must be English.
- **Recipe format (replaces line 41):** "`recipe`: the method, only if the input had
  instructions, as Markdown. For multi-part recipes use `## Section Title` headers
  (`## Dough`, `## Filling`, `## Toppings`); under each write numbered steps `1.`, `2.`,
  one per line. Single-part recipes: numbered steps, no header."
- **Ingredient `section`:** "the recipe part this ingredient belongs to, matching a
  `## Section` header in the method. Omit for single-part recipes."
- **`methodRefs`:** "For every place the method refers to an ingredient — including loose
  references like 'the seeds', 'the dough', 'the spices' — add
  `{ phrase: <exact substring copied from your method text>, ingredients: [<0-based indices into the ingredients array>] }`.
  Use the EXACT substring as written. A phrase may map to several ingredients
  ('the dough' → flour, water, yeast). Only include references you are confident about."

## Workstream 2 — Shared method parser (`lib/recipe.ts`, new)

Single parser replacing `cook-view.tsx::parseRecipe` (149-188) and
`markdown-lite.tsx::parse` (8-23) for the **method specifically**.

```ts
export interface RecipeSection { title: string | null; steps: string[] }
export function parseMethod(markdown: string): RecipeSection[]
```

Classification (line-based): `## X` → new section; `1.`/`-`/`*` list line → step in
current section; any other non-empty line → step (so prose-only recipes still get
numbered, matching cook-mode's current generous behavior and fixing detail-view's
no-number prose); blank → ignored. No `##` seen → one section with `title: null`.

**Numbering: per-section restart** = step index within its section + 1. Both views use
this, so #1 is fixed identically everywhere.

A new `<RecipeMethod>` component renders sections + numbered steps and is used by both
`dish-view.tsx` (replacing `<MarkdownLite text={dish.recipe} />` at line 304) and
`cook-view.tsx`. `MarkdownLite` stays for any other generic markdown (e.g. notes).

## Workstream 3 — Ingredient sections display (#4)

`dish-view.tsx` (ingredient list 257-287) and `cook-view.tsx` (313-348): group
ingredients by `section`, preserving first-seen section order, rendering a sub-header per
section. Ingredients with `section == null` render under no header, after the sectioned
groups. **A dish where all ingredients are unsectioned renders exactly as today** (flat
list, no headers) → back-compat for ~500 existing dishes. Section sub-headers visually
mirror the method's `##` headers.

**Aggregation is untouched.** `lib/ingredients.ts::keyOf` (71-78) and `groupByName`
(181-195) MUST NOT include `section`; the key stays `(name, unitCategory, descriptor)`.
This keeps the `/plan` shopping list merged across sections and dishes. Per-dish display
stays un-aggregated by design — "2 tomato" (Filling) and "1 tomato" (Toppings) now read
correctly because each sits under its section header.

## Workstream 4 — Cook-mode linking (`cook-view.tsx`)

When `dish.methodRefs` is present and non-empty: linkify by **phrase lookup** — for each
ref, find occurrences of `phrase` in the step text (longest-phrase-first to resolve
overlaps, mirroring the existing earliest-start/longest-win logic), wrap each in a
tappable span that calls `scrollToIngredient` for the referenced ingredient(s). When a
phrase maps to multiple ingredients, scroll to the first and highlight all.

When `methodRefs` is absent/empty (old dishes, or a hand-edited method whose phrases no
longer appear): **fall back to the existing `findIngredientSpans`/`linkifyStep` string
matcher** (26-136). Graceful degradation, no regression.

## Workstream 5 — Language setting (#3 plumbing)

- **Schema:** `users.default_language text` (nullable). NULL = English.
- **API:** new `app/api/me/language/route.ts` following the Todoist pattern
  (`app/api/me/todoist/route.ts` GET 4-16 / PATCH 18-37). `GET` → `{ language: string | null }`;
  `PATCH { language }` validated against a curated allowlist of supported codes.
- **UI:** a "Language" section in `app/settings/settings-client.tsx` (fetch-on-mount +
  save, like Todoist). A `<select>` with a curated list (English default; e.g. en, nl,
  de, fr, es, it). `app/settings/page.tsx` adds `default_language` to its SELECT for SSR
  paint.
- **Ingest route** (`app/api/ingest/route.ts`): after `resolveUserId`, read the user's
  `default_language`, map code → language name, pass as `targetLanguage` to
  `buildIngestPrompt` (default `"English"`). Bearer-token ingest resolves to the seed
  owner, so it uses the seed owner's setting.

## Workstream 6 — Model + persistence wiring

- `app/api/ingest/route.ts:91`: `model: "haiku"` → `"sonnet"`. Update the comment.
- Create/patch dish routes (`app/api/dishes/...`) persist `method_refs`. The ingest
  output flows model → structured payload → `/api/ingest/jobs` re-validation → browser
  form → `POST /api/dishes` → DB, so `DishInputSchema` carrying `methodRefs` + `section`
  covers the path.
- `app/_components/dish-form.tsx`: preserve `methodRefs` as hidden state across edits;
  optionally expose a per-ingredient `section` text input (like `descriptor`). Refs are
  derived, not hand-edited in v1. **If the user adds, removes, reorders, or renames any
  ingredient, clear `methodRefs` on submit** — index-based refs would otherwise point at
  the wrong ingredient. This also applies to the post-ingest review save: refs survive
  only if the reviewed ingredient list is untouched. Cook mode falls back to string
  matching whenever refs are absent.

## Backfill

One-shot `scripts/backfill-translate-sections.ts`:

1. Select candidate dishes: missing `method_refs`, OR ingredients lack `section`, OR
   method detected non-English (cheap classify).
2. Re-run each candidate's existing `recipe` (+ title/subtitle) through the new ingest
   pipeline → translated + sectioned + ref'd output.
3. **`--dry-run` (default):** write an old→new JSON preview for review (re-translation
   rewrites content; not auto-applied).
4. **`--apply`:** update reviewed rows in place. Dish #48 is fixed in this pass.

## Docs to update

- `AGENTS.md`: ingredient field table gains `section`; "AI ingest pipeline" gains
  recipe-format guarantee, `methodRefs`, language setting, **model = Sonnet**.
- `~/CLAUDE.md` (nex) Dinner Spinner section: note ingest now translates + sections.
- `db/schema.sql`: the two `ALTER TABLE` additions.

## Verification

- Unit: `parseMethod` (sections, per-section restart, prose-as-step, no-header case).
- Unit: phrase-linkify (loose ref "the seeds", composite "the dough", multi-occurrence,
  empty-refs fallback).
- Unit: aggregation unchanged when `section` present (sections never split shopping list).
- Manual (via /run or /verify): re-ingest the Turkse Pizza URL → English title + method,
  numbered per section, sectioned ingredient groups, tappable "the seeds"/"the dough".
- Existing `AGENTS.md` curl checks still pass (401 unauth, authed list, tag index,
  create, Todoist).

## Out of scope (future)

- Non-English **ingredient display-name** localization (needs canonical-name vs
  display-name split so aggregation still merges).
- Per-recipe **translation toggle** (Mirko flagged this as a later addition).
- Fully-structured method as source of truth.
- Recomputing `methodRefs` automatically on manual method edits.

## Key risks / gotchas

- Aggregation key must exclude `section` (else cross-dish shopping lists fragment).
- Back-compat: all existing dishes have no `section`, no `method_refs` → must render and
  highlight exactly as today.
- Phrase ambiguity: resolve overlaps longest-first; a phrase appearing in several steps
  links each occurrence (acceptable).
- `methodRefs` indices must be validated against `ingredients.length` server-side
  (drop out-of-range). Positional indices also go stale on ingredient reorder/rename —
  handled by clearing refs in the edit form (Workstream 6), with string-match fallback.
- `default_language` NULL semantics = English; the column is additive and idempotent
  (`ADD COLUMN IF NOT EXISTS`), irreversible without manual DDL.
