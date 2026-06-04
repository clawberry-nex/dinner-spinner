# Recipe Ingest Normalization & Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recipe ingestion produce consistent, translated, structured recipes — numbered steps, English (per the user's default language), section-grouped ingredients, and ingest-time ingredient→method links that make cook-mode highlighting language- and loose-reference-proof.

**Architecture:** One coordinated change. A new pure `lib/recipe.ts` consolidates method parsing, ingredient-section grouping, and ingredient↔text matching (unifying two divergent parsers). The ingest prompt gains translation + numbered-step + section + `methodRefs` (phrase→ingredient sidecar) instructions; the model runs on Sonnet. New nullable columns (`dishes.method_refs`, `users.default_language`) flow through schema, routes, and form. Cook mode links by phrase lookup with a string-match fallback. A dry-run backfill script repairs existing dishes.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Zod v4, `@neondatabase/serverless`, React 19, Tailwind v4. Tests: Node built-in runner (`node --test <file>`, Node 22 strips types natively — no jest/vitest). No ORM; `db/schema.sql` applied by hand.

**Conventions for the executor:**
- Run a single test file with `node --test path/to/file.test.ts`. Run all with `node --test 'lib/**/*.test.ts'`.
- Imports in this codebase use explicit `.ts`/`.tsx`-less paths for app code (`@/lib/...`) but **relative imports inside `lib/` use explicit `.ts` extensions** (e.g. `import { x } from "./types.ts"`). Match the file you're editing.
- **Commits:** this repo commits only when the user asks. The `Commit` steps below are logical checkpoints — stage/commit locally as you go, but do not `git push` unless asked.
- The pre-existing suite has **one already-failing test** (`lib/ingest/prompt.test.ts` asserts `"finn likes this"`, absent from the current prompt). Task 11 fixes it. Don't be alarmed by that one red test before Task 11.

---

## File Structure

**New files:**
- `lib/languages.ts` — supported UI/translation languages + `languageName(code)`. Pure.
- `lib/languages.test.ts`
- `lib/recipe.ts` — pure: `parseMethod`, `groupIngredientsBySection`, `findNameSpans`, `findPhraseSpans`, `sanitizeMethodRefs`, shared types. (Absorbs logic currently inline in `cook-view.tsx`.)
- `lib/recipe.test.ts`
- `app/_components/recipe-method.tsx` — renders a parsed method (sections + per-section-restart numbered steps + inline bold). Replaces `MarkdownLite` for the recipe.
- `app/api/me/language/route.ts` — GET/PATCH the user's `default_language`.
- `scripts/backfill-translate-sections.ts` — one-shot dry-run/apply re-ingest of existing dishes.

**Modified files:**
- `lib/types.ts` — `MethodRefSchema`/`MethodRef`, `Ingredient.section`, `methodRefs` on `DishInputSchema`/`DishPatchSchema`/`Dish`, `rowToDish` mapping.
- `lib/ingest/schema.test.ts` — assert new fields surface in the JSON schema.
- `lib/ingest/prompt.ts` + `prompt.test.ts` — translation, numbered steps, `section`, `methodRefs`; `targetLanguage` input.
- `app/api/ingest/route.ts` — read `default_language` → `targetLanguage`; model `sonnet`.
- `app/dishes/[id]/dish-view.tsx` — section-grouped ingredients; `RecipeMethod` for the recipe.
- `app/dishes/[id]/cook/cook-view.tsx` — use shared `lib/recipe.ts`; section-grouped ingredient grid; phrase-based linking + multi-ingredient highlight.
- `app/_components/dish-form.tsx` — carry `section` + `methodRefs` through the draft; clear refs on ingredient change; per-ingredient `section` input.
- `app/api/dishes/route.ts` + `app/api/dishes/[id]/route.ts` — persist + sanitize `method_refs`.
- `app/settings/settings-client.tsx` — Language section.
- `db/schema.sql` — two `ADD COLUMN IF NOT EXISTS`.
- `AGENTS.md`, `~/CLAUDE.md` — doc updates.

**Deleted:**
- `app/_components/markdown-lite.tsx` — only used for the recipe (confirmed single usage); replaced by `RecipeMethod`.

---

## Task 1: `lib/languages.ts` — supported languages

**Files:**
- Create: `lib/languages.ts`
- Test: `lib/languages.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/languages.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_LANGUAGES, languageName, isSupportedLanguage } from "./languages.ts";

test("English is the default for null/unknown codes", () => {
  assert.equal(languageName(null), "English");
  assert.equal(languageName(undefined), "English");
  assert.equal(languageName("zz"), "English");
});

test("maps known codes to names", () => {
  assert.equal(languageName("nl"), "Dutch");
  assert.equal(languageName("de"), "German");
  assert.equal(languageName("EN"), "English"); // case-insensitive
});

test("the list includes English first and is non-empty", () => {
  assert.ok(SUPPORTED_LANGUAGES.length >= 2);
  assert.equal(SUPPORTED_LANGUAGES[0].code, "en");
});

test("isSupportedLanguage accepts null (means default) and known codes only", () => {
  assert.equal(isSupportedLanguage(null), true);
  assert.equal(isSupportedLanguage("nl"), true);
  assert.equal(isSupportedLanguage("zz"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/languages.test.ts`
Expected: FAIL — cannot find module `./languages.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/languages.ts
// Supported recipe/UI languages. `default_language` on users stores the
// `code` (or NULL = English). The ingest prompt translates all human-readable
// recipe text into the user's chosen language; English is the canonical
// default and the language of ingredient `name` vocabulary.

export type SupportedLanguage = { code: string; label: string };

// English first — it is the default and the canonical ingredient-name language.
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "en", label: "English" },
  { code: "nl", label: "Dutch" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
];

const BY_CODE = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l.label]));

// Resolve a stored code to a human language name for the ingest prompt.
// NULL / unknown / undefined → "English" (the default target).
export function languageName(code: string | null | undefined): string {
  if (!code) return "English";
  return BY_CODE.get(code.trim().toLowerCase()) ?? "English";
}

// NULL is allowed (means "use default" = English). Otherwise must be a known code.
export function isSupportedLanguage(code: string | null | undefined): boolean {
  if (code === null || code === undefined) return true;
  return BY_CODE.has(code.trim().toLowerCase());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/languages.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/languages.ts lib/languages.test.ts
git commit -m "feat(i18n): supported languages + languageName helper"
```

---

## Task 2: Schema/types — `MethodRef`, `Ingredient.section`, `methodRefs`

**Files:**
- Modify: `lib/types.ts:3-21` (IngredientSchema), `:25-46` (DishInputSchema), `:59-73` (DishPatchSchema), `:76-96` (Dish type), `:120-144` (rowToDish)
- Test: `lib/ingest/schema.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append to `lib/ingest/schema.test.ts`)

```ts
test("schema declares an optional methodRefs property", () => {
  // methodRefs is .nullable().optional(), so Zod v4 may emit it as an `anyOf`
  // wrapper rather than a bare {type:"array"}. Assert the property exists.
  const s = DISH_INPUT_JSON_SCHEMA as { properties?: Record<string, unknown> };
  assert.ok(s.properties && "methodRefs" in s.properties, "methodRefs property exists");
});

