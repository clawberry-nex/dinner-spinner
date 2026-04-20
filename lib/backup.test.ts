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

test("buildBackup lowercases and trims pantry names, drops empties", () => {
  const env = buildBackup({
    dishes: [],
    pantryNames: ["Salt", "  Pepper  ", "OLIVE OIL", "", "   "],
    mealPlan: { entries: [] },
    appVersion: "0.8.0",
  });
  assert.deepEqual(env.pantryNames, ["salt", "pepper", "olive oil"]);
});

test("parseBackup accepts a round-tripped envelope", () => {
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

test("parseBackup round-trips the notes field", () => {
  const withNotes = {
    ...sampleDish,
    notes: "Finn won't eat this if there are mushrooms",
  };
  const env = buildBackup({
    dishes: [withNotes],
    pantryNames: [],
    mealPlan: { entries: [] },
    appVersion: "0.11.0",
  });
  const round = parseBackup(JSON.parse(JSON.stringify(env)));
  assert.equal(round.dishes[0].notes, "Finn won't eat this if there are mushrooms");
});

test("parseBackup accepts envelopes missing the notes field (back-compat)", () => {
  // Simulate a backup exported by a pre-notes version.
  const legacy = {
    version: "1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    appVersion: "0.10.0",
    dishes: [sampleDish],
    pantryNames: [],
    mealPlan: { entries: [] },
  };
  const parsed = parseBackup(legacy);
  assert.equal(parsed.dishes.length, 1);
  // An absent field should parse as undefined (or null); not throw.
  assert.ok(parsed.dishes[0].notes == null);
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
