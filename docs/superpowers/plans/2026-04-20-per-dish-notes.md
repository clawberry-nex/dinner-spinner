# Per-dish persistent notes — implementation plan

**Goal.** Add a `notes` field to dishes for persistent meta-notes like
"Finn won't eat this if there are mushrooms" or "Usually 1.5× the
chili". Rendered as a yellow sticky-note-style box above the
ingredient section on the dish detail page, hidden when empty.
Separate from the recipe markdown body and from cook-log notes (which
are timestamped per-cook entries).

Roadmap: `eewk3m2LAj6n` — "Per-dish persistent notes field".

## Design decisions (made autonomously)

1. **Schema.** `notes text` column on `dishes` (nullable). No length
   constraint at the DB level — Zod enforces a cap (5_000 chars, same
   order of magnitude as other text fields; generous enough for a
   scratch pad, stops pathological bodies).
2. **Naming collision.** The word "notes" is already used on a
   per-cook basis (`cook_log.note` singular). On the Dish type the
   field lives as `notes` (plural) to visually distinguish from
   `note` on `CookLogEntry`. DB column is `notes` (matches Dish
   property).
3. **Empty string = null.** Admin form sends trimmed input; empty
   string is normalized to `null` on write (same pattern as
   `subtitle`, `recipe`). That way the sticky-note box's "hidden when
   empty" rule is a simple `dish.notes &&` truth check.
4. **Render position + style.** Sticky-note sits between the
   servings/action card and the `Ingredients` section on dish
   detail. Warm-yellow tone keyed off Tailwind's `amber-*` palette
   scoped via plain classes so it works in both light and dark mode.
   Plain whitespace-pre-wrap paragraph; no markdown — this is
   scratch text, not formatted prose.
5. **Admin form placement.** Notes textarea sits between the recipe
   markdown textarea and the submit row. Smaller (3 rows) to signal
   it's a short scratch pad.
6. **Backup round-trip.** Extend `BackupDishSchema` with a nullable
   `notes` field. For back-compat with older backup files, make it
   `.nullable().optional()` at the zod layer and default to `null`
   in the insert. Export includes the field; import accepts
   envelopes with or without it.
7. **No migration framework.** Follow the existing convention: add
   `ALTER TABLE … ADD COLUMN IF NOT EXISTS notes text` to
   `db/schema.sql` so re-running `psql -f db/schema.sql` picks it
   up on existing installs. Also keep it in the main `CREATE TABLE`
   block so fresh installs get it in the table definition.
8. **No client-side editing on dish detail.** Notes are admin-only.
   Dish detail is read-only. Keeps the feature small.
9. **Not shown on cook mode.** Cook mode is the "do the thing"
   view; the yellow sticky is for planning/meta info. Out of scope.

## File map

| Path | Action | Responsibility |
|---|---|---|
| `db/schema.sql` | modify | Add `notes text` to `dishes` CREATE block + `ALTER TABLE … ADD COLUMN IF NOT EXISTS notes text`. |
| `db/migrations/0002_notes.sql` | create | Standalone migration mirror of the ALTER for archival purposes. |
| `lib/types.ts` | modify | Add `notes` to `DishInputSchema`, `Dish` type, `rowToDish`. |
| `lib/backup.ts` | modify | Add optional `notes` to `BackupDishSchema`. |
| `lib/backup.test.ts` | modify | Extend sample dish + add a test that `notes` round-trips; also verify that an envelope missing `notes` is still accepted (back-compat). |
| `app/api/dishes/route.ts` | modify | Include `notes` in INSERT + RETURNING. |
| `app/api/dishes/[id]/route.ts` | modify | Include `notes` in PATCH SET clause. |
| `app/api/backup/route.ts` | modify | Include `notes` in the upsert INSERT + ON CONFLICT DO UPDATE. |
| `app/admin/page.tsx` | modify | Add `notes` to `Draft`/`EMPTY_DRAFT`/`dishToDraft`/`draftToPayload`; render a textarea between recipe and submit row. |
| `app/dishes/[id]/dish-view.tsx` | modify | Render yellow sticky-note box between the servings card and the Ingredients section when `dish.notes` is truthy. |
| `ROADMAP.md` | modify | Strike through the roadmap item with a shipped note referencing the version. |
| `package.json` | modify | Bump version. |

## Tasks

### Task 1: Schema + backup module (TDD-first for the backup module)

- [ ] Extend `lib/backup.test.ts` with:
  - A sample dish that includes `notes: "Leftover note"`; verify
    `buildBackup` preserves it and `parseBackup` round-trips.
  - A sample dish *without* `notes` at all (old-format envelope);
    verify `parseBackup` still accepts it (back-compat).
- [ ] Run tests — expect failures.
- [ ] Add `notes: z.string().nullable().optional()` to
  `BackupDishSchema` in `lib/backup.ts`.
- [ ] Run tests — expect pass.
- [ ] Add `notes` to `Dish` type, `DishInputSchema` (max 5000 chars,
  nullable/optional), and `rowToDish` in `lib/types.ts`.
- [ ] Update `db/schema.sql` (CREATE block + ALTER TABLE ADD COLUMN
  IF NOT EXISTS). Add standalone `db/migrations/0002_notes.sql`.
- [ ] Apply the schema to Neon: `psql "$DATABASE_URL" -f db/schema.sql`.

### Task 2: API plumbing

- [ ] `POST /api/dishes` → include `notes` in INSERT columns + values.
- [ ] `PATCH /api/dishes/[id]` → include `notes` in SET clause.
- [ ] `POST /api/backup` upsert → include `notes` in INSERT columns +
  `ON CONFLICT DO UPDATE SET notes = EXCLUDED.notes`.

### Task 3: Admin form

- [ ] Extend `Draft` / `EMPTY_DRAFT` with `notes: ""`.
- [ ] `dishToDraft` pulls `d.notes ?? ""`.
- [ ] `draftToPayload` emits `notes: d.notes.trim() || null`.
- [ ] Add a textarea labelled "Notes (persistent scratch pad)" with a
  helper hint, placed between the recipe textarea and the submit row.
  3 rows, smaller font-mono off (plain sans), same border style.

### Task 4: Dish detail render

- [ ] When `dish.notes` is truthy, render a yellow-tinted box in the
  main scroll column between the `<div className="mx-4 mb-4
  rounded-lg border border-rule bg-paper p-4">` servings card and the
  `<div className="px-5 pb-2">` Ingredients wrapper.
- [ ] Style: `mx-4 mb-4 rounded-lg border border-amber-300 bg-amber-50
  p-4 text-[14px] leading-snug text-ink`. Dark-mode compatible via
  palette (`dark:border-amber-700/60 dark:bg-amber-950/40`).
- [ ] Small uppercase label "Notes" on top, matching the existing
  "Serves" eyebrow style for visual consistency.
- [ ] Content is `whitespace-pre-wrap` so newlines render.

### Task 5: Verify + ship

- [ ] `node --test --experimental-strip-types lib/backup.test.ts` — green.
- [ ] `npm run build` — TypeScript + Next compile clean.
- [ ] Commit task-by-task on `feat/per-dish-notes`.
- [ ] Merge to `main` (no-ff, matching prior cadence).
- [ ] Bump `package.json` to `0.11.0`, commit, push.
- [ ] Update `ROADMAP.md` to mark shipped.
- [ ] Mark roadmap card shipped via `PATCH /api/roadmap/eewk3m2LAj6n`
  on Nex.
