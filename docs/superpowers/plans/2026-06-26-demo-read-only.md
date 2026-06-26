# Demo (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, no-login, fully read-only `/demo` of Dinner Spinner — spin, browse, open recipes (scale + ingredient highlighting), and an ephemeral shopping list/plan — backed by a static snapshot of real recipes, with zero DB/mutation access.

**Architecture:** Capture the live pages' server seams (data reads, plan persistence, Todoist, link base) in an `ExperienceConfig` React context. Render the SAME spinner/plan/dish components under both `/` (live config, default) and `/demo` (demo config: snapshot data, no-op persistence, read-only). The demo's data comes from a bundled `lib/demo/dishes.ts` snapshot; it ships empty so `/demo` 404s until real recipes are generated from the DB.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind v4, `@neondatabase/serverless`, npm. Tests: `node:test` via `npx tsx --test`.

## Global Constraints

- **Next.js 16 App Router.** `params`/`props.params` are Promises — always `await` them in routes. Generated types `RouteContext`/`PageProps` come from `npx next typegen`.
- **Tests** live colocated as `lib/**/*.test.ts`, run with `npx tsx --test <file>`, import `node:test` + `node:assert/strict`, and import local modules with the explicit `.ts` extension (e.g. `import { x } from "./y.ts"`). localStorage-dependent assertions fail under tsx — test only pure logic.
- **Read-only invariants (must hold):** no `/demo` code path issues a mutating request (`POST/PATCH/PUT/DELETE`) or hits `/api/*` for data; demo data is read from the bundled snapshot only; demo browser state uses keys `demoMealPlan` / `demoSpinnerFilters` (never the live `mealPlan` / `spinnerFilters`).
- **Dormancy:** `lib/demo/dishes.ts` ships with `DEMO_DISHES = []`; every `/demo` route calls `notFound()` while the snapshot is empty. Never commit real-looking placeholder recipes.
- **Privacy:** the snapshot generator strips `notes` and `imageDescription` (sets them `null`).
- **Behavior-preserving:** live `/`, `/plan`, `/dishes/[id]` must render and behave exactly as before; the default `ExperienceConfig` is the live config.
- **Branch:** `feat/demo-read-only`. Commit after every task.
- **Verification reality:** the production Neon DB is quota-blocked until ~2026-07-01, so live pages can't be run end-to-end right now. Verify via unit tests + `npx next typegen && npx tsc --noEmit`, and smoke the demo with a temporary local fixture (the demo needs no DB).

---

### Task 1: Key-parameterized plan storage (`lib/plan-storage.ts`)

A leaf module so the demo plan can use a separate localStorage key with no server sync. Mirrors `lib/meal-plan.ts`'s normalization but parameterized by key, with the parse logic split out so it's unit-testable without a real `localStorage`.

**Files:**
- Create: `lib/plan-storage.ts`
- Test: `lib/plan-storage.test.ts`

**Interfaces:**
- Produces: `type PlanEntry = { id: number; servings: number; day?: number | null }`; `normalizePlanEntry(raw: unknown): PlanEntry | null`; `parsePlan(raw: string | null): PlanEntry[]`; `readPlan(key: string): PlanEntry[]`; `writePlan(key: string, entries: PlanEntry[]): void`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/plan-storage.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlanEntry, parsePlan } from "./plan-storage.ts";

test("normalizePlanEntry keeps id+servings and a valid day", () => {
  assert.deepEqual(normalizePlanEntry({ id: 3, servings: 2, day: 1 }), { id: 3, servings: 2, day: 1 });
});

test("normalizePlanEntry drops an invalid day but keeps the entry", () => {
  assert.deepEqual(normalizePlanEntry({ id: 3, servings: 2, day: 9 }), { id: 3, servings: 2 });
});

test("normalizePlanEntry rejects non-entries", () => {
  assert.equal(normalizePlanEntry({ servings: 2 }), null);
  assert.equal(normalizePlanEntry(null), null);
  assert.equal(normalizePlanEntry("x"), null);
});

test("parsePlan filters junk and returns [] on bad input", () => {
  assert.deepEqual(parsePlan(JSON.stringify([{ id: 1, servings: 4 }, { bad: true }])), [{ id: 1, servings: 4 }]);
  assert.deepEqual(parsePlan(null), []);
  assert.deepEqual(parsePlan("not json"), []);
  assert.deepEqual(parsePlan(JSON.stringify({ not: "array" })), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/plan-storage.test.ts`
Expected: FAIL — `Cannot find module './plan-storage.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/plan-storage.ts
// Key-parameterized plan storage. The live app uses key "mealPlan" with a
// server PUT (see lib/meal-plan.ts); the read-only demo uses "demoMealPlan"
// with NO server sync. Parse logic is split from localStorage access so it's
// unit-testable (localStorage isn't available under the tsx test runner).

export type PlanEntry = { id: number; servings: number; day?: number | null };

function isValidDay(day: unknown): day is number {
  return typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6;
}

export function normalizePlanEntry(raw: unknown): PlanEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number" || typeof r.servings !== "number") return null;
  const entry: PlanEntry = { id: r.id, servings: r.servings };
  if (isValidDay(r.day)) entry.day = r.day;
  return entry;
}

export function parsePlan(raw: string | null): PlanEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePlanEntry).filter((e): e is PlanEntry => e !== null);
  } catch {
    return [];
  }
}

export function readPlan(key: string): PlanEntry[] {
  if (typeof window === "undefined") return [];
  return parsePlan(localStorage.getItem(key));
}

