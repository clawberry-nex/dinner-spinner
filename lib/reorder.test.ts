import { test } from "node:test";
import assert from "node:assert/strict";
import { moveItem } from "./reorder.ts";

test("moveItem moves forward", () => {
  assert.deepEqual(moveItem(["A", "B", "C", "D"], 0, 2), ["B", "C", "A", "D"]);
});

test("moveItem moves backward", () => {
  assert.deepEqual(moveItem(["A", "B", "C", "D"], 3, 1), ["A", "D", "B", "C"]);
});

test("moveItem to the start", () => {
  assert.deepEqual(moveItem(["A", "B", "C", "D"], 2, 0), ["C", "A", "B", "D"]);
});

test("moveItem to the end", () => {
  assert.deepEqual(moveItem(["A", "B", "C", "D"], 1, 3), ["A", "C", "D", "B"]);
});

test("moveItem with same index is a no-op (returns equal contents)", () => {
  const src = ["A", "B", "C"];
  assert.deepEqual(moveItem(src, 1, 1), ["A", "B", "C"]);
});

test("moveItem with out-of-range `from` returns original contents", () => {
  const src = ["A", "B", "C"];
  assert.deepEqual(moveItem(src, 3, 0), ["A", "B", "C"]);
  assert.deepEqual(moveItem(src, 99, 0), ["A", "B", "C"]);
});

test("moveItem with out-of-range `to` returns original contents", () => {
  const src = ["A", "B", "C"];
  assert.deepEqual(moveItem(src, 0, 3), ["A", "B", "C"]);
  assert.deepEqual(moveItem(src, 0, -1), ["A", "B", "C"]);
});

test("moveItem with empty array returns empty array", () => {
  assert.deepEqual(moveItem<string>([], 0, 0), []);
});

test("moveItem rejects negative `from`", () => {
  const src = ["A", "B", "C"];
  assert.deepEqual(moveItem(src, -1, 0), ["A", "B", "C"]);
});

test("moveItem rejects non-integer indices", () => {
  const src = ["A", "B", "C"];
  assert.deepEqual(moveItem(src, 0.5, 1), ["A", "B", "C"]);
  assert.deepEqual(moveItem(src, 0, 1.5), ["A", "B", "C"]);
  assert.deepEqual(moveItem(src, NaN, 0), ["A", "B", "C"]);
});

test("moveItem does not mutate its input", () => {
  const src = ["A", "B", "C", "D"];
  const snapshot = [...src];
  moveItem(src, 0, 3);
  assert.deepEqual(src, snapshot);
});

test("moveItem returns a new array reference (even on no-op)", () => {
  const src = ["A", "B", "C"];
  const result = moveItem(src, 1, 1);
  assert.notStrictEqual(result, src);
});