test("ingredient items declare an optional section field", () => {
  const s = DISH_INPUT_JSON_SCHEMA as {
    properties?: {
      ingredients?: { items?: { properties?: Record<string, unknown> } };
    };
  };
  assert.ok(
    s.properties?.ingredients?.items?.properties?.section,
    "ingredient items should expose a `section` property",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/ingest/schema.test.ts`
Expected: FAIL — `methodRefs` / `section` undefined.

- [ ] **Step 3: Add `section` to `IngredientSchema`** (`lib/types.ts`, inside the `z.object({...})` at lines 3-21, after the `alternatives` block, before the closing `});`)

```ts
  // The recipe part this ingredient belongs to, mirroring a "## Section"
  // header in the method (e.g. "Dough", "Filling", "Toppings"). Display-only —
  // never affects shopping-list aggregation. Null/absent for single-part recipes.
  section: z.string().trim().max(40).nullable().optional(),
```

- [ ] **Step 4: Add `MethodRefSchema`/`MethodRef`** (`lib/types.ts`, immediately after `export type Ingredient = ...;` at line 23)

```ts
// A link from a phrase in the (translated) method text to the ingredient(s)
// it references. Resolved at ingest so cook-mode highlighting is a precise
// lookup — language- and loose-reference-proof ("the seeds" → cumin seeds,
// "the dough" → flour+water+yeast). `ingredients` holds 0-based indices into
// the dish's `ingredients` array.
export const MethodRefSchema = z.object({
  phrase: z.string().trim().min(1).max(80),
  ingredients: z.array(z.number().int().nonnegative()).min(1).max(20),
});

export type MethodRef = z.infer<typeof MethodRefSchema>;
```

- [ ] **Step 5: Add `methodRefs` to `DishInputSchema`** (after the `recipe:` line, line 28)

```ts
  methodRefs: z.array(MethodRefSchema).max(300).nullable().optional(),
```

- [ ] **Step 6: Add `methodRefs` to `DishPatchSchema`** (after its `recipe:` line, line 62)

```ts
  methodRefs: z.array(MethodRefSchema).max(300).nullable().optional(),
```

- [ ] **Step 7: Add `methodRefs` to the `Dish` type** (after the `recipe: string | null;` line, line 80)

```ts
  methodRefs: MethodRef[] | null;
```

- [ ] **Step 8: Map it in `rowToDish`** (after the `recipe: (...) ?? null,` line, line 127)

```ts
    methodRefs: (row.method_refs as MethodRef[] | null) ?? null,
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `node --test lib/ingest/schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 10: Commit**

```bash
git add lib/types.ts lib/ingest/schema.test.ts
git commit -m "feat(types): ingredient section + methodRefs schema"
```

---

## Task 3: DB columns

**Files:**
- Modify: `db/schema.sql` (append after line 115)

- [ ] **Step 1: Append the additive DDL** (end of `db/schema.sql`)

```sql

-- Ingest normalization (2026-06): per-step phrase→ingredient links resolved
-- at ingest for cook-mode highlighting, and per-user default recipe language.
ALTER TABLE dishes ADD COLUMN IF NOT EXISTS method_refs jsonb;
ALTER TABLE users  ADD COLUMN IF NOT EXISTS default_language text;
```

- [ ] **Step 2: Apply to the database**

Run (uses the production Neon URL from the project env; for local dev use your local `DATABASE_URL`):
```bash
DB=$(grep -E '^DATABASE_URL=' .env.production.local | head -1 | cut -d= -f2- | tr -d '"')
psql "$DB" -c "ALTER TABLE dishes ADD COLUMN IF NOT EXISTS method_refs jsonb; ALTER TABLE users ADD COLUMN IF NOT EXISTS default_language text;"
```
Expected: `ALTER TABLE` printed twice (idempotent — safe to re-run).

- [ ] **Step 3: Verify columns exist**

Run:
```bash
psql "$DB" -c "\d dishes" | grep method_refs
psql "$DB" -c "\d users"  | grep default_language
```
Expected: each grep prints the new column row.

- [ ] **Step 4: Commit**

```bash
git add db/schema.sql
git commit -m "feat(db): method_refs + default_language columns"
```

---

## Task 4: `lib/recipe.ts` — `parseMethod`

**Files:**
- Create: `lib/recipe.ts`
- Test: `lib/recipe.test.ts`

This is the parser currently inline in `cook-view.tsx::parseRecipe` (lines 149-188), extracted verbatim so both views share it. Per-section numbering happens at render time (`stepIdx + 1` within each section's `steps`), so the parser just groups steps under sections.

- [ ] **Step 1: Write the failing test**

```ts
// lib/recipe.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMethod } from "./recipe.ts";

test("groups numbered steps under ## section headers", () => {
  const md = "## Dough\n1. Mix\n2. Knead\n## Filling\n1. Chop\n2. Fry";
  const out = parseMethod(md);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, "Dough");
  assert.deepEqual(out[0].steps, ["Mix", "Knead"]);
  assert.equal(out[1].title, "Filling");
  assert.deepEqual(out[1].steps, ["Chop", "Fry"]);
});

test("treats prose paragraphs as steps (no-header recipes get numbered)", () => {
  const md = "Heat the pan.\n\nAdd the onion.";
  const out = parseMethod(md);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, null);
  assert.deepEqual(out[0].steps, ["Heat the pan.", "Add the onion."]);
});

test("handles bulleted lists and an implicit leading section", () => {
  const md = "- step one\n- step two";
  const out = parseMethod(md);
  assert.equal(out[0].title, null);
  assert.deepEqual(out[0].steps, ["step one", "step two"]);
});

