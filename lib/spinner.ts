export type WeightInput = {
  favorite: boolean;
  lastCookedAt: string | null;
  averageRating: number | null;
};

export type WeightFactor = { label: string; multiplier: number };

export type WeightBreakdown = { weight: number; factors: WeightFactor[] };

// Rating multipliers. Pivots at 3 (neutral = 1x). Rating 5 beats a plain
// favorite (2x). Low ratings actively penalise so 1-star dishes rarely win.
const RATING_WEIGHT: Record<number, number> = {
  1: 0.25,
  2: 0.5,
  3: 1,
  4: 1.5,
  5: 2.25,
};

const WEIGHT_FLOOR = 0.05;

function ratingWeight(avg: number): number {
  if (avg <= 1) return RATING_WEIGHT[1];
  if (avg >= 5) return RATING_WEIGHT[5];
  const lo = Math.floor(avg);
  const hi = lo + 1;
  const t = avg - lo;
  return RATING_WEIGHT[lo] * (1 - t) + RATING_WEIGHT[hi] * t;
}

function describeDaysAgo(days: number): string {
  const d = Math.max(0, Math.round(days));
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  const weeks = Math.round(d / 7);
  if (weeks === 1) return "1 week ago";
  return `${weeks} weeks ago`;
}

export function formatMultiplier(m: number): string {
  if (Number.isInteger(m)) return `${m}×`;
  // Up to 2 decimal places, stripping trailing zeros: 0.8333 → 0.83, 1.5 → 1.5.
  return `${m.toFixed(2).replace(/\.?0+$/, "")}×`;
}

export function dishWeightFactors(
  d: WeightInput,
  now: number = Date.now(),
): WeightBreakdown {
  const factors: WeightFactor[] = [];
  let w = 1;

  if (d.averageRating != null) {
    const m = ratingWeight(d.averageRating);
    if (m !== 1) {
      factors.push({
        label: `rated ${d.averageRating.toFixed(1)}★`,
        multiplier: m,
      });
    }
    w *= m;
  } else if (d.favorite) {
    factors.push({ label: "favourite", multiplier: 2 });
    w *= 2;
  }

  if (d.lastCookedAt) {
    const days = (now - new Date(d.lastCookedAt).getTime()) / 86400000;
    const m = Math.min(1, Math.max(0, days) / 14);
    if (m < 1) {
      factors.push({
        label: `cooked ${describeDaysAgo(days)}`,
        multiplier: m,
      });
    }
    w *= m;
  }

  return { weight: Math.max(WEIGHT_FLOOR, w), factors };
}

export function dishWeight(d: WeightInput, now: number = Date.now()): number {
  return dishWeightFactors(d, now).weight;
}

export function pickWeighted<T extends WeightInput>(
  candidates: T[],
  rand: () => number = Math.random,
): T {
  const weights = candidates.map((c) => dishWeight(c));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

export type PickResult<T> = {
  dish: T;
  rationale: string;
  factors: WeightFactor[];
  poolSize: number;
};

export function pickWithRationale<T extends WeightInput>(
  pool: T[],
  options: { tags?: string[]; rand?: () => number; now?: number } = {},
): PickResult<T> {
  const rand = options.rand ?? Math.random;
  const now = options.now ?? Date.now();
  const tags = options.tags ?? [];

  const breakdowns = pool.map((d) => dishWeightFactors(d, now));
  const weights = breakdowns.map((b) => b.weight);
  const total = weights.reduce((s, w) => s + w, 0);

  let idx = pool.length - 1;
  let r = rand() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      idx = i;
      break;
    }
  }

  const dish = pool[idx];
  const factors = breakdowns[idx].factors;

  const tagLabel = tags.length ? `${tags.join(" + ")} ` : "";
  const noun = pool.length === 1 ? "dish" : "dishes";
  const parts = [`picked from ${pool.length} ${tagLabel}${noun}`];
  for (const f of factors) {
    parts.push(`${f.label} (${formatMultiplier(f.multiplier)})`);
  }

  return {
    dish,
    rationale: parts.join("; "),
    factors,
    poolSize: pool.length,
  };
}
