# Backup / Restore (Export + Import JSON) Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click disaster-recovery: `/admin` can download a full JSON dump of dishes + pantry defaults + meal plan, and import that same JSON back in, upserting by id.

**Architecture:** A single `/api/backup` route with `GET` (download) and `POST` (import) handlers. A pure `lib/backup.ts` module defines the envelope shape with a zod schema and the assembly/parse helpers — route handlers are thin. Import uses `INSERT … ON CONFLICT (id) DO UPDATE` for dishes, additive insert for pantry names, and replace for the single-row meal plan. Sequence is advanced to `MAX(id)` after import so new inserts don't collide.

**Tech Stack:** Next 16 App Router, TypeScript, zod, `@neondatabase/serverless` (SQL tagged-template), node's built-in test runner.

---

## Design decisions (made autonomously — note in commits)

1. **Route path:** `/api/backup` rather than `GET /api/dishes?format=export`. The roadmap sketch uses the latter, but mixing unrelated response shapes on the same endpoint is worse than a dedicated route. One verb per path.
2. **Export contents:** Full dish rows including `id` (needed for upsert), pantry names (as lowercased strings), and the single meal-plan row's `entries`. Exclude `cook_log` — it's a historical log, not required for DR, and restoring ratings across reset ids would misalign. Document this in the envelope's description.
3. **Envelope version field:** `"version": "1"`. Allows future schema changes.
4. **Import semantics for pantry names:** additive (INSERT ON CONFLICT DO NOTHING). Safer — an import never deletes a user's recent pantry curation.
5. **Import semantics for meal_plan:** replace. The meal plan is a single logical value, not a set.
6. **Import semantics for dishes:** upsert by id, preserving the ids from the backup. After all upserts, bump the `dishes_id_seq` to `MAX(id)` so future inserts don't collide with restored ids.
7. **Authentication:** both the download and import endpoints require either the admin cookie or `Bearer API_TOKEN` — matching the pattern of the other mutation routes.
8. **No transaction wrapper:** `@neondatabase/serverless` over HTTP doesn't support interactive transactions with arbitrary statements; each SQL invocation is independent. For DR, the tradeoff is acceptable — errors abort partway but leave the DB in a consistent-per-row state. If catastrophic, re-run the import (idempotent).

---

## File map

| Path | Action | Responsibility |
|---|---|---|
| `lib/backup.ts` | create | Zod envelope schema, `buildBackup()` assembler, `parseBackup()` validator |
| `lib/backup.test.ts` | create | Unit tests for build/parse |
| `app/api/backup/route.ts` | create | GET (download) + POST (import) handlers |
| `app/admin/page.tsx` | modify | Add "Download backup" and "Import backup" buttons in a new section |

---

### Task 1: Backup envelope module (pure logic + zod schema)

**Files:**
- Create: `lib/backup.ts`
- Test: `lib/backup.test.ts`

- [ ] **Step 1: Write failing tests**

