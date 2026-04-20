import { test } from "node:test";
import assert from "node:assert/strict";

function installLocalStorageShim() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  return store;
}

const store = installLocalStorageShim();

const { readLastServings, writeLastServings, clearLastServings } = await import(
  "./last-servings.ts"
);

test("readLastServings returns null when nothing is stored", () => {
  store.clear();
  assert.equal(readLastServings(1), null);
});

test("writeLastServings then readLastServings round-trips per dish", () => {
  store.clear();
  writeLastServings(1, 2);
  writeLastServings(2, 6);
  assert.equal(readLastServings(1), 2);
  assert.equal(readLastServings(2), 6);
  assert.equal(readLastServings(3), null);
});

test("writeLastServings overwrites a previous entry for the same dish", () => {
  store.clear();
  writeLastServings(7, 2);
  writeLastServings(7, 5);
  assert.equal(readLastServings(7), 5);
});

test("clearLastServings removes only the given dish entry", () => {
  store.clear();
  writeLastServings(1, 3);
  writeLastServings(2, 4);
  clearLastServings(1);
  assert.equal(readLastServings(1), null);
  assert.equal(readLastServings(2), 4);
});

test("readLastServings returns null for non-integer or sub-1 stored values", () => {
  store.clear();
  // Directly poke malformed data into the store.
  store.set("lastServings", JSON.stringify({ 1: 0, 2: -3, 3: 2.5, 4: "six", 5: null }));
  assert.equal(readLastServings(1), null);
  assert.equal(readLastServings(2), null);
  assert.equal(readLastServings(3), null);
  assert.equal(readLastServings(4), null);
  assert.equal(readLastServings(5), null);
});

test("readLastServings tolerates corrupt JSON and returns null", () => {
  store.clear();
  store.set("lastServings", "not json");
  assert.equal(readLastServings(1), null);
});

test("readLastServings tolerates a non-object top-level value", () => {
  store.clear();
  store.set("lastServings", JSON.stringify([1, 2, 3]));
  assert.equal(readLastServings(1), null);
});

test("writeLastServings refuses invalid servings without corrupting existing data", () => {
  store.clear();
  writeLastServings(1, 4);
  writeLastServings(1, 0);
  writeLastServings(1, -1);
  writeLastServings(1, 2.5);
  assert.equal(readLastServings(1), 4);
});
