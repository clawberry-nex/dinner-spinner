import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_LABELS,
  DAY_LABELS_LONG,
  entryDay,
  groupByDay,
  isValidDay,
  moveEntry,
  resetWeek,
} from "./week-plan.ts";

test("DAY_LABELS has Monday-first seven entries", () => {
  assert.deepEqual(DAY_LABELS, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.equal(DAY_LABELS_LONG.length, 7);
  assert.equal(DAY_LABELS_LONG[0], "Monday");
  assert.equal(DAY_LABELS_LONG[6], "Sunday");
});

test("isValidDay accepts 0..6 integers", () => {
  for (let i = 0; i <= 6; i++) assert.ok(isValidDay(i));
});

test("isValidDay rejects -1, 7, non-integers, NaN", () => {
  assert.equal(isValidDay(-1), false);
  assert.equal(isValidDay(7), false);
  assert.equal(isValidDay(3.5), false);
  assert.equal(isValidDay(NaN), false);
  assert.equal(isValidDay("2" as unknown as number), false);
});

test("entryDay returns null for missing / null / invalid day", () => {
  assert.equal(entryDay({ id: 1, servings: 2 }), null);
  assert.equal(entryDay({ id: 1, servings: 2, day: null }), null);
  assert.equal(entryDay({ id: 1, servings: 2, day: undefined }), null);
  assert.equal(entryDay({ id: 1, servings: 2, day: 9 as unknown as number }), null);
  assert.equal(entryDay({ id: 1, servings: 2, day: -1 as unknown as number }), null);
});

test("entryDay returns the day for valid 0..6", () => {
  assert.equal(entryDay({ id: 1, servings: 2, day: 0 }), 0);
  assert.equal(entryDay({ id: 1, servings: 2, day: 6 }), 6);
});

test("moveEntry assigns day to matching entry, leaves others untouched", () => {
  const before = [
    { id: 1, servings: 2 },
    { id: 2, servings: 4, day: 3 },
  ];
  const after = moveEntry(before, 1, 5);
  assert.deepEqual(after[0], { id: 1, servings: 2, day: 5 });
  assert.deepEqual(after[1], { id: 2, servings: 4, day: 3 });
});

test("moveEntry with null clears day on the matching entry", () => {
  const before = [{ id: 1, servings: 2, day: 4 }];
  const after = moveEntry(before, 1, null);
  assert.equal("day" in after[0], false, "day should be stripped, not set to null");
  assert.equal(after[0].id, 1);
  assert.equal(after[0].servings, 2);
});

test("moveEntry with invalid day is a no-op on the target entry", () => {
  const before = [{ id: 1, servings: 2, day: 3 }];
  const after = moveEntry(before, 1, 9 as unknown as number);
  assert.deepEqual(after, before);
});

test("moveEntry returns the same array structure if dish id not present", () => {
  const before = [{ id: 1, servings: 2 }];
  const after = moveEntry(before, 99, 2);
  assert.deepEqual(after, before);
});

test("moveEntry does not mutate the input array or entries", () => {
  const before = [{ id: 1, servings: 2, day: 1 }];
  const snapshot = JSON.parse(JSON.stringify(before));
  moveEntry(before, 1, 2);
  assert.deepEqual(before, snapshot);
});

test("resetWeek strips day from every entry", () => {
  const before = [
    { id: 1, servings: 2, day: 0 },
    { id: 2, servings: 3, day: 6 },
    { id: 3, servings: 4 },
  ];
  const after = resetWeek(before);
  for (const e of after) {
    assert.equal("day" in e, false);
  }
  assert.equal(after.length, 3);
  assert.equal(after[0].servings, 2);
  assert.equal(after[1].servings, 3);
});

test("resetWeek does not mutate input", () => {
  const before = [{ id: 1, servings: 2, day: 2 }];
  const snapshot = JSON.parse(JSON.stringify(before));
  resetWeek(before);
  assert.deepEqual(before, snapshot);
});

test("groupByDay buckets unassigned into pool, preserving order", () => {
  const entries = [
    { id: 1, servings: 2 },
    { id: 2, servings: 3, day: 0 },
    { id: 3, servings: 4 },
  ];
  const g = groupByDay(entries);
  assert.equal(g.pool.length, 2);
  assert.equal(g.pool[0].id, 1);
  assert.equal(g.pool[1].id, 3);
});

test("groupByDay buckets assigned entries into the right day", () => {
  const entries = [
    { id: 1, servings: 2, day: 0 },
    { id: 2, servings: 2, day: 6 },
    { id: 3, servings: 2, day: 0 },
    { id: 4, servings: 2 },
  ];
  const g = groupByDay(entries);
  assert.equal(g.days.length, 7);
  assert.equal(g.days[0].length, 2, "Monday has two dishes");
  assert.deepEqual(
    g.days[0].map((e) => e.id),
    [1, 3],
  );
  assert.equal(g.days[6].length, 1, "Sunday has one dish");
  assert.equal(g.days[6][0].id, 2);
  assert.equal(g.days[1].length, 0, "Tuesday is empty");
  assert.equal(g.pool.length, 1);
  assert.equal(g.pool[0].id, 4);
});

test("groupByDay treats invalid day values as pool", () => {
  const entries = [
    { id: 1, servings: 2, day: 9 as unknown as number },
    { id: 2, servings: 2, day: -1 as unknown as number },
    { id: 3, servings: 2, day: null },
  ];
  const g = groupByDay(entries);
  assert.equal(g.pool.length, 3);
  for (let i = 0; i < 7; i++) assert.equal(g.days[i].length, 0);
});