`lib/backup.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BackupEnvelopeSchema,
  buildBackup,
  parseBackup,
  CURRENT_BACKUP_VERSION,
} from "./backup.ts";

const sampleDish = {
  id: 42,
  title: "Curry",
  subtitle: null,
  recipe: null,
  tags: ["vegetarian"],
  ingredients: [{ quantity: 1, name: "onion" }],
  baseServings: 4,
  favorite: false,
  imageUrl: null,
  emoji: null,
  accent: null,
  lastCookedAt: null,
  averageRating: null,
  ratingCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("buildBackup produces an envelope with the current version", () => {
  const env = buildBackup({
    dishes: [sampleDish],
    pantryNames: ["salt", "pepper"],
    mealPlan: { entries: [{ id: 42, servings: 4 }] },
    appVersion: "0.8.0",
    now: new Date("2026-04-20T10:00:00.000Z"),
  });
  assert.equal(env.version, CURRENT_BACKUP_VERSION);
  assert.equal(env.exportedAt, "2026-04-20T10:00:00.000Z");
  assert.equal(env.appVersion, "0.8.0");
  assert.equal(env.dishes.length, 1);
  assert.deepEqual(env.pantryNames, ["salt", "pepper"]);
  assert.deepEqual(env.mealPlan.entries, [{ id: 42, servings: 4 }]);
});

test("buildBackup lowercases pantry names", () => {
  const env = buildBackup({
    dishes: [],
    pantryNames: ["Salt", "  Pepper  ", "OLIVE OIL"],
    mealPlan: { entries: [] },
    appVersion: "0.8.0",
  });
  assert.deepEqual(env.pantryNames, ["salt", "pepper", "olive oil"]);
});

test("parseBackup accepts a valid envelope", () => {
  const env = buildBackup({
    dishes: [sampleDish],
    pantryNames: ["salt"],
    mealPlan: { entries: [] },
    appVersion: "0.8.0",
  });
  const round = parseBackup(JSON.parse(JSON.stringify(env)));
  assert.equal(round.version, CURRENT_BACKUP_VERSION);
  assert.equal(round.dishes.length, 1);
  assert.equal(round.dishes[0].id, 42);
});

test("parseBackup rejects a wrong-version envelope", () => {
  assert.throws(() =>
    parseBackup({
      version: "999",
      exportedAt: "2026-01-01T00:00:00.000Z",
      appVersion: "0.8.0",
      dishes: [],
      pantryNames: [],
      mealPlan: { entries: [] },
    }),
  );
});

test("parseBackup rejects non-integer dish id", () => {
  assert.throws(() =>
    parseBackup({
      version: "1",
      exportedAt: "2026-01-01T00:00:00.000Z",
      appVersion: "0.8.0",
      dishes: [{ ...sampleDish, id: "forty-two" }],
      pantryNames: [],
      mealPlan: { entries: [] },
    }),
  );
});

test("parseBackup rejects a missing required top-level field", () => {
  assert.throws(() =>
    parseBackup({
      version: "1",
      exportedAt: "2026-01-01T00:00:00.000Z",
      appVersion: "0.8.0",
      dishes: [],
      pantryNames: [],
      // mealPlan missing
    }),
  );
});

test("BackupEnvelopeSchema rejects meal plan entries with bad shape", () => {
  const bad = {
    version: "1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    appVersion: "0.8.0",
    dishes: [],
    pantryNames: [],
    mealPlan: { entries: [{ id: -1, servings: 0 }] },
  };
  assert.equal(BackupEnvelopeSchema.safeParse(bad).success, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/backup.test.ts`
Expected: FAIL with "Cannot find module './backup.ts'".

- [ ] **Step 3: Write `lib/backup.ts`**

```ts
import { z } from "zod";

export const CURRENT_BACKUP_VERSION = "1" as const;

const BackupDishSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  subtitle: z.string().nullable(),
  recipe: z.string().nullable(),
  tags: z.array(z.string()),
  ingredients: z.array(z.record(z.string(), z.unknown())),
  baseServings: z.number().int().positive(),
  favorite: z.boolean(),
  imageUrl: z.string().nullable(),
  emoji: z.string().nullable(),
  accent: z.string().nullable(),
  lastCookedAt: z.string().nullable(),
  averageRating: z.number().nullable(),
  ratingCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const MealPlanEntrySchema = z.object({
  id: z.number().int().positive(),
  servings: z.number().int().positive().max(100),
  day: z.number().int().min(0).max(6).nullable().optional(),
});

export const BackupEnvelopeSchema = z.object({
  version: z.literal(CURRENT_BACKUP_VERSION),
  exportedAt: z.string(),
  appVersion: z.string(),
  dishes: z.array(BackupDishSchema),
  pantryNames: z.array(z.string()),
  mealPlan: z.object({
    entries: z.array(MealPlanEntrySchema),
  }),
});

export type BackupEnvelope = z.infer<typeof BackupEnvelopeSchema>;
export type BackupDish = z.infer<typeof BackupDishSchema>;
export type BackupMealPlanEntry = z.infer<typeof MealPlanEntrySchema>;

export type BuildBackupInput = {
  dishes: BackupDish[];
  pantryNames: string[];
  mealPlan: { entries: BackupMealPlanEntry[] };
  appVersion: string;
  now?: Date;
};

export function buildBackup(input: BuildBackupInput): BackupEnvelope {
  const now = input.now ?? new Date();
  return {
    version: CURRENT_BACKUP_VERSION,
    exportedAt: now.toISOString(),
    appVersion: input.appVersion,
    dishes: input.dishes,
    pantryNames: input.pantryNames
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean),
    mealPlan: input.mealPlan,
  };
}

export function parseBackup(raw: unknown): BackupEnvelope {
  return BackupEnvelopeSchema.parse(raw);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/backup.test.ts`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/backup.ts lib/backup.test.ts
