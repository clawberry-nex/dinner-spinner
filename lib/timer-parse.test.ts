import { test } from "node:test";
import assert from "node:assert/strict";
import { findTimers } from "./timer-parse.ts";

test("matches '15 min'", () => {
  const m = findTimers("Simmer for 15 min, stirring");
  assert.equal(m.length, 1);
  assert.equal(m[0].label, "15 min");
  assert.equal(m[0].seconds, 15 * 60);
  assert.equal(m[0].start, 11);
  assert.equal(m[0].end, 17);
});

test("matches 'minutes' plural", () => {
  const m = findTimers("Bake for 30 minutes.");
  assert.equal(m.length, 1);
  assert.equal(m[0].label, "30 minutes");
  assert.equal(m[0].seconds, 30 * 60);
});

test("matches 'mins' abbreviation", () => {
  const m = findTimers("Rest 5 mins.");
  assert.equal(m.length, 1);
  assert.equal(m[0].seconds, 5 * 60);
});

test("matches 'minute' singular", () => {
  const m = findTimers("Wait 1 minute.");
  assert.equal(m.length, 1);
  assert.equal(m[0].seconds, 60);
});

test("matches hours", () => {
  const m = findTimers("Roast for 2 hours.");
  assert.equal(m.length, 1);
  assert.equal(m[0].seconds, 2 * 3600);
});

test("matches singular 'hour'", () => {
  const m = findTimers("Bake 1 hour.");
  assert.equal(m.length, 1);
  assert.equal(m[0].seconds, 3600);
});

test("matches 'hrs' / 'hr'", () => {
  const m = findTimers("Slow cook 3 hrs. Rest 1 hr.");
  assert.equal(m.length, 2);
  assert.equal(m[0].seconds, 3 * 3600);
  assert.equal(m[1].seconds, 3600);
});

test("matches decimal hours", () => {
  const m = findTimers("Braise for 1.5 hours.");
  assert.equal(m.length, 1);
  assert.equal(m[0].seconds, 1.5 * 3600);
});

test("matches 'h' suffix", () => {
  const m = findTimers("Cook 2h, then rest.");
  assert.equal(m.length, 1);
  assert.equal(m[0].seconds, 2 * 3600);
});

test("matches no space: '30min'", () => {
  const m = findTimers("Preheat 30min beforehand.");
  assert.equal(m.length, 1);
  assert.equal(m[0].seconds, 30 * 60);
});

test("matches multiple in one string", () => {
  const m = findTimers("Simmer 10 min, then bake 25 minutes.");
  assert.equal(m.length, 2);
  assert.equal(m[0].seconds, 600);
  assert.equal(m[1].seconds, 1500);
});

test("case-insensitive", () => {
  const m = findTimers("Wait 15 MIN or 2 Hours.");
  assert.equal(m.length, 2);
  assert.equal(m[0].seconds, 15 * 60);
  assert.equal(m[1].seconds, 2 * 3600);
});

test("ignores numbers without a time unit", () => {
  const m = findTimers("Add 450 g flour and 2 eggs.");
  assert.equal(m.length, 0);
});

test("does not match 'mg' or 'ml'", () => {
  const m = findTimers("Add 5 mg salt and 250 ml water.");
  assert.equal(m.length, 0);
});

test("does not match bare numbers followed by unrelated words", () => {
  const m = findTimers("Use 3 tomatoes and 4 cloves garlic.");
  assert.equal(m.length, 0);
});

test("does not match inside longer words (word boundary)", () => {
  // "15 mint" should not match "15 min" — boundary after unit.
  const m = findTimers("Add 15 mint leaves.");
  assert.equal(m.length, 0);
});

test("returns start/end spanning the whole match including unit", () => {
  const text = "Wait 10 minutes here.";
  const m = findTimers(text);
  assert.equal(m.length, 1);
  assert.equal(text.slice(m[0].start, m[0].end), "10 minutes");
});

test("returns matches sorted by start index", () => {
  const m = findTimers("Bake 2 hours, rest 10 min, finish 5 min.");
  assert.deepEqual(
    m.map((x) => x.start),
    [...m.map((x) => x.start)].sort((a, b) => a - b),
  );
});

test("decimal minutes handled sensibly", () => {
  // "0.5 minutes" -> 30 seconds. Not a common recipe phrase but must not crash.
  const m = findTimers("Blitz 0.5 minutes.");
  assert.equal(m.length, 1);
  assert.equal(m[0].seconds, 30);
});
