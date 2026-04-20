# Spinner "why this one?" rationale — implementation plan

Roadmap item: `p_UrWBk1gBg9`. Target string example from the roadmap:

> `picked from 7 vegetarian dishes; favourite (2×); cooked 3 weeks ago (0.83×)`

## Design decisions (autonomous mode)

1. **Non-breaking extension of `lib/spinner.ts`**. Add a new
   `pickWithRationale(pool, { tags?, rand? })` that returns
   `{ dish, rationale, factors, poolSize }`. Leave `pickWeighted` and its
   existing tests untouched — one caller (`app/page.tsx`) switches to the
   new function; no one else depends on the old one.

2. **Pure helper `dishWeightFactors(d, now?)`** returns
   `{ weight, factors: [{ label, multiplier }] }`. This is the single
   source of truth for both the numeric weight and the human labels, so
   weight math can't drift from the rationale. `dishWeight` delegates to
   it and returns `result.weight` to guarantee parity.

3. **Factors that land in the rationale**: only those whose multiplier
   is strictly below 1 OR the favourite/rating boost (>1). A neutral
   rating of 3 contributes 1× so it's hidden. Never-cooked dishes don't
   add a recency line. This keeps the rationale short when there's
   nothing interesting to say.

4. **Pool label incorporates filter tags** when present, matching the
   roadmap example literally ("7 vegetarian dishes"). Multiple tags join
   with `+` so the grammar stays readable ("7 vegetarian + quick dishes").
   Pluralisation is handled for pool sizes of 1.

5. **Recency phrasing**: `today` / `yesterday` / `N days ago` (2–6) /
   `1 week ago` / `N weeks ago` (≥2). Rounds to the nearest whole unit.
   The roadmap example ("cooked 3 weeks ago (0.83×)") isn't achievable
   under the current formula (recency caps at 1× beyond 14 days) but is
   illustrative — so we only emit a recency factor when its multiplier
   is actually <1, i.e. within 14 days.

6. **Multiplier formatting**: integer multipliers render as `2×`;
   non-integer as two-decimal `0.83×`. Consistent with the example.

7. **Favourite vs rating**: mirrors the weight formula — if
   `averageRating != null` we emit a `rated X.X★` factor (and never a
   `favourite` one). Otherwise, if `favorite === true`, we emit
   `favourite (2×)`. This is exactly what `dishWeight` does today;
   we're just surfacing it.

8. **Minimum-weight floor (0.05)**: when clamping raises the computed
   weight, the per-factor labels still reflect the raw multipliers
   that led to the clamp. Rationale reports the factors; the numeric
   `weight` in the returned tuple is the post-clamp value. We don't
   try to explain the clamp in the rationale — it's rare and the
   factors already tell you why the weight was low.

9. **UI placement**: on `app/page.tsx`, show the rationale inside the
   `LandedCard` as a small muted line between the title/subtitle block
   and the action buttons. No new design tokens; reuse the existing
   `text-ink-3` / `text-[12px]` styles used for subtitles and tag
   rows. Rationale never blocks layout — it wraps.

## Step-by-step

1. TDD: add `lib/spinner.test.ts` cases for:
   - `dishWeightFactors` returns `{weight, factors}` consistent with
     `dishWeight`.
   - neutral rating (3) produces no rating factor; never-cooked
     produces no recency factor; never-cooked non-favourite without
     rating returns `factors: []`.
   - favourite produces `{label: "favourite", multiplier: 2}`.
   - rating=5 produces `rated 5.0★` with the expected multiplier.
   - recency producing labels for `today` / `yesterday` / `3 days ago`
     / `1 week ago` / `2 weeks ago`.
   - `pickWithRationale` pool-size phrasing (`picked from 1 dish`,
     `picked from 7 dishes`, `picked from 7 vegetarian dishes`,
     multi-tag with `+`).
   - Full-shape snapshot for the roadmap's example case (favourite +
     recent-ish).
   - multiplier formatting: `2×` (integer) vs `0.83×` (2dp).
2. Implement `dishWeightFactors`, refactor `dishWeight` to delegate,
   add `pickWithRationale` and `formatMultiplier`. Tests pass.
3. Update `app/page.tsx` to use `pickWithRationale`, store the
   rationale in a state var, render inside `LandedCard`.
4. `npm run build` — Next.js type-checks during build, which doubles
   as TS verification. Also re-run `node --test` on the spinner test
   file.
5. Commit, merge to main, bump `package.json` to 0.9.0, update the
   `ROADMAP.md` entry to "Shipped in v0.9.0", re-run build, and report
   back.

## Explicitly out of scope

- Showing the rationale anywhere besides the tonight's-pick card
  (e.g. `/plan` doesn't spin; `/dishes` doesn't show weights).
- Explaining the 0.05 weight floor when it kicks in.
- Changing the underlying weight formula.
- Surfacing weights on non-winning dishes ("here's why these 3 were
  close") — would be nice but the roadmap scope is the single winner.
