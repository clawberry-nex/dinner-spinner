# Drag-to-reorder ingredients in admin — implementation plan

**Goal.** Make ingredient order editable in `/admin`. Today the only way to
"insert in the middle" is to delete and retype. Add a `⋮⋮` grip handle that
drags rows to reorder, plus move-up / move-down buttons as a
keyboard-accessible alternative.

Roadmap: `UEfW3khjcTv2` — "Drag-to-reorder ingredients in admin".

## Design decisions (made autonomously)

1. **Pure core.** Put the reorder math in `lib/reorder.ts` as a
   `moveItem(arr, from, to)` helper with node-test unit tests. The admin
   page then just wires UI events to this helper. Tiny, but worth the
   separation because reorder edge cases (out-of-range indices, from==to,
   adjacent moves) are easier to cover off-UI.
2. **No library.** Native HTML5 DnD, per the roadmap sketch. The entire
   row is the drop target. The whole row is also what drags — but
   `draggable` is toggled on only while the pointer is on the grip
   handle (via `onPointerDown`/`onPointerUp`), so clicking into an
   input inside the row never accidentally starts a drag.
3. **Drag affordance.** A `⋮⋮` grip button on the left of each row,
   `cursor-grab` / `cursor-grabbing`, `aria-label="drag to reorder"`.
   Visual drop indicator: a 2-px emerald top border on whichever row
   the pointer is over (except the source row).
4. **Keyboard / mobile alternative.** Two small `↑` / `↓` buttons next
   to the `×` remove button. They call the same `moveItem` helper.
   Disabled on the boundary rows.
5. **No persistence concerns.** Order is just `draft.ingredients` array
   order. Saving is unchanged — payload already carries the array in
   order.

## File map

| Path | Action | Responsibility |
|---|---|---|
| `lib/reorder.ts` | create | Pure `moveItem(arr, from, to)` that returns a new array with one element moved. Input validation (out-of-range → original array unchanged). |
| `lib/reorder.test.ts` | create | Unit tests: move forward, backward, to start, to end, no-op (same index), invalid indices, empty array. |
| `app/admin/page.tsx` | modify | Add drag state, grip handle, up/down buttons, drop-target highlighting. Wire reorder via `moveItem`. |

## Tasks

### Task 1: `lib/reorder.ts` + tests (TDD)

- [ ] Write `lib/reorder.test.ts` covering:
  - Move forward: `[A,B,C,D]` from=0, to=2 → `[B,C,A,D]`
  - Move backward: `[A,B,C,D]` from=3, to=1 → `[A,D,B,C]`
  - Same index is a no-op
  - Out-of-range `from` returns original (shallow-equal OK to copy)
  - Out-of-range `to` returns original
  - Empty array is a no-op
  - Negative indices return original
  - Non-integer indices return original
  - Function does not mutate its input
- [ ] Run tests — expect failures.
- [ ] Implement `lib/reorder.ts::moveItem<T>(arr, from, to)`.
- [ ] Run tests — expect pass.

### Task 2: Admin drag-and-drop + keyboard reorder

- [ ] Add state in `AdminPage`:
  - `dragIndex: number | null` — source row while a drag is in flight.
  - `dropTargetIndex: number | null` — row the pointer is over.
  - `handleArmedIndex: number | null` — row whose handle is currently
    pressed; enables `draggable` on that row only.
- [ ] Wrap `reorderIngredient(from, to)` that calls `moveItem` and
  updates `draft.ingredients`.
- [ ] On each ingredient row `<div>`:
  - `draggable={handleArmedIndex === i}`.
  - `onDragStart` → set `dragIndex`, `effectAllowed = "move"`.
  - `onDragOver` → `preventDefault()`, set `dropTargetIndex`.
  - `onDragLeave` → clear `dropTargetIndex` if it matches.
  - `onDrop` → `preventDefault()`; if `dragIndex != null && dragIndex !== i`, call `reorderIngredient(dragIndex, i)`. Reset state.
  - `onDragEnd` → always reset state (covers cancelled drags).
  - Conditional top border style when `dropTargetIndex === i && dragIndex !== i`.
- [ ] Add grip handle button inside the row:
  - Text `⋮⋮`, `aria-label="drag to reorder"`, `cursor-grab active:cursor-grabbing`.
  - `onPointerDown` → `setHandleArmedIndex(i)`.
  - `onPointerUp` / `onPointerCancel` → `setHandleArmedIndex(null)`.
- [ ] Add up/down buttons next to remove:
  - `↑` disabled on `i === 0`, calls `reorderIngredient(i, i-1)`.
  - `↓` disabled on last index, calls `reorderIngredient(i, i+1)`.
  - `aria-label="move up"` / `"move down"`.

### Task 3: Manual smoke test

- [ ] `npm run build` — TypeScript + Next compile clean.
- [ ] Node test runner green: `node --test --experimental-strip-types lib/reorder.test.ts lib/week-plan.test.ts` (sanity that nothing else regressed).

### Task 4: Ship

- [ ] Commit on `feat/drag-reorder-ingredients`.
- [ ] Merge to `main` (no-ff, matching prior shipping cadence).
- [ ] Bump `package.json` → `0.10.0`, commit.
- [ ] Update `ROADMAP.md`: strike through the item and add a shipped note.
- [ ] Mark roadmap card shipped via `PATCH /api/roadmap/UEfW3khjcTv2` on Nex.
