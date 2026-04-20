import { test } from "node:test";
import assert from "node:assert/strict";
import { dishWeight, pickWeighted } from "./spinner.ts";

type WeightInput = Parameters<typeof dishWeight>[0];

const base: WeightInput = {
  favorite: false,
  lastCookedAt: null,
  averageRating: null,
};

test("baseline weight is 1", () => {
  assert.equal(dishWeight(base), 1);
});

test("favorite with no rating doubles the weight", () => {
  assert.equal(dishWeight({ ...base, favorite: true }), 2);
});

test("rating of 5 beats a favorite-only dish", () => {
  const rated = dishWeight({ ...base, averageRating: 5 });
  const favored = dishWeight({ ...base, favorite: true });
  assert.ok(rated > favored, `expected rating=5 (${rated}) > favorite (${favored})`);
});

test("rating of 3 is neutral (1.0)", () => {
  assert.equal(dishWeight({ ...base, averageRating: 3 }), 1);
});

test("rating below 3 penalises the dish", () => {
  assert.ok(dishWeight({ ...base, averageRating: 2 }) < 1);
  assert.ok(dishWeight({ ...base, averageRating: 1 }) < dishWeight({ ...base, averageRating: 2 }));
});

test("rating overrides the favorite flag", () => {
  // If a dish has a concrete rating, favorite is no longer the signal
  // ("favourites become anything ≥ 4").
  const lowRatedFavorite = dishWeight({ ...base, favorite: true, averageRating: 1 });
  const plainFavorite = dishWeight({ ...base, favorite: true });
  assert.ok(lowRatedFavorite < plainFavorite);
});

test("recently cooked dish is down-weighted", () => {
  const today = new Date().toISOString();
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  assert.ok(
    dishWeight({ ...base, lastCookedAt: today }) <
      dishWeight({ ...base, lastCookedAt: twoWeeksAgo }),
  );
});

test("cooked 14+ days ago gets full recency credit", () => {
  const three_weeks = new Date(Date.now() - 21 * 86400000).toISOString();
  assert.equal(dishWeight({ ...base, lastCookedAt: three_weeks }), 1);
});

test("minimum weight floor of 0.05", () => {
  const today = new Date().toISOString();
  const w = dishWeight({
    favorite: false,
    lastCookedAt: today,
    averageRating: 1,
  });
  assert.ok(w >= 0.05);
});

test("pickWeighted returns a dish from the pool", () => {
  const pool: WeightInput[] = [
    { favorite: false, lastCookedAt: null, averageRating: null },
    { favorite: true, lastCookedAt: null, averageRating: 5 },
  ];
  const picked = pickWeighted(pool, () => 0.99);
  assert.ok(pool.includes(picked));
});

test("pickWeighted biases toward higher-weighted dishes", () => {
  const pool: WeightInput[] = [
    { favorite: false, lastCookedAt: null, averageRating: 1 }, // low weight
    { favorite: false, lastCookedAt: null, averageRating: 5 }, // high weight
  ];
  let highRatedWins = 0;
  const N = 2000;
  let seed = 1;
  const rand = () => {
    // Simple deterministic PRNG so the test is stable.
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < N; i++) {
    const picked = pickWeighted(pool, rand);
    if (picked === pool[1]) highRatedWins++;
  }
  assert.ok(
    highRatedWins > N * 0.7,
    `expected high-rated dish to win >70% (got ${highRatedWins}/${N})`,
  );
});

test("pickWeighted handles a single-dish pool", () => {
  const pool: WeightInput[] = [{ favorite: false, lastCookedAt: null, averageRating: null }];
  assert.equal(pickWeighted(pool, () => 0.5), pool[0]);
});
