export type WeightInput = {
  favorite: boolean;
  lastCookedAt: string | null;
  averageRating: number | null;
};

// Rating multipliers. Pivots at 3 (neutral = 1x). Rating 5 beats a plain
// favorite (2x). Low ratings actively penalise so 1-star dishes rarely win.
const RATING_WEIGHT: Record<number, number> = {
  1: 0.25,
  2: 0.5,
  3: 1,
  4: 1.5,
  5: 2.25,
};

function ratingWeight(avg: number): number {
  if (avg <= 1) return RATING_WEIGHT[1];
  if (avg >= 5) return RATING_WEIGHT[5];
  const lo = Math.floor(avg);
  const hi = lo + 1;
  const t = avg - lo;
  return RATING_WEIGHT[lo] * (1 - t) + RATING_WEIGHT[hi] * t;
}

export function dishWeight(d: WeightInput): number {
  let w = 1;
  if (d.averageRating != null) {
    w *= ratingWeight(d.averageRating);
  } else if (d.favorite) {
    w *= 2;
  }
  if (d.lastCookedAt) {
    const days = (Date.now() - new Date(d.lastCookedAt).getTime()) / 86400000;
    w *= Math.min(1, days / 14);
  }
  return Math.max(0.05, w);
}

export function pickWeighted<T extends WeightInput>(
  candidates: T[],
  rand: () => number = Math.random,
): T {
  const weights = candidates.map(dishWeight);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