test("drops empty sections", () => {
  const md = "## Empty\n## Real\n1. do it";
  const out = parseMethod(md);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Real");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/recipe.test.ts`
Expected: FAIL — cannot find module `./recipe.ts`.

- [ ] **Step 3: Create `lib/recipe.ts` with `parseMethod`**

```ts
// lib/recipe.ts
// Pure helpers for recipe method text and ingredient↔method linking.
// Shared by the dish detail view (RecipeMethod) and cook mode (CookView)
// so numbering and matching behave identically everywhere.

import type { MethodRef } from "./types.ts";

export interface RecipeSection {
  title: string | null;
  steps: string[];
}

// Parse a recipe markdown blob into sections of steps. Recognizes:
//   ## Heading   — starts a new section
//   1. Step text — numbered list item
//   - Step text  — bulleted list item
//   prose line   — treated as its own step (so prose recipes still number)
// Per-section step numbering is applied at render time (index within section).
export function parseMethod(md: string): RecipeSection[] {
  const sections: RecipeSection[] = [];
  let current: RecipeSection | null = null;
  const ensureSection = () => {
    if (!current) {
      current = { title: null, steps: [] };
      sections.push(current);
    }
    return current;
  };

  for (const rawLine of md.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      current = { title: heading[1].trim(), steps: [] };
      sections.push(current);
      continue;
    }

    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      ensureSection().steps.push(numbered[1].trim());
      continue;
    }

    const bulleted = line.match(/^[-*]\s+(.*)$/);
    if (bulleted) {
      ensureSection().steps.push(bulleted[1].trim());
      continue;
    }

    ensureSection().steps.push(line);
  }

  return sections.filter((s) => s.steps.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/recipe.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/recipe.ts lib/recipe.test.ts
git commit -m "feat(recipe): shared parseMethod parser"
```

---

## Task 5: `lib/recipe.ts` — `groupIngredientsBySection`

**Files:**
- Modify: `lib/recipe.ts`
- Test: `lib/recipe.test.ts` (append)

- [ ] **Step 1: Write the failing test** (append)

```ts
import { groupIngredientsBySection } from "./recipe.ts";

const get = (x: { section?: string | null }) => x.section ?? null;

test("groups by section in first-seen order, null section trails last", () => {
  const items = [
    { name: "flour", section: "Dough" },
    { name: "tomato", section: "Filling" },
    { name: "water", section: "Dough" },
    { name: "salt", section: null },
  ];
  const groups = groupIngredientsBySection(items, get);
  assert.deepEqual(groups.map((g) => g.title), ["Dough", "Filling", null]);
  // original indices are preserved for ref/highlight lookups
  assert.deepEqual(groups[0].items.map((i) => i.index), [0, 2]);
  assert.equal(groups[0].items[0].item.name, "flour");
  assert.deepEqual(groups[2].items.map((i) => i.index), [3]);
});

test("all-unsectioned → a single null-title group (flat, back-compat)", () => {
  const items = [{ name: "a" }, { name: "b" }];
  const groups = groupIngredientsBySection(items, get);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, null);
  assert.deepEqual(groups[0].items.map((i) => i.index), [0, 1]);
});

test("treats empty-string section as null", () => {
  const items = [{ name: "a", section: "  " }];
  const groups = groupIngredientsBySection(items, get);
  assert.equal(groups[0].title, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/recipe.test.ts`
Expected: FAIL — `groupIngredientsBySection` is not exported.

- [ ] **Step 3: Add the implementation** (append to `lib/recipe.ts`)

```ts
export interface SectionGroup<T> {
  title: string | null;
  items: { item: T; index: number }[];
}

// Group items by section, preserving first-seen section order. Items with no
// section (null/blank) collect into a trailing null-title group. When NO item
// has a section, returns a single null-title group containing everything —
// so existing (sectionless) dishes render exactly as a flat list.
export function groupIngredientsBySection<T>(
  items: T[],
  getSection: (item: T) => string | null | undefined,
): SectionGroup<T>[] {
  const titled = new Map<string, SectionGroup<T>>();
  const order: string[] = [];
  const nullGroup: SectionGroup<T> = { title: null, items: [] };

  items.forEach((item, index) => {
    const raw = getSection(item);
    const title = raw && raw.trim() ? raw.trim() : null;
    if (title === null) {
      nullGroup.items.push({ item, index });
      return;
    }
    let g = titled.get(title);
    if (!g) {
      g = { title, items: [] };
      titled.set(title, g);
      order.push(title);
    }
    g.items.push({ item, index });
  });

  const out: SectionGroup<T>[] = order.map((t) => titled.get(t)!);
  if (nullGroup.items.length > 0) out.push(nullGroup);
  // Edge: no items at all → return one empty null group for stable rendering.
  return out.length > 0 ? out : [nullGroup];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/recipe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recipe.ts lib/recipe.test.ts
git commit -m "feat(recipe): groupIngredientsBySection"
```

---

## Task 6: `lib/recipe.ts` — span finders (`findNameSpans`, `findPhraseSpans`)

**Files:**
- Modify: `lib/recipe.ts`
- Test: `lib/recipe.test.ts` (append)

`findNameSpans` is `cook-view.tsx::findIngredientSpans` (lines 26-56) moved here and returning `idxs: number[]` (always a single-element array) so cook-view can treat name- and phrase-spans uniformly. `findPhraseSpans` is new.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { findNameSpans, findPhraseSpans } from "./recipe.ts";

test("findNameSpans matches literal ingredient names (case/plural insensitive)", () => {
  const spans = findNameSpans("Chop the Onions and garlic", [
    { name: "onion" },
    { name: "garlic" },
  ]);
  // one span for "Onions" (idx 0) and one for "garlic" (idx 1)
  const byIdx = spans.map((s) => s.idxs[0]).sort();
  assert.deepEqual(byIdx, [0, 1]);
});

test("findPhraseSpans links loose phrases to ingredient indices", () => {
  const refs = [
    { phrase: "the seeds", ingredients: [3] },
    { phrase: "the dough", ingredients: [0, 1, 2] },
  ];
  const text = "Fry the seeds, then roll out the dough.";
  const spans = findPhraseSpans(text, refs);
  const seeds = spans.find((s) => text.slice(s.start, s.end) === "the seeds");
  const dough = spans.find((s) => text.slice(s.start, s.end) === "the dough");
  assert.deepEqual(seeds?.idxs, [3]);
  assert.deepEqual(dough?.idxs, [0, 1, 2]);
});

test("findPhraseSpans finds every occurrence of a phrase", () => {
  const refs = [{ phrase: "onion", ingredients: [0] }];
  const spans = findPhraseSpans("onion here, onion there", refs);
  assert.equal(spans.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/recipe.test.ts`
Expected: FAIL — finders not exported.

- [ ] **Step 3: Add the implementation** (append to `lib/recipe.ts`)

```ts
export interface IngredientSpan {
  start: number;
  end: number;
  idxs: number[];
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Literal-name matcher (the legacy/fallback path). Word-boundary, case-
// insensitive, tolerant of a trailing plural "s". Used when a dish has no
// methodRefs (old dishes, or a hand-edited method).
export function findNameSpans(
  text: string,
  ingredients: { name: string }[],
): IngredientSpan[] {
  if (ingredients.length === 0) return [];
  const entries = ingredients
    .map((ing, idx) => ({ name: ing.name.trim(), idx }))
    .filter((e) => e.name.length >= 3)
    .sort((a, b) => b.name.length - a.name.length);
  if (entries.length === 0) return [];

  const alternation = entries.map((e) => escapeRegex(e.name)).join("|");
  const re = new RegExp(`\\b(?:${alternation})s?\\b`, "gi");
  const spans: IngredientSpan[] = [];

  for (const m of text.matchAll(re)) {
    const matched = m[0];
    const normalized = matched.replace(/s$/i, "").toLowerCase();
    const hit = entries.find(
      (e) =>
        e.name.toLowerCase() === normalized ||
        e.name.toLowerCase() === matched.toLowerCase(),
    );
    if (!hit) continue;
    const start = m.index ?? 0;
    spans.push({ start, end: start + matched.length, idxs: [hit.idx] });
  }
  return spans;
}

// Phrase matcher (preferred). For each methodRef, find every occurrence of its
// exact phrase in the text and link it to the referenced ingredient indices.
// Phrases were authored by the model from this exact (translated) text, so the
// match is reliable and language/loose-reference proof.
export function findPhraseSpans(
  text: string,
  refs: MethodRef[],
): IngredientSpan[] {
  const spans: IngredientSpan[] = [];
  for (const ref of refs) {
    const phrase = ref.phrase.trim();
    if (!phrase) continue;
    const re = new RegExp(escapeRegex(phrase), "gi");
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      spans.push({ start, end: start + m[0].length, idxs: ref.ingredients });
    }
  }
  return spans;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/recipe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recipe.ts lib/recipe.test.ts
git commit -m "feat(recipe): name + phrase span finders"
```

---

## Task 7: `lib/recipe.ts` — `sanitizeMethodRefs`

**Files:**
- Modify: `lib/recipe.ts`
- Test: `lib/recipe.test.ts` (append)

Server-side defense: drop refs whose indices fall outside the ingredient array, and drop now-empty refs.

- [ ] **Step 1: Write the failing test** (append)

```ts
import { sanitizeMethodRefs } from "./recipe.ts";

test("sanitizeMethodRefs drops out-of-range indices and empties", () => {
  const refs = [
    { phrase: "a", ingredients: [0, 5] }, // 5 out of range for count=3
    { phrase: "b", ingredients: [9] }, // fully invalid → dropped
    { phrase: "c", ingredients: [1, 2] },
  ];
  const out = sanitizeMethodRefs(refs, 3);
  assert.deepEqual(out, [
    { phrase: "a", ingredients: [0] },
    { phrase: "c", ingredients: [1, 2] },
  ]);
});

test("sanitizeMethodRefs returns null for null/empty input", () => {
  assert.equal(sanitizeMethodRefs(null, 3), null);
  assert.equal(sanitizeMethodRefs([], 3), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/recipe.test.ts`
Expected: FAIL — `sanitizeMethodRefs` not exported.

- [ ] **Step 3: Add the implementation** (append to `lib/recipe.ts`)

```ts
// Drop refs whose ingredient indices are out of range for the persisted
// ingredient array; drop refs left with no valid index. Returns null when
// nothing survives (so the column is cleared and cook-mode falls back).
export function sanitizeMethodRefs(
  refs: MethodRef[] | null | undefined,
  ingredientCount: number,
): MethodRef[] | null {
  if (!refs || refs.length === 0) return null;
  const cleaned = refs
    .map((r) => ({
      phrase: r.phrase,
      ingredients: r.ingredients.filter(
        (i) => Number.isInteger(i) && i >= 0 && i < ingredientCount,
      ),
    }))
    .filter((r) => r.phrase.trim().length > 0 && r.ingredients.length > 0);
  return cleaned.length > 0 ? cleaned : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/recipe.test.ts`
Expected: PASS (all `lib/recipe.test.ts` tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/recipe.ts lib/recipe.test.ts
git commit -m "feat(recipe): sanitizeMethodRefs"
```

---

## Task 8: `RecipeMethod` component + use it in dish-view

**Files:**
- Create: `app/_components/recipe-method.tsx`
- Modify: `app/dishes/[id]/dish-view.tsx:9` (import), `:304` (usage)
- Delete: `app/_components/markdown-lite.tsx`

No unit test (no React test harness in this repo); verified by `parseMethod` tests + manual render. Keep `RecipeMethod` a thin renderer over the tested `parseMethod`.

- [ ] **Step 1: Create the component**

```tsx
// app/_components/recipe-method.tsx
import type { ReactNode } from "react";
import { parseMethod } from "@/lib/recipe";

// Inline bold (**x**) — preserves the one inline style MarkdownLite supported.
function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="text-ink">
          {p.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

// Renders a recipe method as sections of numbered steps. Numbering restarts
// per section (index within the section). Shared shape with cook mode.
export function RecipeMethod({ text }: { text: string }) {
  const sections = parseMethod(text);
  if (sections.length === 0) {
    return <p className="my-[6px]">{inline(text)}</p>;
  }
  return (
    <>
      {sections.map((section, si) => (
        <section key={si} className="mb-4">
          {section.title && (
            <h3
              className="mt-[18px] mb-1 text-[18px] italic font-medium tracking-[-0.01em] text-ink"
              style={{ fontFamily: "var(--font-disp)" }}
            >
              {section.title}
            </h3>
          )}
          <ol className="m-0 my-2 list-none p-0">
            {section.steps.map((step, j) => (
              <li key={j} className="flex gap-3 py-[6px]">
                <span
                  className="min-w-[18px] pt-[2px] text-[12px] font-semibold text-accent"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {j + 1}.
                </span>
                <span className="flex-1">{inline(step)}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Swap the import in `dish-view.tsx`** (line 9)

Replace:
```tsx
import { MarkdownLite } from "@/app/_components/markdown-lite";
```
with:
```tsx
import { RecipeMethod } from "@/app/_components/recipe-method";
```

- [ ] **Step 3: Swap the usage in `dish-view.tsx`** (line 304)

Replace:
```tsx
              <MarkdownLite text={dish.recipe} />
```
with:
```tsx
              <RecipeMethod text={dish.recipe} />
```

- [ ] **Step 4: Delete the dead component**

```bash
git rm app/_components/markdown-lite.tsx
```

- [ ] **Step 5: Verify it compiles and no stale references**

Run:
```bash
grep -rn "markdown-lite\|MarkdownLite" app/ lib/ || echo "no references — good"
npx eslint app/_components/recipe-method.tsx "app/dishes/[id]/dish-view.tsx"
```
Expected: "no references — good"; eslint clean.

- [ ] **Step 6: Commit**

```bash
git add app/_components/recipe-method.tsx "app/dishes/[id]/dish-view.tsx"
git commit -m "feat(recipe): RecipeMethod component replaces MarkdownLite for the method"
```

---

## Task 9: dish-view — section-grouped ingredients

**Files:**
- Modify: `app/dishes/[id]/dish-view.tsx:9` (import), `:259-286` (ingredient render)

- [ ] **Step 1: Add the import** (next to the `RecipeMethod` import added in Task 8)

```tsx
import { groupIngredientsBySection } from "@/lib/recipe";
```

- [ ] **Step 2: Replace the flat ingredient map** — replace the block at lines 259-286 (from `<div className="mt-2">` through its closing `</div>` that wraps the `.map(...)` and the empty-state line) with a grouped render. New block:

```tsx
          <div className="mt-2">
            {groupIngredientsBySection(dish.ingredients, (ing) => ing.section ?? null).map(
              (group, gi) => (
                <div key={gi}>
                  {group.title && (
                    <div className="mt-3 mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                      {group.title}
                    </div>
                  )}
                  {group.items.map(({ item: ing, index: i }) => {
                    const qty =
                      (ing.quantity ?? 0) * (ing.scalable === false ? 1 : ratio);
                    const unit =
                      ing.unit && ing.unit !== "piece" ? ` ${ing.unit}` : "";
                    return (
                      <div
                        key={i}
                        className={[
                          "flex items-baseline gap-3 border-b border-rule-soft py-[10px]",
                          ing.pantry ? "italic text-ink-3" : "text-ink",
                        ].join(" ")}
                      >
                        <span
                          className="min-w-[52px] text-right text-[12px] font-medium text-ink-3"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {ing.quantity ? formatQty(qty) : ""}
                          {unit}
                        </span>
                        <span
                          className="flex-1 text-[14px] leading-snug"
                          style={{ fontFamily: "var(--font-sans)" }}
                        >
                          {ing.descriptor && (
                            <span className="text-ink-3">{ing.descriptor} </span>
                          )}
                          {ing.name}
                          {ing.alternatives?.length ? (
                            <span className="text-ink-3">
                              {" "}
                              (or {ing.alternatives.join(", ")})
                            </span>
                          ) : null}
                          {ing.preparation && (
                            <span className="text-ink-3">, {ing.preparation}</span>
                          )}
                          {ing.optional && (
                            <span className="text-ink-3"> (optional)</span>
                          )}
                        </span>
                        <span className="flex gap-1">
                          {ing.pantry && <Badge>pantry</Badge>}
                          {ing.scalable === false && <Badge>fixed</Badge>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ),
            )}
            {!dish.ingredients.length && (
              <div className="py-4 text-[13px] text-ink-3">
                No ingredients listed.
              </div>
            )}
          </div>
```

- [ ] **Step 3: Verify**

Run: `npx eslint "app/dishes/[id]/dish-view.tsx"`
Expected: clean. (A sectionless dish renders one null-title group = unchanged flat list.)

- [ ] **Step 4: Commit**

```bash
git add "app/dishes/[id]/dish-view.tsx"
git commit -m "feat(dish): group ingredients by section on the detail view"
```

---

## Task 10: cook-view — shared parser, grouped grid, phrase linking

**Files:**
- Modify: `app/dishes/[id]/cook/cook-view.tsx` (imports; remove local `escapeRegex`/`Span.idx`/`findIngredientSpans`/`Section`/`parseRecipe`; `linkifyStep`; highlight state; ingredient grid; step render)

- [ ] **Step 1: Update imports** (lines 6-16 region). Add `MethodRef` to the types import, import the shared helpers, and keep the rest.

Replace lines 6-16:
```tsx
import type { Dish, Ingredient } from "@/lib/types";
import { Icon } from "@/app/_components/icon";
import { StepperButton } from "@/app/_components/ui";
import {
  formatQty,
  scaleIngredient,
  visibleUnit,
} from "@/lib/ingredients";
import { findTimers } from "@/lib/timer-parse";
import { useTimers } from "./use-timers";
import TimerPanel from "./timer-panel";
```
with:
```tsx
import type { Dish, Ingredient, MethodRef } from "@/lib/types";
import { Icon } from "@/app/_components/icon";
import { StepperButton } from "@/app/_components/ui";
import {
  formatQty,
  scaleIngredient,
  visibleUnit,
} from "@/lib/ingredients";
import {
  parseMethod,
  groupIngredientsBySection,
  findNameSpans,
  findPhraseSpans,
} from "@/lib/recipe";
import { findTimers } from "@/lib/timer-parse";
import { useTimers } from "./use-timers";
import TimerPanel from "./timer-panel";
```

- [ ] **Step 2: Delete the local `escapeRegex` and `findIngredientSpans`** — remove lines 18-20 (`escapeRegex`) and lines 26-56 (`findIngredientSpans`). Change the `Span` type (lines 22-24) so the ingredient variant carries `idxs`:

Replace:
```tsx
type Span =
  | { kind: "ingredient"; start: number; end: number; idx: number }
  | { kind: "timer"; start: number; end: number; seconds: number; label: string };
```
with:
```tsx
type Span =
  | { kind: "ingredient"; start: number; end: number; idxs: number[] }
  | { kind: "timer"; start: number; end: number; seconds: number; label: string };
```

- [ ] **Step 3: Rewrite `linkifyStep`** (was lines 62-136). New signature takes `methodRefs` and an `onTapIngredients(idxs)` callback:

```tsx
// Linkify a step's plain text. Ingredient references come from the dish's
// methodRefs (phrase lookup) when present, else fall back to literal name
// matching. Duration patterns ("15 min") become tappable timers.
// Overlaps resolve earliest-start-wins; equal starts favor the longer span.
function linkifyStep(
  text: string,
  ingredients: Ingredient[],
  methodRefs: MethodRef[] | null,
  onTapIngredients: (idxs: number[]) => void,
  onStartTimer: (label: string, seconds: number) => void,
): React.ReactNode[] {
  const ingRaw =
    methodRefs && methodRefs.length > 0
      ? findPhraseSpans(text, methodRefs)
      : findNameSpans(text, ingredients);
  const ingredientSpans: Span[] = ingRaw.map((s) => ({
    kind: "ingredient",
    start: s.start,
    end: s.end,
    idxs: s.idxs,
  }));
  const timerSpans: Span[] = findTimers(text).map((t) => ({
    kind: "timer",
    start: t.start,
    end: t.end,
    seconds: t.seconds,
    label: t.label,
  }));

  const all = [...ingredientSpans, ...timerSpans].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });

  const picked: Span[] = [];
  let cursor = 0;
  for (const s of all) {
    if (s.start < cursor) continue;
    picked.push(s);
    cursor = s.end;
  }

  if (picked.length === 0) return [text];

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const s of picked) {
    if (s.start > lastIndex) parts.push(text.slice(lastIndex, s.start));
    const matched = text.slice(s.start, s.end);
    if (s.kind === "ingredient") {
      parts.push(
        <button
          key={`ing-${key++}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTapIngredients(s.idxs);
          }}
          className="inline underline decoration-dotted decoration-emerald-500 underline-offset-2 hover:bg-emerald-100 dark:hover:bg-emerald-950"
        >
          {matched}
        </button>,
      );
    } else {
      parts.push(
        <button
          key={`tmr-${key++}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStartTimer(s.label, s.seconds);
          }}
          title={`Start ${s.label} timer`}
          className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-amber-400 bg-amber-50 px-1.5 py-0 align-baseline text-[13px] font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
        >
          <span aria-hidden="true">⏱</span>
          {matched}
        </button>,
      );
    }
    lastIndex = s.end;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
```

- [ ] **Step 4: Delete the local `Section` type and `parseRecipe`** — remove lines 138-188 (the `type Section = ...` block and the entire `parseRecipe` function). They now come from `lib/recipe.ts` (`RecipeSection` / `parseMethod`).

- [ ] **Step 5: Update the component state and `scrollToIngredient`** — in `CookView`, replace the highlight state (line 252) and the `scrollToIngredient` callback (lines 279-287), and the `sections` memo (lines 257-260), and add a grouped-ingredients memo.

Replace line 252:
```tsx
  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);
```
with:
```tsx
  const [highlighted, setHighlighted] = useState<Set<number>>(new Set());
  const highlightToken = useRef(0);
```

Replace the `sections` memo (lines 257-260):
```tsx
  const sections = useMemo(
    () => (dish.recipe ? parseRecipe(dish.recipe) : []),
    [dish.recipe],
  );
```
with:
```tsx
  const sections = useMemo(
    () => (dish.recipe ? parseMethod(dish.recipe) : []),
    [dish.recipe],
  );
```

Replace `scrollToIngredient` (lines 279-287):
```tsx
  const scrollToIngredient = useCallback((idx: number) => {
    const el = ingredientRefs.current[idx];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedIdx(idx);
    window.setTimeout(() => {
      setHighlightedIdx((cur) => (cur === idx ? null : cur));
    }, 1600);
  }, []);
```
with:
```tsx
  const scrollToIngredients = useCallback((idxs: number[]) => {
    const valid = idxs.filter(
      (i) => i >= 0 && ingredientRefs.current[i] != null,
    );
    if (valid.length === 0) return;
    ingredientRefs.current[valid[0]]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    const token = ++highlightToken.current;
    setHighlighted(new Set(valid));
    window.setTimeout(() => {
      if (highlightToken.current === token) setHighlighted(new Set());
    }, 1600);
  }, []);

  const ingredientGroups = useMemo(
    () =>
      groupIngredientsBySection(scaledIngredients, (ing) => ing.section ?? null),
    [scaledIngredients],
  );
```

- [ ] **Step 6: Replace the ingredient grid** — replace the `<ul ...>` ... `</ul>` block (lines 322-347) with a grouped render:

```tsx
        <div className="overflow-auto px-4 pb-3 text-[14px]">
          {ingredientGroups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? "mt-2" : ""}>
              {group.title && (
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                  {group.title}
                </div>
              )}
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                {group.items.map(({ item: ing, index: i }) => {
                  const unit = visibleUnit(ing.unit);
                  const pantry = !!ing.pantry;
                  const optional = !!ing.optional;
                  const isHighlighted = highlighted.has(i);
                  return (
                    <li
                      key={i}
                      ref={(el) => {
                        ingredientRefs.current[i] = el;
                      }}
                      className={[
                        "rounded-md px-2 py-1 transition-colors",
                        isHighlighted ? "bg-accent-tint" : "",
                        pantry ? "italic text-ink-3" : "text-ink",
                      ].join(" ")}
                    >
                      <span
                        className="text-[12px] text-ink-3"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {formatQty(ing.quantity)}
                        {unit ? ` ${unit}` : ""}
                      </span>{" "}
                      {ing.descriptor && (
                        <span className="text-ink-3">{ing.descriptor} </span>
                      )}
                      {ing.name}
                      {optional && (
                        <span className="text-[11px] text-ink-3"> (optional)</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
```

Note: the wrapping `<div className="flex max-h-[40vh] ...">` (line 313) and its header row (314-321) are unchanged; only the inner `<ul>` becomes the grouped `<div>` above. The old `<ul className="grid grid-cols-2 gap-x-4 gap-y-1 overflow-auto px-4 pb-3 ...">` carried `overflow-auto px-4 pb-3` — those move onto the new outer `<div>` (as written above).

- [ ] **Step 7: Update the `linkifyStep` call site** (was line 387) to pass `methodRefs` and the new handler:

Replace:
```tsx
                          {linkifyStep(step, scaledIngredients, scrollToIngredient, timers.start)}
```
with:
```tsx
                          {linkifyStep(step, scaledIngredients, dish.methodRefs, scrollToIngredients, timers.start)}
```

- [ ] **Step 8: Verify it compiles**

Run:
```bash
grep -n "parseRecipe\|findIngredientSpans\|highlightedIdx\|scrollToIngredient\b" "app/dishes/[id]/cook/cook-view.tsx" || echo "all old symbols gone — good"
npx eslint "app/dishes/[id]/cook/cook-view.tsx"
```
Expected: "all old symbols gone — good"; eslint clean.

- [ ] **Step 9: Commit**

```bash
git add "app/dishes/[id]/cook/cook-view.tsx"
git commit -m "feat(cook): shared parser, section-grouped grid, phrase-based ingredient links"
```

---

## Task 11: Ingest prompt — translation, numbered steps, section, methodRefs

**Files:**
- Modify: `lib/ingest/prompt.ts` (whole `buildIngestPrompt`)
- Modify: `lib/ingest/prompt.test.ts`

- [ ] **Step 1: Update `prompt.test.ts`** — fix the stale assertion and add coverage for the new instructions. Replace the test at lines 40-44 (`includes obvious-tag whitelist and forbids personal tags`) and append new tests:

Replace:
```ts
test("includes obvious-tag whitelist and forbids personal tags", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("vegetarian"));
  assert.ok(p.toLowerCase().includes("finn likes this"));
});
```
with:
```ts
test("includes obvious-tag whitelist and forbids personal tags", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("vegetarian"));
  assert.ok(p.toLowerCase().includes("no personal tags"));
});

test("translates all text to the target language (default English)", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/translate/i.test(p));
  assert.ok(p.includes("English"));
  const dutch = buildIngestPrompt({ ...FIXTURE, targetLanguage: "Dutch" });
  assert.ok(dutch.includes("Dutch"));
});

test("asks for numbered steps and section headers", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/numbered steps/i.test(p));
  assert.ok(p.includes("## "));
});

test("documents the section field and methodRefs", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(/section/i.test(p));
  assert.ok(p.includes("methodRefs"));
  assert.ok(p.includes("the seeds")); // loose-reference example
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/ingest/prompt.test.ts`
Expected: FAIL on the new assertions (and the rewritten one).

- [ ] **Step 3: Rewrite `lib/ingest/prompt.ts`**

```ts
export interface IngestPromptInput {
  /** Free-text from the textarea: prompt, recipe prose, or URL. May be null when only an image is attached. */
  userInput: string | null;
  /** Pantry default names, lowercased. */
  pantryList: string[];
  /** Human language name to translate all recipe text into. Defaults to English. */
  targetLanguage?: string;
}

export function buildIngestPrompt(input: IngestPromptInput): string {
  const inputBody =
    input.userInput && input.userInput.trim().length > 0
      ? input.userInput.trim()
      : "(see attached image)";

  const lang = (input.targetLanguage ?? "English").trim() || "English";

  const pantryLine = input.pantryList.length
    ? `Pantry items (mark \`pantry: true\` for exact or close semantic match like "cumin powder" → "cumin"): ${input.pantryList.join(", ")}.`
    : "";

  return `Parse this recipe and call submit_result. Do not respond with prose.

INPUT:
${inputBody}

LANGUAGE: Write ALL human-readable text — title, subtitle, recipe steps, "## Section" headers, descriptor, preparation — in ${lang}. Translate from the source language if needed. Two EXCEPTIONS stay canonical English: ingredient \`name\` (use the standard English vocabulary below) and \`image_description\`.

Each ingredient is split into structured fields — never cram everything into \`name\`:
- name: bare purchasable thing, singular and canonical, in English ("tomato" not "tomatoes", "chicken thigh" not "chicken legs", "green chili" not "green chilli"). Colour stays with name when it changes the product.
- descriptor: size/quality that matters at the store ("small", "medium", "large", "ripe"). Never "fresh" — implied.
- preparation: cut/cook prep ("thinly sliced", "peeled and diced", "trimmed").
- unit: prefer g, kg, ml, l, tsp, tbsp, cup, piece, clove, slice, sprig, leaf, head, bulb, stalk, bunch, handful, can, jar, bottle, pack, pinch, dash, splash, drizzle, to taste. Singular.
- Ingredient names/units are always English (stuks=piece, el=tbsp, tl=tsp, teentjes=clove, uien=onion, knoflook=garlic), even when the rest of the recipe is in ${lang}.
- section: when the recipe has labelled parts, set this to the part name matching a "## Section" header in the method (e.g. "Dough", "Filling", "Toppings"). Omit for single-part recipes.

Flags:
- scalable: false for FIXED quantities (1 bay leaf, 1 cinnamon stick, 1 stock cube). Default unset.
- optional: true if the recipe says "optional", "to taste" (non-pantry), "to serve", "to garnish".
- alternatives: ["X"] for "butter or X" — primary in name, others in alternatives.

${pantryLine}
For "salt and black pepper to taste" emit two pantry:true rows with unit="to taste", quantity=1.

Top-level fields:
- title: short dish name (in ${lang}).
- subtitle: optional 1-line description if obvious (in ${lang}).
- recipe: the method, only if the input had instructions, as Markdown in ${lang}. For multi-part recipes use "## Section Title" headers (e.g. "## Dough", "## Filling", "## Toppings"); under each, write numbered steps "1.", "2.", one step per line. Single-part recipes: numbered steps, no header.
- methodRefs: for every place the method text refers to an ingredient — INCLUDING loose references like "the seeds", "the dough", "the spices", "the sauce" — add { "phrase": <exact substring copied from your recipe text>, "ingredients": [<0-based indices into the ingredients array>] }. Use the EXACT substring as written in your ${lang} method. A phrase may map to several ingredients ("the dough" → flour, water, yeast). Only include references you are confident about.
- baseServings: from the recipe, default 4.
- tags: only obvious dietary/protein tags (vegetarian, vegan, chicken, beef, fish, pasta, rice, soup, curry, stir fry, salad, dessert, breakfast). No personal tags.
- image_description: one short visual phrase IN ENGLISH for image generation ("creamy mushroom pasta with parsley garnish").

Call submit_result now.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/ingest/prompt.test.ts`
Expected: PASS (all tests, including the previously-red one).

- [ ] **Step 5: Commit**

```bash
git add lib/ingest/prompt.ts lib/ingest/prompt.test.ts
git commit -m "feat(ingest): translation, numbered steps, sections, methodRefs in prompt"
```

---

## Task 12: Language settings API + UI

**Files:**
- Create: `app/api/me/language/route.ts`
- Modify: `app/settings/settings-client.tsx`

- [ ] **Step 1: Create the API route** (mirrors `app/api/me/todoist/route.ts`)

```ts
// app/api/me/language/route.ts
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";
import { isSupportedLanguage } from "@/lib/languages";

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`SELECT default_language FROM users WHERE id = ${userId}`;
  return Response.json({
    language: (rows[0]?.default_language as string | null) ?? null,
  });
}

export async function PATCH(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { language?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  // null clears (= default English). Otherwise must be a known code.
  const language =
    body.language == null ? null : body.language.trim().toLowerCase();
  if (!isSupportedLanguage(language)) {
    return Response.json({ error: "unsupported_language" }, { status: 400 });
  }
  await sql`UPDATE users SET default_language = ${language} WHERE id = ${userId}`;
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Add language state to `settings-client.tsx`** — after the Todoist state block (lines 26-31), add:

```tsx
  // Language section.
  const [language, setLanguage] = useState<string | null>(null);
  const [languageMsg, setLanguageMsg] = useState<string | null>(null);
```

Add the import at the top (after line 9):
```tsx
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
```

- [ ] **Step 3: Fetch language in `reload()`** — extend the `Promise.all` (lines 55-59) and handlers (60-70). Replace the `reload` body up to its closing brace with:

```tsx
  async function reload() {
    const [nRes, pRes, tRes, lRes] = await Promise.all([
      fetch("/api/ingredient-names"),
      fetch("/api/pantry-defaults"),
      fetch("/api/me/todoist"),
      fetch("/api/me/language"),
    ]);
    if (nRes.ok) setExistingNames((await nRes.json()) as string[]);
    if (pRes.ok) setPantryDefaults((await pRes.json()) as string[]);
    if (tRes.ok) {
      const td = (await tRes.json()) as {
        hasToken: boolean;
        projectName: string | null;
      };
      setTodoistHasToken(td.hasToken);
      setTodoistProject(td.projectName);
      setTodoistProjectInput(td.projectName ?? "");
    }
    if (lRes.ok) {
      const ld = (await lRes.json()) as { language: string | null };
      setLanguage(ld.language);
    }
  }
```

- [ ] **Step 4: Add a save handler** — after `clearTodoist` (line 111), add:

```tsx
  async function saveLanguage(value: string | null) {
    setLanguageMsg(null);
    setLanguage(value);
    const res = await fetch("/api/me/language", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: value }),
    });
    setLanguageMsg(res.ok ? "Saved." : `HTTP ${res.status}`);
  }
```

- [ ] **Step 5: Render the section** — insert a new `<section>` immediately after the Appearance line (`<Appearance />`, line 252):

```tsx
      {/* Recipe language */}
      <section>
        <h2 className="mb-3 text-xl font-semibold">Recipe language</h2>
        <p className="mb-3 text-xs text-zinc-500">
          New recipes are translated into this language when you add them.
          Ingredient names stay in English so shopping lists merge correctly.
        </p>
        <div className="flex items-center gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <select
            value={language ?? "en"}
            onChange={(e) => saveLanguage(e.target.value)}
            className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          {languageMsg && (
            <span className="text-sm text-zinc-600">{languageMsg}</span>
          )}
        </div>
      </section>
```

- [ ] **Step 6: Verify**

Run: `npx eslint app/settings/settings-client.tsx app/api/me/language/route.ts`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add app/api/me/language/route.ts app/settings/settings-client.tsx
git commit -m "feat(settings): per-user recipe language preference"
```

---

## Task 13: Ingest route — thread language + switch model to Sonnet

**Files:**
- Modify: `app/api/ingest/route.ts:72-92`

- [ ] **Step 1: Import the language helper** — add at the top of `app/api/ingest/route.ts` (after line 4):

```ts
import { sql } from "@/lib/db";
import { languageName } from "@/lib/languages";
```

- [ ] **Step 2: Read the user's language and build the prompt with it** — replace lines 72-77:

```ts
  const pantrySet = await getPantryDefaults(userId);
  const pantryList = Array.from(pantrySet).sort();
  const prompt = buildIngestPrompt({
    userInput: input ?? null,
    pantryList,
  });
```
with:
```ts
  const pantrySet = await getPantryDefaults(userId);
  const pantryList = Array.from(pantrySet).sort();
  const langRows = await sql`
    SELECT default_language FROM users WHERE id = ${userId}
  `;
  const targetLanguage = languageName(
    (langRows[0]?.default_language as string | null) ?? null,
  );
  const prompt = buildIngestPrompt({
    userInput: input ?? null,
    pantryList,
    targetLanguage,
  });
```

- [ ] **Step 3: Switch the model to Sonnet** — replace the `model` block (lines 86-91):

```ts
      // Haiku 4.5 — once we disabled extended thinking and pinned the
      // submit_result MCP tool with alwaysLoad on the agent side, Haiku
      // hits the ~16s mark with the same parse quality as Sonnet and at
      // ~⅓ the cost. Previous Haiku failure ("missed the recipe") was
      // the multi-turn thinking ambiguity, not capacity.
      model: "haiku",
```
with:
```ts
      // Sonnet — ingest now also translates the full method and resolves
      // ingredient references (methodRefs), which is meaningfully harder than
      // the old extract-only task. Ingest is an infrequent per-recipe op, so
      // the higher cost is negligible. Re-evaluate Haiku if cost becomes a
      // concern AND translation/ref quality holds.
      model: "sonnet",
```

- [ ] **Step 4: Verify**

Run: `npx eslint app/api/ingest/route.ts`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/ingest/route.ts
git commit -m "feat(ingest): use the user's language + Sonnet for ingest"
```

---

## Task 14: dish-form — carry `section` + `methodRefs`, clear refs on ingredient change

**Files:**
- Modify: `app/_components/dish-form.tsx` (types, draft converters, payload, ingredient row)

- [ ] **Step 1: Add `section` to `IngredientDraft` + `EMPTY_INGREDIENT`** (lines 13-37). Add `section: string;` to the type and `section: "",` to the empty literal.

In the `type IngredientDraft = {` block, after `preparation: string;`:
```ts
  section: string;
```
In `EMPTY_INGREDIENT`, after `preparation: "",`:
```ts
  section: "",
```

- [ ] **Step 2: Add `methodRefs` carry-state to `Draft` + `EMPTY_DRAFT`** (lines 39-71). Import the type and add two fields.

Add to the imports (line 4 region):
```ts
import type { Dish, DishInput, Ingredient, MethodRef } from "@/lib/types";
```
In `type Draft = {`, after `ingredients: IngredientDraft[];`:
```ts
  // Ingest-derived links, carried through edits untouched. Cleared on save if
  // the ingredient list changed (indices would go stale). `refNames` is the
  // snapshot of ingredient names the refs were computed against.
  methodRefs: MethodRef[] | null;
  refNames: string[] | null;
```
In `EMPTY_DRAFT`, after `ingredients: [{ ...EMPTY_INGREDIENT }],`:
```ts
  methodRefs: null,
  refNames: null,
```

- [ ] **Step 3: Map them in `dishToDraft`** (lines 73-103). In the `.map((i) => ({...}))` add `section: i.section ?? "",` (after `preparation`), and after the `ingredients:` property add the refs:

Inside the ingredient map object, after `preparation: i.preparation ?? "",`:
```ts
            section: i.section ?? "",
```
After the `ingredients: ...` property (before the closing `};` of the returned object):
```ts
    methodRefs: d.methodRefs ?? null,
    refNames: d.methodRefs?.length ? d.ingredients.map((i) => i.name) : null,
```

- [ ] **Step 4: Map them in `dishInputToDraft`** (lines 105-135). Same two edits.

Inside the ingredient map object, after `preparation: i.preparation ?? "",`:
```ts
            section: i.section ?? "",
```
After the `ingredients: ...` property:
```ts
    methodRefs: d.methodRefs ?? null,
    refNames: d.methodRefs?.length ? (d.ingredients ?? []).map((i) => i.name) : null,
```

- [ ] **Step 5: Emit `section` + conditionally-kept `methodRefs` in `draftToPayload`** (lines 137-177). Add `section` to each ingredient and compute `methodRefs` keep/clear.

In the `.map((i) => {...})` returned object, after `preparation: i.preparation.trim() || null,`:
```ts
        section: i.section.trim() || null,
```
Then, just before the final `return {` (line 162), insert:
```ts
  const currentNames = ingredients.map((i) => i.name);
  const refsValid =
    d.methodRefs != null &&
    d.refNames != null &&
    d.refNames.length === currentNames.length &&
    d.refNames.every((n, idx) => n === currentNames[idx]);
  const methodRefs = refsValid ? d.methodRefs : null;
```
And add to the returned object (after `ingredients,`):
```ts
    methodRefs,
```

- [ ] **Step 6: Add a `section` input to the ingredient row** — in the second row of inputs (the `<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">` at line 714), after the `prep` input (closes at line 722), add:

```tsx
                  <input
                    placeholder="section (Dough…)"
                    value={ing.section}
                    onChange={(e) =>
                      updateIngredient(i, { section: e.target.value })
                    }
                    className="w-32 rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
```

- [ ] **Step 7: Verify**

Run: `npx eslint app/_components/dish-form.tsx`
Expected: clean. (Type-check: `methodRefs` now flows in the payload; `POST`/`PATCH` accept it via Task 2's schema changes.)

- [ ] **Step 8: Commit**

```bash
git add app/_components/dish-form.tsx
git commit -m "feat(form): carry ingredient section + methodRefs; clear stale refs on edit"
```

---

## Task 15: Persist + sanitize `method_refs` in dish routes

**Files:**
- Modify: `app/api/dishes/route.ts` (POST), `app/api/dishes/[id]/route.ts` (PATCH)

- [ ] **Step 1: POST — sanitize + persist** (`app/api/dishes/route.ts`)

Add the import (after line 5):
```ts
import { sanitizeMethodRefs } from "@/lib/recipe";
```
Replace the `const d = {...}` block (lines 61-64):
```ts
  const d = {
    ...parsed.data,
    ingredients: await applyPantryDefaults(parsed.data.ingredients, userId),
  };
```
with:
```ts
  const ingredients = await applyPantryDefaults(parsed.data.ingredients, userId);
  const d = {
    ...parsed.data,
    ingredients,
    methodRefs: sanitizeMethodRefs(parsed.data.methodRefs, ingredients.length),
  };
```
Add `method_refs` to the INSERT column list (line 68, after `image_description, public`) → `..., image_description, public, method_refs`, and add the value (after the `${d.public ?? true}` line, line 84):
```ts
      ,
      ${d.methodRefs == null ? null : JSON.stringify(d.methodRefs)}::jsonb
```
(So the `VALUES (...)` ends `..., ${d.public ?? true}, ${d.methodRefs == null ? null : JSON.stringify(d.methodRefs)}::jsonb )`.)

- [ ] **Step 2: PATCH — sanitize + persist** (`app/api/dishes/[id]/route.ts`)

Add the import (after line 5):
```ts
import { sanitizeMethodRefs } from "@/lib/recipe";
```
After the `ingredients` const (lines 71-74), compute the merged refs. The refs are sanitized against the FINAL ingredient list. When the client omits `methodRefs`, keep the existing column; when it sends `null`, clear it; when it sends an array, sanitize it:
```ts
  const methodRefs =
    u.methodRefs === undefined
      ? sanitizeMethodRefs(existing.methodRefs, ingredients.length)
      : sanitizeMethodRefs(u.methodRefs, ingredients.length);
```
Add `method_refs` to the UPDATE SET (after the `public = ${merged.public},` line, line 108):
```ts
      method_refs = ${methodRefs == null ? null : JSON.stringify(methodRefs)}::jsonb,
```
(Place it before `updated_at = now()`.)

- [ ] **Step 3: Verify**

Run: `npx eslint app/api/dishes/route.ts "app/api/dishes/[id]/route.ts"`
Expected: clean.

- [ ] **Step 4: Manual round-trip check** (after `next dev` is running, or against prod with the API token)

```bash
BASE=http://localhost:3000   # or the prod URL
TOKEN="<API_TOKEN>"
# create a dish with refs + sections
curl -sS -X POST $BASE/api/dishes -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "title":"Ref test","baseServings":2,
  "ingredients":[{"quantity":1,"unit":"g","name":"cumin seeds","section":"Spice mix"}],
  "recipe":"## Spice mix\n1. Toast the seeds.",
  "methodRefs":[{"phrase":"the seeds","ingredients":[0]}]
}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('methodRefs:',d.get('methodRefs'));print('section:',d['ingredients'][0].get('section'))"
# Expected: methodRefs: [{'phrase': 'the seeds', 'ingredients': [0]}]   section: Spice mix
```

- [ ] **Step 5: Commit**

```bash
git add app/api/dishes/route.ts "app/api/dishes/[id]/route.ts"
git commit -m "feat(api): persist + sanitize method_refs on create/update"
```

---

## Task 16: Backfill script (dry-run → apply)

**Files:**
- Create: `scripts/backfill-translate-sections.ts`

Re-ingests existing dishes through the new pipeline (translation + sections + refs). Candidate = any dish with `method_refs IS NULL` (everything from before this change). Dry-run (default) writes a JSON preview for review; `--apply` writes to the DB; `--only <id>` targets one dish (e.g. #48).

- [ ] **Step 1: Create the script**

```ts
// scripts/backfill-translate-sections.ts
// One-shot: re-ingest existing dishes through the new ingest pipeline so they
// get translated method text, numbered steps, ingredient sections, and
// methodRefs. Safe by default — writes a preview and changes nothing.
//
// Usage (env from .env.production.local for prod, or your local env):
//   node --env-file=.env.production.local scripts/backfill-translate-sections.ts            # dry-run all candidates
//   node --env-file=.env.production.local scripts/backfill-translate-sections.ts --only 48  # dry-run one dish
//   node --env-file=.env.production.local scripts/backfill-translate-sections.ts --apply    # write changes
//
// Requires: DATABASE_URL, NEX_API_TOKEN, (optional) CLAUDE_AGENT_URL, SEED_OWNER_EMAIL.

import { sql } from "../lib/db.ts";
import { rowToDish, DishInputSchema } from "../lib/types.ts";
import { buildIngestPrompt } from "../lib/ingest/prompt.ts";
import { DISH_INPUT_JSON_SCHEMA } from "../lib/ingest/schema.ts";
import {
  startClaudeAgentJob,
  pollClaudeAgentJob,
} from "../lib/ingest/claude-agent.ts";
import { languageName } from "../lib/languages.ts";
import { sanitizeMethodRefs } from "../lib/recipe.ts";
import { writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? Number(process.argv[onlyIdx + 1]) : null;

const token = process.env.NEX_API_TOKEN;
if (!token) throw new Error("NEX_API_TOKEN required");
const baseUrl =
  process.env.CLAUDE_AGENT_URL ?? "https://nex.tail7f6b96.ts.net:10000";

async function reingestOne(row: Record<string, unknown>) {
  const dish = rowToDish(row);
  const userId = row.user_id as string;
  // Query pantry_names directly — DON'T import lib/pantry.ts (it has
  // `import "server-only"`, which throws under plain node/tsx).
  const pantryRows = await sql`
    SELECT name FROM pantry_names WHERE user_id = ${userId}
  `;
  const pantry = pantryRows
    .map((r) => (r.name as string).toLowerCase())
    .sort();
  const langRows = await sql`
    SELECT default_language FROM users WHERE id = ${userId}
  `;
  const targetLanguage = languageName(
    (langRows[0]?.default_language as string | null) ?? null,
  );
  // Feed the existing recipe + title/subtitle back through ingest.
  const userInput = [
    `Title: ${dish.title}`,
    dish.subtitle ? `Subtitle: ${dish.subtitle}` : "",
    "",
    "Ingredients:",
    ...dish.ingredients.map(
      (i) =>
        `- ${i.quantity} ${i.unit ?? ""} ${i.descriptor ?? ""} ${i.name}${i.preparation ? ", " + i.preparation : ""}`.replace(/\s+/g, " ").trim(),
    ),
    "",
    "Method:",
    dish.recipe ?? "",
  ].join("\n");

  const prompt = buildIngestPrompt({ userInput, pantryList: pantry, targetLanguage });
  const job = await startClaudeAgentJob({
    prompt,
    responseSchema: DISH_INPUT_JSON_SCHEMA,
    token,
    baseUrl,
    model: "sonnet",
  });
  // Poll until done.
  for (let i = 0; i < 120; i++) {
    const r = await pollClaudeAgentJob(job.jobId, { token, baseUrl });
    if (r.status === "done") {
      const parsed = DishInputSchema.safeParse(r.structured);
      if (!parsed.success) throw new Error("re-ingest failed validation");
      return { dish, next: parsed.data };
    }
    if (r.status === "failed") throw new Error(r.errorMessage ?? "job failed");
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("timed out");
}

async function main() {
  const rows = ONLY
    ? await sql`SELECT * FROM dishes WHERE id = ${ONLY}`
    : await sql`SELECT * FROM dishes WHERE method_refs IS NULL ORDER BY id`;
  console.log(`${rows.length} candidate dish(es). apply=${APPLY}`);

  const preview: unknown[] = [];
  for (const row of rows) {
    const id = row.id as number;
    try {
      const { dish, next } = await reingestOne(row);
      const methodRefs = sanitizeMethodRefs(
        next.methodRefs ?? null,
        next.ingredients.length,
      );
      preview.push({
        id,
        before: { title: dish.title, recipe: dish.recipe, ingredients: dish.ingredients },
        after: { title: next.title, recipe: next.recipe, ingredients: next.ingredients, methodRefs },
      });
      console.log(`#${id} "${dish.title}" → "${next.title}" (${methodRefs?.length ?? 0} refs)`);
      if (APPLY) {
        await sql`
          UPDATE dishes SET
            title = ${next.title},
            subtitle = ${next.subtitle ?? null},
            recipe = ${next.recipe ?? null},
            ingredients = ${JSON.stringify(next.ingredients)}::jsonb,
            method_refs = ${methodRefs == null ? null : JSON.stringify(methodRefs)}::jsonb,
            updated_at = now()
          WHERE id = ${id}
        `;
      }
    } catch (err) {
      console.error(`#${id} FAILED:`, err instanceof Error ? err.message : err);
    }
  }

  if (!APPLY) {
    const out = `backfill-preview-${ONLY ?? "all"}.json`;
    writeFileSync(out, JSON.stringify(preview, null, 2));
    console.log(`\nDry run — wrote ${out}. Review, then re-run with --apply.`);
  } else {
    console.log("\nApplied.");
  }
  process.exit(0);
}

main();
```

- [ ] **Step 2: Dry-run against dish #48**

Run:
```bash
node --env-file=.env.production.local scripts/backfill-translate-sections.ts --only 48
```
Expected: prints `#48 "Vegetarische Turkse Pizza" → "Vegetarian Turkish Pizza" (N refs)`; writes `backfill-preview-48.json`.

- [ ] **Step 3: Review the preview, then apply #48**

```bash
python3 -m json.tool backfill-preview-48.json | head -60   # eyeball before/after
node --env-file=.env.production.local scripts/backfill-translate-sections.ts --only 48 --apply
```
Expected: `Applied.` Then open `/dishes/48` and `/dishes/48/cook` and confirm English numbered steps, sectioned ingredients, tappable "the seeds"/"the dough".

- [ ] **Step 4: Commit** (the script; preview JSON is a local artifact — don't commit it)

```bash
echo "backfill-preview-*.json" >> .gitignore
git add scripts/backfill-translate-sections.ts .gitignore
git commit -m "feat(scripts): backfill re-ingest for translation/sections/refs"
```

---

## Task 17: Docs

**Files:**
- Modify: `AGENTS.md`, `~/CLAUDE.md`

- [ ] **Step 1: `AGENTS.md` — ingredient field table** — add a `section` row to the field table (after the `alternatives` row) and to the TypeScript ingredient object shape:

In the `{ quantity, unit, ... }` block add `section?: string,  // recipe part: "Dough", "Filling"`; in the table add:
```
| `section` | The recipe part this ingredient belongs to (multi-part recipes). Display-only — never splits the shopping list. | `Dough`, `Filling`, `Toppings` | grouped on the dish, not on the shopping list |
```

- [ ] **Step 2: `AGENTS.md` — AI ingest pipeline section** — update the model line and add the new guarantees. Replace the "Model choice: Sonnet…" / "Model choice" note with:

```
Model choice: **Sonnet**. Ingest now also translates the full method into the
user's `default_language` (English by default), emits numbered steps under
`## Section` headers, tags ingredients with a `section`, and returns
`methodRefs` (phrase→ingredient links) so cook-mode highlighting is language-
and loose-reference-proof. Haiku was insufficient for the translation + ref
task; re-test only if cost becomes a concern.
```

- [ ] **Step 3: `AGENTS.md` — parsing rules** — under "Parsing recipes into ingredient rows", note that recipe `recipe` must be numbered steps with optional `## Section` headers, and that `methodRefs` should use exact substrings from the translated method.

- [ ] **Step 4: `~/CLAUDE.md` — Dinner Spinner section** — in the "Dinner Spinner — recipe ingestion" block, add one line: "Ingest translates recipes to the user's default language (English default), produces numbered/sectioned methods, and resolves ingredient references (`methodRefs`) for cook-mode highlighting. Ingest model is Sonnet."

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs: ingest translation, sections, methodRefs, Sonnet"
# ~/CLAUDE.md is outside the repo — edit it but it isn't committed here.
```

---

## Final verification

- [ ] **Step 1: Full unit suite green**

Run: `node --test 'lib/**/*.test.ts'`
Expected: all pass — including `lib/recipe.test.ts`, `lib/languages.test.ts`, `lib/ingest/prompt.test.ts` (the previously-red one now fixed), `lib/ingest/schema.test.ts`.

- [ ] **Step 2: Type-check + build** (runs Next typegen + tsc)

Run: `npx next build`
Expected: build succeeds, no type errors. (If `RouteContext`/`PageProps` errors appear, run `npx next typegen` first — the new `/api/me/language` route uses a plain `Request` so this shouldn't be needed.)

- [ ] **Step 3: Lint**

Run: `npx eslint`
Expected: clean.

- [ ] **Step 4: Manual end-to-end** — `next dev`, then add the Turkse Pizza URL via `/add`:
  - Method renders as English numbered steps, restart-per-section, under `## Dough/Filling/Toppings`.
  - Ingredients on the dish page are grouped under section sub-headers; the two tomato rows sit under their respective sections.
  - In cook mode, tapping "the seeds"/"the dough"/an ingredient name highlights the right ingredient row(s).
  - Settings → Recipe language shows the selector and persists.

- [ ] **Step 5: Existing API contract still holds**

Run the curl block from `AGENTS.md` § Verification (401 unauth, authed list, tag index, create, Todoist) against the running app.
Expected: unchanged behavior.

---

## Spec coverage map

| Spec workstream | Task(s) |
|---|---|
| Data model (`section`, `method_refs`, `default_language`) | 2, 3 |
| Ingest prompt rewrite | 11 |
| Shared `parseMethod` + `RecipeMethod` | 4, 8 |
| Ingredient section grouping (display only; aggregation untouched) | 5, 9, 8 |
| Cook-mode phrase linking + fallback | 6, 10 |
| Language setting (API + UI + ingest threading) | 1, 12, 13 |
| Sonnet model + persistence wiring | 13, 15 |
| Form preservation + clear-on-edit | 14 |
| Backfill (dry-run → apply) | 16 |
| Docs | 17 |
| Out of scope (non-English ingredient names, translation toggle, structured method, ref auto-recompute) | — (documented, not built) |