export function writePlan(key: string, entries: PlanEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/plan-storage.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/plan-storage.ts lib/plan-storage.test.ts
git commit -m "feat(demo): key-parameterized plan storage"
```

---

### Task 2: Demo snapshot + data source (`lib/demo/`)

The snapshot module (ships empty) and the pure tag-filter/derive helpers that back the demo data loaders.

**Files:**
- Create: `lib/demo/dishes.ts`
- Create: `lib/demo/source.ts`
- Test: `lib/demo/source.test.ts`

**Interfaces:**
- Consumes: `Dish` from `@/lib/types`.
- Produces: `DEMO_DISHES: Dish[]`, `DEMO_TAGS: string[]`, `DEMO_READY: boolean` (from `lib/demo/dishes.ts`); `filterDishesByTags(dishes: Dish[], tags: string[]): Dish[]`, `deriveTags(dishes: Dish[]): string[]`, `demoLoadDishes(tags: string[]): Promise<Dish[]>`, `demoLoadTags(): Promise<string[]>` (from `lib/demo/source.ts`).

- [ ] **Step 1: Create the empty snapshot module**

```ts
// lib/demo/dishes.ts
// AUTO-GENERATED by scripts/build-demo-snapshot.ts.
// Ships EMPTY: while DEMO_DISHES is empty, every /demo route 404s (see app/demo/*).
// Do not hand-author recipe data here — run the generator against the DB instead.
import type { Dish } from "@/lib/types";

export const DEMO_DISHES: Dish[] = [];
export const DEMO_TAGS: string[] = [];
export const DEMO_READY: boolean = DEMO_DISHES.length > 0;
```

- [ ] **Step 2: Write the failing test**

```ts
// lib/demo/source.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterDishesByTags, deriveTags } from "./source.ts";
import type { Dish } from "../types.ts";

function dish(id: number, title: string, tags: string[]): Dish {
  return {
    id, title, subtitle: null, recipe: null, tags, ingredients: [],
    baseServings: 4, favorite: false, imageUrl: null, emoji: null, accent: null,
    notes: null, imageDescription: null, public: true, lastCookedAt: null,
    averageRating: null, ratingCount: 0, cookCount: 0,
    createdAt: "2026-01-01", updatedAt: "2026-01-01",
  };
}
const dishes = [
  dish(1, "Zucchini Bake", ["vegetarian", "quick"]),
  dish(2, "Aloo Gobi", ["vegetarian", "indian"]),
  dish(3, "Beef Stew", ["meat"]),
];

test("no tags returns all, sorted by title", () => {
  assert.deepEqual(filterDishesByTags(dishes, []).map((d) => d.title), ["Aloo Gobi", "Beef Stew", "Zucchini Bake"]);
});

test("tags use AND-semantics (must contain every tag)", () => {
  assert.deepEqual(filterDishesByTags(dishes, ["vegetarian"]).map((d) => d.id), [2, 1]);
  assert.deepEqual(filterDishesByTags(dishes, ["vegetarian", "indian"]).map((d) => d.id), [2]);
  assert.deepEqual(filterDishesByTags(dishes, ["vegetarian", "meat"]), []);
});

test("blank tags are ignored", () => {
  assert.equal(filterDishesByTags(dishes, ["  "]).length, 3);
});

test("deriveTags returns the sorted union", () => {
  assert.deepEqual(deriveTags(dishes), ["indian", "meat", "quick", "vegetarian"]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx --test lib/demo/source.test.ts`
Expected: FAIL — `Cannot find module './source.ts'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// lib/demo/source.ts
// Read-only data source for the /demo experience. Pure helpers (testable)
// plus async loaders bound to the bundled snapshot. NEVER touches the DB or
// /api/* — that is the read-only guarantee.
import type { Dish } from "@/lib/types";
import { DEMO_DISHES, DEMO_TAGS } from "./dishes";

// Mirrors GET /api/dishes: AND-semantics tag filter, ordered by title ASC.
export function filterDishesByTags(dishes: Dish[], tags: string[]): Dish[] {
  const wanted = tags.map((t) => t.trim()).filter(Boolean);
  const matched = wanted.length
    ? dishes.filter((d) => wanted.every((t) => d.tags.includes(t)))
    : dishes.slice();
  return matched.sort((a, b) => a.title.localeCompare(b.title));
}

export function deriveTags(dishes: Dish[]): string[] {
  const set = new Set<string>();
  for (const d of dishes) for (const t of d.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function demoLoadDishes(tags: string[]): Promise<Dish[]> {
  return filterDishesByTags(DEMO_DISHES, tags);
}

export async function demoLoadTags(): Promise<string[]> {
  return DEMO_TAGS.length ? DEMO_TAGS : deriveTags(DEMO_DISHES);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test lib/demo/source.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/demo/dishes.ts lib/demo/source.ts lib/demo/source.test.ts
git commit -m "feat(demo): empty snapshot module + read-only data source"
```

---

### Task 3: ExperienceConfig (`app/_experiences/config.ts` + `experience-config.tsx`)

The seam abstraction. Config *values* live in a plain (no-JSX) module so the read-only invariants are unit-testable; the React context/providers/hook live in the `.tsx`.

**Files:**
- Create: `app/_experiences/config.ts`
- Create: `app/_experiences/experience-config.tsx`
- Test: `app/_experiences/config.test.ts`

**Interfaces:**
- Consumes: `Dish` (`@/lib/types`), `PlanEntry` (`@/lib/plan-storage`), `demoLoadDishes`/`demoLoadTags` (`@/lib/demo/source`).
- Produces: `type ExperienceConfig`; `liveExperienceConfig`, `demoExperienceConfig` (from `config.ts`); `ExperienceProvider`, `DemoExperienceProvider`, `useExperienceConfig()` (from `experience-config.tsx`).

`ExperienceConfig` shape (used by Tasks 4–8):
```ts
type ExperienceConfig = {
  loadDishes: (tags: string[]) => Promise<Dish[]>;
  loadTags: () => Promise<string[]>;
  hrefBase: string;                 // "" (live) | "/demo"
  spinnerFiltersKey: string;        // "spinnerFilters" | "demoSpinnerFilters"
  planStorageKey: string;           // "mealPlan" | "demoMealPlan"
  persistPlanRemote?: (entries: PlanEntry[]) => void;   // undefined in demo
  loadPlanRemote?: () => Promise<PlanEntry[] | null>;   // undefined in demo
  readonly: boolean;                // demo: true
};
```

- [ ] **Step 1: Write the failing test**

```ts
// app/_experiences/config.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { liveExperienceConfig, demoExperienceConfig } from "./config.ts";

test("live config is writable and same-origin", () => {
  assert.equal(liveExperienceConfig.readonly, false);
  assert.equal(liveExperienceConfig.hrefBase, "");
  assert.equal(liveExperienceConfig.planStorageKey, "mealPlan");
  assert.equal(liveExperienceConfig.spinnerFiltersKey, "spinnerFilters");
  assert.equal(typeof liveExperienceConfig.persistPlanRemote, "function");
});

test("demo config is read-only with isolated keys and NO server sync", () => {
  assert.equal(demoExperienceConfig.readonly, true);
  assert.equal(demoExperienceConfig.hrefBase, "/demo");
  assert.equal(demoExperienceConfig.planStorageKey, "demoMealPlan");
  assert.equal(demoExperienceConfig.spinnerFiltersKey, "demoSpinnerFilters");
  assert.equal(demoExperienceConfig.persistPlanRemote, undefined);
  assert.equal(demoExperienceConfig.loadPlanRemote, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test app/_experiences/config.test.ts`
Expected: FAIL — `Cannot find module './config.ts'`.

- [ ] **Step 3: Write `config.ts`**

```ts
// app/_experiences/config.ts
// Config values for the shared experiences. No JSX here so the read-only
// invariants stay unit-testable. fetch/localStorage are only touched inside
// the functions (at call time), so this module is safe to import in tests.
import type { Dish } from "@/lib/types";
import type { PlanEntry } from "@/lib/plan-storage";
import { demoLoadDishes, demoLoadTags } from "@/lib/demo/source";

export type ExperienceConfig = {
  loadDishes: (tags: string[]) => Promise<Dish[]>;
  loadTags: () => Promise<string[]>;
  hrefBase: string;
  spinnerFiltersKey: string;
  planStorageKey: string;
  persistPlanRemote?: (entries: PlanEntry[]) => void;
  loadPlanRemote?: () => Promise<PlanEntry[] | null>;
  readonly: boolean;
};

export const liveExperienceConfig: ExperienceConfig = {
  loadDishes: async (tags) => {
    const qs = tags.length ? `?tags=${encodeURIComponent(tags.join(","))}` : "";
    const res = await fetch(`/api/dishes${qs}`);
    return res.json();
  },
  loadTags: async () => {
    const res = await fetch("/api/tags");
    return res.json();
  },
  hrefBase: "",
  spinnerFiltersKey: "spinnerFilters",
  planStorageKey: "mealPlan",
  persistPlanRemote: (entries) => {
    void fetch("/api/meal-plan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries }),
    }).catch(() => {});
  },
  loadPlanRemote: async () => {
    try {
      const res = await fetch("/api/meal-plan");
      if (!res.ok) return null;
      const d = await res.json();
      return Array.isArray(d?.entries) ? d.entries : null;
    } catch {
      return null;
    }
  },
  readonly: false,
};

export const demoExperienceConfig: ExperienceConfig = {
  loadDishes: demoLoadDishes,
  loadTags: demoLoadTags,
  hrefBase: "/demo",
  spinnerFiltersKey: "demoSpinnerFilters",
  planStorageKey: "demoMealPlan",
  // persistPlanRemote / loadPlanRemote intentionally omitted → ephemeral, no server sync.
  readonly: true,
};
```

- [ ] **Step 4: Write `experience-config.tsx`**

```tsx
// app/_experiences/experience-config.tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";
import { type ExperienceConfig, liveExperienceConfig, demoExperienceConfig } from "./config";

// Default is the LIVE config, so existing pages need no provider.
const ExperienceContext = createContext<ExperienceConfig>(liveExperienceConfig);

export function useExperienceConfig(): ExperienceConfig {
  return useContext(ExperienceContext);
}

export function ExperienceProvider({ value, children }: { value: ExperienceConfig; children: ReactNode }) {
  return <ExperienceContext.Provider value={value}>{children}</ExperienceContext.Provider>;
}

// Binds the demo config internally so a SERVER layout can mount it without
// passing functions across the RSC boundary.
export function DemoExperienceProvider({ children }: { children: ReactNode }) {
  return <ExperienceContext.Provider value={demoExperienceConfig}>{children}</ExperienceContext.Provider>;
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx tsx --test app/_experiences/config.test.ts`
Expected: PASS (2 tests).
Run: `npx next typegen && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/_experiences/config.ts app/_experiences/experience-config.tsx app/_experiences/config.test.ts
git commit -m "feat(demo): ExperienceConfig context (live default + demo)"
```

---

### Task 4: Extract `SpinnerExperience`, make `app/page.tsx` a wrapper

Move the spinner body to a shared component reading the config; the live page becomes a thin server wrapper (context default = live).

**Files:**
- Create: `app/_experiences/spinner-experience.tsx`
- Modify: `app/page.tsx` (replace entire file)

**Interfaces:**
- Consumes: `useExperienceConfig` (Task 3).
- Produces: `export function SpinnerExperience()`.

- [ ] **Step 1: Create `spinner-experience.tsx` from the current spinner**

Copy the ENTIRE current contents of `app/page.tsx` into `app/_experiences/spinner-experience.tsx` verbatim (all helper components: `LoadingStage`, `Filmstrip`, `MobileResultDetail`, `DesktopResultHero`, `ReasonRows`, `describeFactor`, `signalGlyph`, `DietChips`, `SpinnerGlyph`, `EmptyPool`, etc.). Then apply the edits in Steps 2–6.

- [ ] **Step 2: Rename the export and import the config**

```tsx
// keep "use client" at the very top.
// add to the existing imports:
import { useExperienceConfig } from "./experience-config";

// change the function declaration:
export function SpinnerExperience() {   // was: export default function SpinnerPage()
  const router = useRouter();
  const cfg = useExperienceConfig();    // add this line
  // ...rest unchanged
```

- [ ] **Step 3: Route data reads through the config**

```tsx
// tags effect — was: fetch("/api/tags").then((r) => r.json()).then(setAllTags).catch(() => {});
useEffect(() => {
  cfg.loadTags().then(setAllTags).catch(() => {});
}, [cfg]);

// load() body — replace the fetch block:
const load = async (): Promise<Dish[]> => {
  try {
    const data = await cfg.loadDishes(selected);
    setDishes(data);
    return data;
  } catch {
    return [];
  } finally {
    setLoading(false);
  }
};
```

- [ ] **Step 4: Isolate the filters localStorage key**

```tsx
// hydrate effect — was localStorage.getItem("spinnerFilters")
const raw = localStorage.getItem(cfg.spinnerFiltersKey);
// persist effect — was localStorage.setItem("spinnerFilters", ...)
localStorage.setItem(cfg.spinnerFiltersKey, JSON.stringify(selected));
```

- [ ] **Step 5: Base navigation on `hrefBase` and gate "Add"**

```tsx
// both result onOpen handlers (Mobile + Desktop):
onOpen={() => router.push(`${cfg.hrefBase}/dishes/${pick.id}`)}
// EmptyPool add (unreachable in demo, but safe):
onAdd={() => router.push(cfg.readonly ? "/auth/signup" : "/add")}
```

- [ ] **Step 6: Replace `app/page.tsx` with a wrapper**

```tsx
// app/page.tsx
import { SpinnerExperience } from "./_experiences/spinner-experience";

export default function Page() {
  return <SpinnerExperience />;
}
```

- [ ] **Step 7: Typecheck**

Run: `npx next typegen && npx tsc --noEmit`
Expected: no errors. (Confirm `app/page.tsx` no longer has unused imports and `spinner-experience.tsx` imports `Dish`, `useRouter`, etc. that it uses.)

- [ ] **Step 8: Commit**

```bash
git add app/page.tsx app/_experiences/spinner-experience.tsx
git commit -m "refactor(spinner): extract SpinnerExperience behind ExperienceConfig"
```

---

### Task 5: Extract `PlanExperience`, make `app/plan/page.tsx` a wrapper

Same pattern for the plan page; persistence + Todoist route through the config, with a read-only sign-up nudge replacing the Todoist push in demo.

**Files:**
- Create: `app/_experiences/plan-experience.tsx`
- Modify: `app/plan/page.tsx` (replace entire file)

**Interfaces:**
- Consumes: `useExperienceConfig` (Task 3); `readPlan`, `writePlan`, `type PlanEntry` (Task 1).
- Produces: `export function PlanExperience()`.

- [ ] **Step 1: Create `plan-experience.tsx` from the current plan page**

Copy the ENTIRE current contents of `app/plan/page.tsx` into `app/_experiences/plan-experience.tsx` verbatim (all helpers: `formatAmounts`, `formatShoppingGroupLine`, `SummaryStat`, `Divider`, `ShoppingRow`, `PantryCheck`, `EmptyState`, `DayGroup`, `DishCard`, `DayPicker`, `SpinnerGlyph`). Then apply Steps 2–7.

- [ ] **Step 2: Rename export, import config + storage**

```tsx
// keep "use client".
import Link from "next/link";                       // already imported
import { useExperienceConfig } from "./experience-config";
import { readPlan, writePlan } from "@/lib/plan-storage";

export function PlanExperience() {                   // was: export default function PlanPage()
  const cfg = useExperienceConfig();                 // add
  // keep the local `type Entry = ...`; it is structurally identical to PlanEntry.
  // ...rest unchanged
```

- [ ] **Step 3: Route the initial load through the config**

```tsx
// replace the mount effect:
useEffect(() => {
  cfg.loadDishes([]).then(setDishes).catch(() => {});
  setEntries(readPlan(cfg.planStorageKey) as Entry[]);
  cfg.loadPlanRemote?.().then((remote) => {
    if (remote) {
      setEntries(remote as Entry[]);
      writePlan(cfg.planStorageKey, remote);
    }
  }).catch(() => {});
}, [cfg]);
```

- [ ] **Step 4: Route writes through the config**

```tsx
// replace write():
const write = (next: Entry[]) => {
  setEntries(next);
  writePlan(cfg.planStorageKey, next);
  cfg.persistPlanRemote?.(next);   // undefined in demo → ephemeral
};
```

- [ ] **Step 5: Base dish links on `hrefBase`**

In the `DishCard` helper (inside this file), change both `Link href={`/dishes/${dish.id}`}` to:
```tsx
// DishCard needs the base; pass cfg.hrefBase down OR read it. Simplest: add a
// prop. Update DishCard's signature to accept `hrefBase: string` and pass it
// from DayGroup → DishCard (DayGroup already receives byId etc.). Then:
<Link href={`${hrefBase}/dishes/${dish.id}`} aria-label={dish.title}>
<Link href={`${hrefBase}/dishes/${dish.id}`} className="min-w-0 flex-1 truncate ...">
```
Thread `hrefBase={cfg.hrefBase}` from `PlanExperience` → each `<DayGroup ... hrefBase={cfg.hrefBase} />` → each `<DishCard ... hrefBase={hrefBase} />`. Also update the empty-state `EmptyState` "Browse the library" link target to `${cfg.hrefBase || ""}/dishes` (pass it a `hrefBase` prop too).

- [ ] **Step 6: Replace the Todoist push with a read-only nudge in demo**

```tsx
// In PlanExperience, just before the "Send to Todoist" button block, branch on cfg.readonly.
// Replace the <button onClick={pushTodoist} ...> ... </button> with:
{cfg.readonly ? (
  <Link
    href="/auth/signup"
    className="mt-[22px] flex h-[54px] w-full items-center justify-center gap-[10px] rounded-pill bg-accent text-[15px] font-semibold text-accent-ink"
    style={{ fontFamily: "var(--font-sans)", letterSpacing: 0.2 }}
  >
    <Icon name="todoist" size={20} />Create an account to send to Todoist
  </Link>
) : (
  <button
    type="button"
    onClick={pushTodoist}
    disabled={pushing || remaining === 0}
    className="mt-[22px] flex h-[54px] w-full items-center justify-center gap-[10px] rounded-pill bg-accent text-[15px] font-semibold text-accent-ink transition-opacity disabled:opacity-50"
    style={{ fontFamily: "var(--font-sans)", letterSpacing: 0.2 }}
  >
    {pushing ? (<><SpinnerGlyph />Pushing…</>) : remaining === 0 ? (<><Icon name="check" size={20} />Got everything already</>) : (<><Icon name="todoist" size={20} />Send {remaining} to Todoist</>)}
  </button>
)}
// Update the helper <p> below it to a generic line when cfg.readonly:
<p className="mt-[11px] text-center text-[12px] leading-[1.5] text-text-faint">
  {cfg.readonly
    ? "This is a read-only demo — sign up to push your list to Todoist."
    : remaining === 0
      ? "You already have everything — nothing to buy."
      : `Sends the ${remaining} item${remaining !== 1 ? "s" : ""} you still need as tasks to your Todoist project. Prep detail (“finely diced”) is left off — it’s about what to buy.`}
</p>
```
(`pushTodoist` stays defined but is unreachable in demo. That is fine — it never fires without the button.)

- [ ] **Step 7: Replace `app/plan/page.tsx` with a wrapper**

```tsx
// app/plan/page.tsx
import { PlanExperience } from "../_experiences/plan-experience";

export default function Page() {
  return <PlanExperience />;
}
```

- [ ] **Step 8: Typecheck**

Run: `npx next typegen && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add app/plan/page.tsx app/_experiences/plan-experience.tsx
git commit -m "refactor(plan): extract PlanExperience; demo plan is ephemeral + read-only"
```

---

### Task 6: Parameterize `DishView` for the demo (additive)

Add optional `hrefBase` and `planConfig` so the demo dish page links within `/demo` and offers an ephemeral add-to-plan. Owner-only UI stays gated on `isOwner`. Live callers omit the new props → unchanged.

**Files:**
- Modify: `app/dishes/[id]/dish-view.tsx`

**Interfaces:**
- Consumes: `readPlan`, `writePlan` (Task 1).
- Produces: `DishView` now accepts optional `hrefBase?: string` (default `""`) and `planConfig?: { storageKey: string }`.

- [ ] **Step 1: Extend the props + imports**

```tsx
// add import:
import { readPlan, writePlan } from "@/lib/plan-storage";

// extend the component's prop type and destructuring:
export default function DishView({
  dish: initial,
  history: initialHistory,
  isOwner,
  ownerHandle,
  ownerName,
  hrefBase = "",
  planConfig,
}: {
  dish: Dish;
  history: CookLogEntry[];
  isOwner: boolean;
  ownerHandle: string | null;
  ownerName: string | null;
  hrefBase?: string;
  planConfig?: { storageKey: string };
}) {
```

- [ ] **Step 2: Base share + profile links on `hrefBase`**

```tsx
// in share(): was `${window.location.origin}/dishes/${dish.id}`
const url = `${window.location.origin}${hrefBase}/dishes/${dish.id}`;
```
(The "View profile" / "shared by" links use `ownerHandle`; the demo passes `ownerHandle = null`, so they don't render — no change needed.)

- [ ] **Step 3: Add an ephemeral demo add-to-plan affordance**

```tsx
// near the other state:
const [inDemoPlan, setInDemoPlan] = useState(false);
useEffect(() => {
  if (!planConfig) return;
  setInDemoPlan(readPlan(planConfig.storageKey).some((e) => e.id === initial.id));
}, [planConfig, initial.id]);

const addToDemoPlan = () => {
  if (!planConfig) return;
  const list = readPlan(planConfig.storageKey);
  const existing = list.find((e) => e.id === dish.id);
  const next = existing
    ? list.map((e) => (e.id === dish.id ? { ...e, servings } : e))
    : [...list, { id: dish.id, servings }];
  writePlan(planConfig.storageKey, next);
  setInDemoPlan(true);
  toast.show(existing ? `Updated to ${servings} servings` : `Added at ${servings} servings`);
};

// a reusable button element:
const demoPlanButton = planConfig ? (
  <button
    type="button"
    onClick={addToDemoPlan}
    className={[
      "inline-flex h-[52px] shrink-0 items-center gap-[7px] rounded-pill border px-5 text-[15px] font-semibold transition-colors",
      inDemoPlan ? "border-accent-line bg-accent-tint text-accent-2" : "border-line-2 bg-transparent text-text",
    ].join(" ")}
    style={{ fontFamily: "var(--font-sans)" }}
  >
    <Icon name={inDemoPlan ? "check" : "plus"} size={18} />{inDemoPlan ? "In plan" : "Add to plan"}
  </button>
) : null;
```

- [ ] **Step 4: Render the demo button under the servings control (both layouts)**

```tsx
// MOBILE: directly after the mobile "servings control" card block
// (the <div className="mx-[22px] mt-[18px] ...servings...">…</div>), add:
{planConfig && !isOwner && (
  <div className="mt-[14px] flex px-[22px]">{demoPlanButton}</div>
)}

// DESKTOP: inside the "ingredients — sticky panel", the visitor stepper block
// already renders for !isOwner. Add the button right after that stepper row:
{planConfig && !isOwner && <div className="mt-3">{demoPlanButton}</div>}
```

- [ ] **Step 5: Typecheck**

Run: `npx next typegen && npx tsc --noEmit`
Expected: no errors. Live `app/dishes/[id]/page.tsx` still compiles (new props optional).

- [ ] **Step 6: Commit**

```bash
git add app/dishes/[id]/dish-view.tsx
git commit -m "feat(demo): DishView hrefBase + ephemeral add-to-plan (additive, opt-in)"
```

---

### Task 7: Demo nav + shell wiring

A self-contained bottom bar for the demo (Decide · Library · Shop + read-only label + "Create your own"), wired into the shell so it replaces the real chrome on `/demo/*`.

**Files:**
- Create: `app/_components/demo-nav.tsx`
- Modify: `app/_components/app-shell.tsx`
- Modify: `app/_components/root-shell.tsx`

**Interfaces:**
- Consumes: `readPlan` (Task 1), `Icon`.
- Produces: `export function DemoNav({ planCount }: { planCount?: number })`.

- [ ] **Step 1: Create `demo-nav.tsx`**

```tsx
// app/_components/demo-nav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";

type Tab = { href: string; icon: IconName; label: string; badge?: number };

export function DemoNav({ planCount = 0 }: { planCount?: number }) {
  const pathname = usePathname() || "/demo";
  const tabs: Tab[] = [
    { href: "/demo", icon: "dome", label: "Decide" },
    { href: "/demo/dishes", icon: "books", label: "Library" },
    { href: "/demo/plan", icon: "basket", label: "Shop", badge: planCount || undefined },
  ];
  const isActive = (href: string) =>
    href === "/demo" ? pathname === "/demo" : pathname.startsWith(href);

  return (
    <nav
      className="sticky bottom-0 z-10 flex w-full flex-shrink-0 flex-col border-t border-line bg-surface/90 backdrop-blur-xl"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-center justify-center gap-2 border-b border-line/60 px-4 py-[6px] text-[11px] text-text-faint">
        <span className="font-semibold uppercase tracking-[0.14em] text-accent">Demo</span>
        <span className="text-text-faint">· read-only</span>
        <span className="mx-1 text-line-2">|</span>
        <Link href="/auth/signup" className="font-semibold text-accent-2 hover:underline">
          Create your own →
        </Link>
      </div>
      <div className="mx-auto flex w-full max-w-2xl items-stretch justify-around px-1 pt-1">
        {tabs.map((t) => {
          const active = isActive(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={[
                "relative flex flex-1 flex-col items-center gap-1 px-1 pt-[6px] pb-[5px]",
                active ? "text-accent-2" : "text-text-faint",
              ].join(" ")}
            >
              <span className="relative flex h-[23px] items-center justify-center">
                <Icon name={t.icon} size={22} stroke={active ? 1.95 : 1.6} />
                {t.badge ? (
                  <span className="absolute -top-[5px] -right-[10px] flex h-4 min-w-4 items-center justify-center rounded-pill border-2 border-surface bg-accent px-1 text-[10px] font-bold text-accent-ink">
                    {t.badge}
                  </span>
                ) : null}
              </span>
              <span className={["text-[10px] tracking-[0.02em]", active ? "font-bold" : "font-semibold"].join(" ")}>
                {t.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```
(If `dome`/`books`/`basket` are not valid `IconName`s, reuse the ones the real `TabBar` uses — they are taken from `tab-bar.tsx` verbatim, so they are valid.)

- [ ] **Step 2: Add a `bottomSlot` to `AppShell`**

```tsx
// app/_components/app-shell.tsx — extend the signature and render the slot.
export function AppShell({
  children, planCount, hideTabs, bottomSlot,
}: { children: ReactNode; planCount?: number; hideTabs?: boolean; bottomSlot?: ReactNode }) {
  // ...unchanged through the content column...
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {children}
        {!hide && <TabBar planCount={count} />}
        {bottomSlot}
      </div>
  // ...
}
```

- [ ] **Step 3: Make `RootShell` demo-aware**

```tsx
// app/_components/root-shell.tsx
"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AppShell } from "./app-shell";
import { ImportProvider } from "./import-provider";
import { DemoNav } from "./demo-nav";
import { readPlan } from "@/lib/plan-storage";

export function RootShell({ children, isSignedIn }: { children: ReactNode; isSignedIn: boolean }) {
  const [planCount, setPlanCount] = useState(0);
  const pathname = usePathname();
  const isDemo = (pathname || "").startsWith("/demo");

  useEffect(() => {
    const key = isDemo ? "demoMealPlan" : "mealPlan";
    const read = () => setPlanCount(readPlan(key).length);
    read();
    const onStorage = (e: StorageEvent) => { if (e.key === key) read(); };
    window.addEventListener("storage", onStorage);
    const t = window.setInterval(read, 1500);
    return () => { window.removeEventListener("storage", onStorage); window.clearInterval(t); };
  }, [pathname, isDemo]);

  return (
    <AppShell
      planCount={planCount}
      hideTabs={!isSignedIn || isDemo}
      bottomSlot={isDemo ? <DemoNav planCount={planCount} /> : undefined}
    >
      <ImportProvider isSignedIn={isSignedIn}>{children}</ImportProvider>
    </AppShell>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx next typegen && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/_components/demo-nav.tsx app/_components/app-shell.tsx app/_components/root-shell.tsx
git commit -m "feat(demo): demo bottom nav + shell wiring (real chrome hidden on /demo)"
```

---

### Task 8: Demo routes

The `/demo` route tree. Each route guards on the snapshot being non-empty (404 while dormant) and renders the shared experiences via the demo provider.

**Files:**
- Create: `app/demo/layout.tsx`
- Create: `app/demo/page.tsx`
- Create: `app/demo/plan/page.tsx`
- Create: `app/demo/dishes/page.tsx`
- Create: `app/_experiences/demo-library.tsx`
- Create: `app/demo/dishes/[id]/page.tsx`

**Interfaces:**
- Consumes: `DemoExperienceProvider` (Task 3), `SpinnerExperience` (Task 4), `PlanExperience` (Task 5), `DishView` (Task 6), `DEMO_DISHES` (Task 2), `readPlan`/`writePlan` (Task 1), `DishArt` (`@/app/_components/ui`).

- [ ] **Step 1: `app/demo/layout.tsx`**

```tsx
// app/demo/layout.tsx — server component; wraps the subtree in the demo config.
import { DemoExperienceProvider } from "../_experiences/experience-config";

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <DemoExperienceProvider>{children}</DemoExperienceProvider>;
}
```

- [ ] **Step 2: `app/demo/page.tsx` (spinner)**

```tsx
// app/demo/page.tsx
import { notFound } from "next/navigation";
import { DEMO_DISHES } from "@/lib/demo/dishes";
import { SpinnerExperience } from "../_experiences/spinner-experience";

export default function DemoSpinnerPage() {
  if (DEMO_DISHES.length === 0) notFound();
  return <SpinnerExperience />;
}
```

- [ ] **Step 3: `app/demo/plan/page.tsx`**

```tsx
// app/demo/plan/page.tsx
import { notFound } from "next/navigation";
import { DEMO_DISHES } from "@/lib/demo/dishes";
import { PlanExperience } from "../../_experiences/plan-experience";

export default function DemoPlanPage() {
  if (DEMO_DISHES.length === 0) notFound();
  return <PlanExperience />;
}
```

- [ ] **Step 4: `app/_experiences/demo-library.tsx` (read-only grid)**

```tsx
// app/_experiences/demo-library.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DishArt } from "@/app/_components/ui";
import { Icon } from "@/app/_components/icon";
import { DEMO_DISHES } from "@/lib/demo/dishes";
import { readPlan, writePlan } from "@/lib/plan-storage";

const KEY = "demoMealPlan";

export function DemoLibrary() {
  const [planIds, setPlanIds] = useState<Set<number>>(new Set());
  useEffect(() => { setPlanIds(new Set(readPlan(KEY).map((e) => e.id))); }, []);

  const toggle = (id: number, baseServings: number) => {
    const list = readPlan(KEY);
    const inPlan = list.some((e) => e.id === id);
    const next = inPlan ? list.filter((e) => e.id !== id) : [...list, { id, servings: baseServings }];
    writePlan(KEY, next);
    setPlanIds(new Set(next.map((e) => e.id)));
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-28 lg:pb-12">
        <div className="mx-auto flex w-full max-w-6xl flex-col px-5 pt-[var(--safe-top)] lg:px-10">
          <div className="lg:mt-2">
            <div className="mb-[10px] text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Library</div>
            <h1 className="m-0 font-medium leading-[1.04] tracking-[-0.02em] text-text" style={{ fontFamily: "var(--font-serif)", fontSize: "clamp(30px,6vw,42px)" }}>
              The collection
            </h1>
            <div className="mt-2 text-[13.5px] text-text-dim lg:text-[15px]">{DEMO_DISHES.length} dishes</div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-[13px] lg:mt-8 lg:grid-cols-[repeat(auto-fill,minmax(212px,1fr))] lg:gap-[22px]">
            {DEMO_DISHES.map((d) => {
              const inPlan = planIds.has(d.id);
              return (
                <Link
                  key={d.id}
                  href={`/demo/dishes/${d.id}`}
                  className="group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-card)] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-[3px] hover:border-line-2"
                >
                  <div className="relative w-full overflow-hidden" style={{ aspectRatio: "1.2" }}>
                    <DishArt dish={d} fill emojiSize={64} />
                  </div>
                  <div className="flex flex-1 flex-col p-[11px_13px_13px]">
                    <h3 className="line-clamp-2 text-[16.5px] font-semibold leading-[1.16] tracking-[-0.01em] text-text" style={{ fontFamily: "var(--font-serif)", minHeight: "2.32em" }}>
                      {d.title}
                    </h3>
                    {d.subtitle && <div className="mt-[3px] line-clamp-1 text-[12px] italic text-text-dim">{d.subtitle}</div>}
                    <div className="min-h-[11px] flex-1" />
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(d.id, d.baseServings); }}
                      className={[
                        "mt-[11px] flex w-full items-center justify-center gap-[6px] rounded-[var(--radius-sm)] border px-[10px] py-[8px] text-[12.5px] font-semibold transition-colors",
                        inPlan ? "border-accent-line bg-accent-tint text-accent-2" : "border-line-2 bg-transparent text-text-dim hover:border-accent-line hover:bg-accent-tint hover:text-accent-2",
                      ].join(" ")}
                      style={{ fontFamily: "var(--font-sans)" }}
                    >
                      <Icon name={inPlan ? "check" : "plus"} size={14} />{inPlan ? "In plan" : "Add to plan"}
                    </button>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `app/demo/dishes/page.tsx`**

```tsx
// app/demo/dishes/page.tsx
import { notFound } from "next/navigation";
import { DEMO_DISHES } from "@/lib/demo/dishes";
import { DemoLibrary } from "../../_experiences/demo-library";

export default function DemoDishesPage() {
  if (DEMO_DISHES.length === 0) notFound();
  return <DemoLibrary />;
}
```

- [ ] **Step 6: `app/demo/dishes/[id]/page.tsx`**

```tsx
// app/demo/dishes/[id]/page.tsx
import { notFound } from "next/navigation";
import { DEMO_DISHES } from "@/lib/demo/dishes";
import DishView from "@/app/dishes/[id]/dish-view";

export default async function DemoDishPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const dish = DEMO_DISHES.find((d) => String(d.id) === id);
  if (!dish) notFound();
  return (
    <DishView
      dish={dish}
      history={[]}
      isOwner={false}
      ownerHandle={null}
      ownerName={null}
      hrefBase="/demo"
      planConfig={{ storageKey: "demoMealPlan" }}
    />
  );
}
```

- [ ] **Step 7: Typecheck**

Run: `npx next typegen && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add app/demo app/_experiences/demo-library.tsx
git commit -m "feat(demo): /demo routes (spinner, library, plan, dish) — dormant until snapshot"
```

---

### Task 9: Open `/demo` in the proxy

**Files:**
- Modify: `proxy.ts`

- [ ] **Step 1: Add `/demo` to the public-path exemptions**

In `proxy.ts`, extend the first public-path `if` (the block that returns early for `/auth/`, `/api/auth/`, manifest, icons, favicon, offline) with two more conditions:
```ts
    pathname.startsWith("/offline") ||
    pathname === "/demo" ||
    pathname.startsWith("/demo/")
  ) {
    return;
  }
```
No API allowlisting is needed — the demo imports its data statically and calls no `/api/*`.

- [ ] **Step 2: Typecheck**

Run: `npx next typegen && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "feat(demo): allow anonymous access to /demo/* in the proxy"
```

---

### Task 10: Snapshot generator (`scripts/build-demo-snapshot.ts`)

The deferred data step. Selects ~20 real recipes, strips private fields, and writes `lib/demo/dishes.ts`. Cannot run against the DB until the Neon quota resets — so this task delivers the script + a typecheck, not a live run.

**Files:**
- Create: `scripts/build-demo-snapshot.ts`

- [ ] **Step 1: Write the generator**

```ts
// scripts/build-demo-snapshot.ts
// Generates lib/demo/dishes.ts from ~20 of the seed owner's real recipes.
// Run when the DB is reachable:  npx tsx scripts/build-demo-snapshot.ts
// Requires env: DATABASE_URL, SEED_OWNER_EMAIL. Strips notes + imageDescription.
import { writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { rowToDish, type Dish } from "../lib/types.ts";

const LIMIT = 20;

async function main() {
  const url = process.env.DATABASE_URL;
  const owner = (process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!owner) throw new Error("SEED_OWNER_EMAIL is not set");
  const sql = neon(url);

  const rows = await sql`
    SELECT d.*,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
      (SELECT COUNT(*)       FROM cook_log WHERE dish_id = d.id) AS cook_count,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*)           FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
    FROM dishes d
    JOIN users u ON u.id = d.user_id
    WHERE u.email = ${owner}
      AND d.public = true
      AND d.image_url IS NOT NULL
      AND d.recipe IS NOT NULL
      AND jsonb_array_length(d.ingredients) > 0
    ORDER BY (d.favorite)::int DESC,
             COALESCE((SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL), 0) DESC,
             (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id) DESC,
             d.updated_at DESC
  `;

  // Greedy pick for tag variety: prefer dishes that introduce a new tag.
  const seenTags = new Set<string>();
  const picked: Dish[] = [];
  const rest: Dish[] = [];
  for (const r of rows.map(rowToDish)) {
    const fresh = r.tags.some((t) => !seenTags.has(t));
    if (fresh && picked.length < LIMIT) {
      r.tags.forEach((t) => seenTags.add(t));
      picked.push(r);
    } else {
      rest.push(r);
    }
  }
  for (const r of rest) { if (picked.length >= LIMIT) break; picked.push(r); }

  const demo = picked.slice(0, LIMIT).map((d) => ({ ...d, notes: null, imageDescription: null }));
  const tags = [...new Set(demo.flatMap((d) => d.tags))].sort((a, b) => a.localeCompare(b));

  const body =
`// AUTO-GENERATED by scripts/build-demo-snapshot.ts. Do not hand-edit.
// Source: ${demo.length} public recipes from the seed owner; notes + imageDescription stripped.
import type { Dish } from "@/lib/types";

export const DEMO_DISHES: Dish[] = ${JSON.stringify(demo, null, 2)};
export const DEMO_TAGS: string[] = ${JSON.stringify(tags)};
export const DEMO_READY: boolean = DEMO_DISHES.length > 0;
`;
  writeFileSync(new URL("../lib/demo/dishes.ts", import.meta.url), body);
  console.log(`Wrote lib/demo/dishes.ts — ${demo.length} dishes, ${tags.length} tags.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
```

- [ ] **Step 2: Typecheck the script**

Run: `npx tsc --noEmit scripts/build-demo-snapshot.ts` (or rely on the project-wide `npx tsc --noEmit`).
Expected: no errors. (Do NOT run it — the DB is quota-blocked until ~2026-07-01.)

- [ ] **Step 3: Commit**

```bash
git add scripts/build-demo-snapshot.ts
git commit -m "feat(demo): snapshot generator (deferred run; needs DB)"
```

---

### Task 11: Read-only audit + local smoke + final build

Prove the read-only invariants and that the demo works end-to-end with a throwaway fixture (no DB needed). Revert the fixture so the snapshot ships empty.

**Files:** none committed (temporary fixture is reverted).

- [ ] **Step 1: Static read-only audit**

Run:
```bash
grep -rnE "method:\s*[\"'](POST|PUT|PATCH|DELETE)[\"']|/api/" app/_experiences app/demo app/_components/demo-nav.tsx
```
Expected: the ONLY matches are inside `liveExperienceConfig` (which the demo never uses) — i.e. no `/api/*` or mutating method reachable from `app/demo/**`, `demo-library.tsx`, or `demo-nav.tsx`. The plan-experience Todoist `pushTodoist` may match `/api/todoist` but is unreachable when `cfg.readonly` (button replaced by the sign-up link). Confirm by reading each hit.

- [ ] **Step 2: Run the full unit suite**

Run: `npx tsx --test lib/plan-storage.test.ts lib/demo/source.test.ts app/_experiences/config.test.ts`
Expected: all PASS.

- [ ] **Step 3: Temporary fixture for smoke testing**

Edit `lib/demo/dishes.ts` LOCALLY (do not commit) to populate 3 fixture dishes with `imageUrl: null` (emoji art), varied `tags`, real `ingredients`, and a short markdown `recipe` with one `[label](#id)` inline ref. Set `DEMO_TAGS` to their union. This makes `DEMO_READY` true so `/demo` renders.

- [ ] **Step 4: Run the app and drive the demo**

Run: `npm run dev` (needs `DATABASE_URL` present in env so `lib/db.ts` imports — it won't be queried by `/demo`). Then drive with the Playwright MCP browser:
- `/demo` → spin → lands on a result with rationale; "Open recipe" → `/demo/dishes/<id>`.
- On the dish page: change servings (amounts scale), tap a method ingredient link (it highlights), tap "Add to plan".
- `/demo/dishes` grid → toggle "Add to plan" on a card.
- `/demo/plan` → entries show, servings steppers work, the Todoist button is the "Create an account…" sign-up link (NOT a push).
- Confirm via the browser Network panel: no requests to `/api/*` for data or mutations during the whole flow.

Expected: all interactions work; zero `/api/*` calls.

- [ ] **Step 5: Revert the fixture**

```bash
git checkout lib/demo/dishes.ts   # restores the empty snapshot
```
Confirm `lib/demo/dishes.ts` is back to `DEMO_DISHES = []`.

- [ ] **Step 6: Final production build**

Run: `npm run build`
Expected: build succeeds. `/demo` routes compile; they 404 at runtime while the snapshot is empty.

- [ ] **Step 7: Commit (if anything pending) + summary**

```bash
git status   # working tree should be clean (fixture reverted)
```
No commit needed if clean. The feature is complete and dormant; activation is `npx tsx scripts/build-demo-snapshot.ts` once the DB is reachable, then commit + deploy.

---

## Self-Review

**Spec coverage:**
- `/demo` route in-app → Tasks 8, 9. ✅
- Static snapshot, no DB at runtime → Tasks 2, 8 (static import); generator Task 10. ✅
- Reuse via ExperienceConfig → Tasks 3–6. ✅
- Spin + open + scale + ephemeral plan/list → Tasks 4 (spin), 6 (open/scale/highlight + add-to-plan), 5 (plan/list ephemeral), 8 (library). ✅
- Read-only invariants (no mutations, snapshot-only, isolated localStorage) → Tasks 1, 3, 5, 6, 11 (audit). ✅
- Privacy (strip notes/imageDescription) → Task 10. ✅
- Demo chrome (nav + read-only banner + sign-up CTA) → Task 7; Todoist→nudge Task 5. ✅
- Dormant until real data (empty snapshot → 404) → Tasks 2, 8. ✅
- Proxy opens only `/demo/*` pages → Task 9. ✅
- Behavior-preserving live pages → Tasks 4–6 (wrappers + optional props), verified by typecheck + (deferred) runtime. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code or a precise, located edit. Extraction tasks (4, 5) specify "copy verbatim, then these exact edits" rather than re-transcribing ~900 lines, with each seam shown in full. ✅

**Type consistency:** `ExperienceConfig` (Task 3) field names match their uses in Tasks 4–8 (`loadDishes`, `loadTags`, `hrefBase`, `spinnerFiltersKey`, `planStorageKey`, `persistPlanRemote`, `loadPlanRemote`, `readonly`). `PlanEntry`, `readPlan`, `writePlan`, `parsePlan`, `normalizePlanEntry` (Task 1) match uses in Tasks 5, 6, 7, 8. `DEMO_DISHES`/`DEMO_TAGS`/`DEMO_READY` (Task 2) match Tasks 8, 10. `DishView`'s new optional props `hrefBase`/`planConfig:{storageKey}` (Task 6) match the demo dish route (Task 8). ✅