git commit -m "Add backup envelope module + zod validation"
```

---

### Task 2: GET `/api/backup` — download full JSON dump

**Files:**
- Create: `app/api/backup/route.ts`

- [ ] **Step 1: Write `app/api/backup/route.ts` (GET only for now)**

```ts
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { rowToDish } from "@/lib/types";
import { buildBackup, parseBackup } from "@/lib/backup";
import pkg from "../../../package.json" with { type: "json" };

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dishRows = await sql`
    SELECT d.*,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
    FROM dishes d
    ORDER BY id ASC
  `;
  const pantryRows = await sql`SELECT name FROM pantry_names ORDER BY name`;
  const mealRows = await sql`SELECT entries FROM meal_plan WHERE id = 1`;

  const envelope = buildBackup({
    dishes: dishRows.map(rowToDish),
    pantryNames: pantryRows.map((r) => r.name as string),
    mealPlan: { entries: (mealRows[0]?.entries as unknown[]) ?? [] } as {
      entries: ReturnType<typeof parseBackup>["mealPlan"]["entries"];
    },
    appVersion: (pkg as { version: string }).version,
  });

  const filename = `dinner-spinner-backup-${envelope.exportedAt.slice(0, 10)}.json`;
  return new Response(JSON.stringify(envelope, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx next typegen && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify it lints clean**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/backup/route.ts
git commit -m "Add GET /api/backup endpoint for JSON dump"
```

---

### Task 3: POST `/api/backup` — import / upsert from JSON

**Files:**
- Modify: `app/api/backup/route.ts`

- [ ] **Step 1: Append POST handler to `app/api/backup/route.ts`**

Add at the bottom of the file (after the GET):

```ts
export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let envelope;
  try {
    envelope = parseBackup(body);
  } catch (err) {
    const issues = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: "Invalid backup envelope", issues },
      { status: 400 },
    );
  }

  // Upsert dishes preserving ids.
  for (const d of envelope.dishes) {
    await sql`
      INSERT INTO dishes (
        id, title, subtitle, recipe, tags, ingredients, base_servings,
        favorite, image_url, emoji, accent, created_at, updated_at
      )
      VALUES (
        ${d.id},
        ${d.title},
        ${d.subtitle},
        ${d.recipe},
        ${d.tags},
        ${JSON.stringify(d.ingredients)}::jsonb,
        ${d.baseServings},
        ${d.favorite},
        ${d.imageUrl},
        ${d.emoji},
        ${d.accent},
        ${d.createdAt},
        ${d.updatedAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        subtitle = EXCLUDED.subtitle,
        recipe = EXCLUDED.recipe,
        tags = EXCLUDED.tags,
        ingredients = EXCLUDED.ingredients,
        base_servings = EXCLUDED.base_servings,
        favorite = EXCLUDED.favorite,
        image_url = EXCLUDED.image_url,
        emoji = EXCLUDED.emoji,
        accent = EXCLUDED.accent,
        updated_at = EXCLUDED.updated_at
    `;
  }

  // Advance the dishes id sequence so future INSERTs don't collide with
  // any restored id. COALESCE + GREATEST guard against an empty dish
  // table or a sequence already ahead of MAX(id).
  await sql`
    SELECT setval(
      pg_get_serial_sequence('dishes', 'id'),
      GREATEST(
        (SELECT COALESCE(MAX(id), 0) FROM dishes),
        (SELECT last_value FROM dishes_id_seq)
      )
    )
  `;

  // Additive pantry defaults upsert.
  for (const name of envelope.pantryNames) {
    const normalized = name.trim().toLowerCase();
    if (!normalized) continue;
    await sql`
      INSERT INTO pantry_names (name) VALUES (${normalized})
      ON CONFLICT (name) DO NOTHING
    `;
  }

  // Replace meal plan.
  await sql`
    UPDATE meal_plan
    SET entries = ${JSON.stringify(envelope.mealPlan.entries)}::jsonb,
        updated_at = now()
    WHERE id = 1
  `;

  return Response.json({
    ok: true,
    counts: {
      dishes: envelope.dishes.length,
      pantryNames: envelope.pantryNames.length,
      mealPlanEntries: envelope.mealPlan.entries.length,
    },
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/backup/route.ts
git commit -m "Add POST /api/backup: upsert dishes by id + additive pantry + replace meal plan"
```

---

### Task 4: Admin UI — download + import buttons

**Files:**
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: Add a Backup section to the admin page**

Insert this new `<section>` in `app/admin/page.tsx` **just before** the closing `</div></div></div>` of the page (after the "Pantry defaults" section). Pattern: follow the same styling as the other admin sections.

State + handlers to add at the top of the `AdminPage` component (after the existing `useState` declarations, before `reload()`):

```tsx
const [backupMsg, setBackupMsg] = useState<string | null>(null);
const [importing, setImporting] = useState(false);

async function downloadBackup() {
  setBackupMsg(null);
  try {
    const res = await fetch("/api/backup");
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setBackupMsg(data.error ?? `HTTP ${res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `dinner-spinner-backup-${today}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setBackupMsg("Downloaded.");
  } catch (err) {
    setBackupMsg(err instanceof Error ? err.message : "Download failed");
  }
}

async function importBackup(file: File) {
  setBackupMsg(null);
  setImporting(true);
  try {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setBackupMsg("Not valid JSON");
      return;
    }
    const envelope = parsed as {
      dishes?: unknown[];
      pantryNames?: unknown[];
      mealPlan?: { entries?: unknown[] };
    };
    const dishCount = Array.isArray(envelope.dishes) ? envelope.dishes.length : 0;
    const pantryCount = Array.isArray(envelope.pantryNames) ? envelope.pantryNames.length : 0;
    const mealCount = Array.isArray(envelope.mealPlan?.entries)
      ? envelope.mealPlan.entries.length
      : 0;
    const ok = confirm(
      `Import ${dishCount} dishes, ${pantryCount} pantry names, ${mealCount} meal-plan entries?\n\n` +
        "Dishes are upserted by id (existing dishes with matching ids are overwritten). " +
        "Pantry names are additive. Meal plan is replaced.",
    );
    if (!ok) return;
    const res = await fetch("/api/backup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      counts?: { dishes: number; pantryNames: number; mealPlanEntries: number };
    };
    if (!res.ok || !data.ok) {
      setBackupMsg(data.error ?? `HTTP ${res.status}`);
      return;
    }
    setBackupMsg(
      `Imported ${data.counts?.dishes ?? 0} dishes, ` +
        `${data.counts?.pantryNames ?? 0} pantry names, ` +
        `${data.counts?.mealPlanEntries ?? 0} meal-plan entries.`,
    );
    reload();
  } finally {
    setImporting(false);
  }
}
```

Section markup (insert just before the final closing `</div></div></div>` in the JSX, after the pantry-defaults `</section>`):

```tsx
<section>
  <h2 className="mb-3 text-xl font-semibold">Backup</h2>
  <p className="mb-3 text-xs text-zinc-500">
    Download a JSON snapshot of all dishes, pantry defaults, and meal plan.
    Import the same file to restore. Dishes upsert by id; pantry names are
    additive; meal plan is replaced.
  </p>
  <div className="flex flex-wrap items-center gap-3">
    <button
      type="button"
      onClick={downloadBackup}
      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
    >
      Download backup
    </button>
    <label className="rounded-md border border-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950 cursor-pointer">
      {importing ? "Importing…" : "Import backup"}
      <input
        type="file"
        accept="application/json,.json"
        className="hidden"
        disabled={importing}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importBackup(file);
          e.target.value = "";
        }}
      />
    </label>
    {backupMsg && <span className="text-sm">{backupMsg}</span>}
  </div>
