import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dishWeight,
  dishWeightFactors,
  formatMultiplier,
  pickWeighted,
  pickWithRationale,
} from "./spinner.ts";

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

// ---- Rationale / factor breakdown ------------------------------------------

const refNow = new Date("2026-04-20T12:00:00Z").getTime();
const daysAgo = (d: number) => new Date(refNow - d * 86400000).toISOString();

test("dishWeightFactors weight matches dishWeight", () => {
  const samples: WeightInput[] = [
    base,
    { ...base, favorite: true },
    { ...base, averageRating: 4.2 },
    { ...base, lastCookedAt: daysAgo(3) },
    { ...base, averageRating: 5, lastCookedAt: daysAgo(7) },
  ];
  for (const s of samples) {
    const fromDirect = dishWeight(s, refNow);
    const fromFactors = dishWeightFactors(s, refNow).weight;
    assert.ok(
      Math.abs(fromDirect - fromFactors) < 1e-9,
      `mismatch: ${fromDirect} vs ${fromFactors}`,
    );
  }
});

test("dishWeightFactors: baseline dish has no factors", () => {
  const { factors } = dishWeightFactors(base, refNow);
  assert.deepEqual(factors, []);
});

test("dishWeightFactors: favourite adds a 2× factor", () => {
  const { factors } = dishWeightFactors({ ...base, favorite: true }, refNow);
  assert.equal(factors.length, 1);
  assert.equal(factors[0].label, "favourite");
  assert.equal(factors[0].multiplier, 2);
});

test("dishWeightFactors: rating emits a rating factor and hides favourite", () => {
  const { factors } = dishWeightFactors(
    { favorite: true, lastCookedAt: null, averageRating: 5 },
    refNow,
  );
  assert.equal(factors.length, 1);
  assert.match(factors[0].label, /rated 5\.0★/);
});

test("dishWeightFactors: neutral rating (3) emits no factor", () => {
  const { factors } = dishWeightFactors(
    { ...base, averageRating: 3 },
    refNow,
  );
  assert.deepEqual(factors, []);
});

test("dishWeightFactors: never-cooked has no recency factor", () => {
  const { factors } = dishWeightFactors(
    { ...base, favorite: true },
    refNow,
  );
  assert.ok(!factors.some((f) => /cooked/.test(f.label)));
});

test("dishWeightFactors: cooked today / yesterday / 3 days / 1 week / 2 weeks labels", () => {
  const cases: Array<[number, RegExp]> = [
    [0, /^cooked today$/],
    [1, /^cooked yesterday$/],
    [3, /^cooked 3 days ago$/],
    [7, /^cooked 1 week ago$/],
    [12, /^cooked 2 weeks ago$/],
  ];
  for (const [days, re] of cases) {
    const { factors } = dishWeightFactors(
      { ...base, lastCookedAt: daysAgo(days) },
      refNow,
    );
    const recency = factors.find((f) => /cooked/.test(f.label));
    assert.ok(recency, `expected recency factor for ${days} days`);
    assert.match(recency!.label, re);
  }
});

test("dishWeightFactors: cooked 14+ days ago emits no recency factor", () => {
  const { factors } = dishWeightFactors(
    { ...base, lastCookedAt: daysAgo(21) },
    refNow,
  );
  assert.ok(!factors.some((f) => /cooked/.test(f.label)));
});

test("formatMultiplier renders integers as Nx and non-integers to 2dp", () => {
  assert.equal(formatMultiplier(2), "2×");
  assert.equal(formatMultiplier(0.83), "0.83×");
  assert.equal(formatMultiplier(1.5), "1.5×");
  assert.equal(formatMultiplier(0.8333333), "0.83×");
});

test("pickWithRationale returns dish from pool and pool size", () => {
  const pool: WeightInput[] = [base, { ...base, favorite: true }];
  const res = pickWithRationale(pool, { rand: () => 0.99 });
  assert.ok(pool.includes(res.dish));
  assert.equal(res.poolSize, 2);
});

test("pickWithRationale: pool-size phrasing", () => {
  const singleton: WeightInput[] = [base];
  assert.match(
    pickWithRationale(singleton, { rand: () => 0 }).rationale,
    /^picked from 1 dish(;|$)/,
  );

  const many: WeightInput[] = Array.from({ length: 7 }, () => base);
  assert.match(
    pickWithRationale(many, { rand: () => 0 }).rationale,
    /^picked from 7 dishes(;|$)/,
  );

  assert.match(
    pickWithRationale(many, { tags: ["vegetarian"], rand: () => 0 }).rationale,
    /^picked from 7 vegetarian dishes(;|$)/,
  );

  assert.match(
    pickWithRationale(many, { tags: ["vegetarian", "quick"], rand: () => 0 })
      .rationale,
    /^picked from 7 vegetarian \+ quick dishes(;|$)/,
  );
});

test("pickWithRationale: full example — favourite + cooked recently", () => {
  const pool: WeightInput[] = [
    { favorite: true, lastCookedAt: daysAgo(7), averageRating: null },
  ];
  const { rationale } = pickWithRationale(pool, {
    tags: ["vegetarian"],
    rand: () => 0,
    now: refNow,
  });
  assert.match(rationale, /^picked from 1 vegetarian dish; /);
  assert.match(rationale, /favourite \(2×\)/);
  assert.match(rationale, /cooked 1 week ago \(0\.5×\)/);
});

test("pickWithRationale: baseline dish yields pool-size-only rationale", () => {
  const pool: WeightInput[] = [base];
  const { rationale } = pickWithRationale(pool, { rand: () => 0, now: refNow });
  assert.equal(rationale, "picked from 1 dish");
});