</section>
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Build to confirm Next.js can bundle it**

Run: `npm run build`
Expected: build completes successfully.

- [ ] **Step 5: Commit**

```bash
git add app/admin/page.tsx
git commit -m "Add Backup section to admin: download + import JSON"
```

---

### Task 5: Merge + release

- [ ] **Step 1: Merge feature branch into main (no-ff)**

Run: `git checkout main && git merge --no-ff feature/backup-import-export -m "Merge backup import/export (v0.8.0)"`

- [ ] **Step 2: Bump version in `package.json`**

Edit `package.json` version from `"0.7.0"` to `"0.8.0"`.

- [ ] **Step 3: Mark the roadmap item as shipped**

Edit `ROADMAP.md`: find the "Export / import JSON backup (one-click DR)" item and either strikethrough the heading or add a "✅ Shipped in v0.8.0" note matching the style used for other shipped items.

- [ ] **Step 4: Build to confirm**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit the bump**

```bash
git add package.json ROADMAP.md
git commit -m "Bump to v0.8.0"
```

- [ ] **Step 6: Mark roadmap item shipped via the Nex dashboard API**

Run:

```bash
curl -sS -X PATCH http://127.0.0.1:4567/api/roadmap/YgOXZ5bVsDG2 \
  -H 'content-type: application/json' \
  -d '{"status":"shipped","version":"0.8.0"}'
```

Expected: 200 OK with updated item.

---

## Self-review

- [x] Spec coverage: GET export, POST import upsert-by-id, admin button — all present.
- [x] No placeholders.
- [x] Types consistent: `BackupEnvelope`, `BackupDish`, `BackupMealPlanEntry` used throughout.
- [x] Bite-sized tasks, TDD for the pure module, clear verification commands per task.
