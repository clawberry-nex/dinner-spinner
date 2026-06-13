import type { Dish } from "./types";

// The dish fields the comparators read. A structural subset of `Dish` so the
// sort is generic — the profile grid passes full `Dish[]`, tests pass light
// objects, and nothing here depends on the heavy fields (ingredients, recipe…).
export type SortableDish = Pick<
  Dish,
  | "id"
  | "title"
  | "favorite"
  | "createdAt"
  | "lastCookedAt"
  | "averageRating"
  | "ratingCount"
  | "cookCount"
>;

export type SortKey =
  | "suggested"
  | "recent"
  | "oldest"
  | "name"
  | "cooked-most"
  | "cooked-recent"
  | "rating";

export type SortOption = {
  key: SortKey;
  label: string;
  // Owner-only sorts depend on cook-log data, which is never sent to visitors
  // (cook log is private). availableSortOptions() filters these for non-owners.
  ownerOnly: boolean;
};

export const SORT_OPTIONS: SortOption[] = [
  { key: "suggested", label: "Suggested", ownerOnly: false },
  { key: "recent", label: "Recently added", ownerOnly: false },
  { key: "oldest", label: "Oldest first", ownerOnly: false },
  { key: "name", label: "Name (A–Z)", ownerOnly: false },
  { key: "cooked-most", label: "Most cooked", ownerOnly: true },
  { key: "cooked-recent", label: "Recently cooked", ownerOnly: true },
  { key: "rating", label: "Top rated", ownerOnly: true },
];

export const DEFAULT_SORT: SortKey = "suggested";

const SORT_KEYS = new Set<string>(SORT_OPTIONS.map((o) => o.key));

export function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && SORT_KEYS.has(v);
}

export function availableSortOptions(isOwner: boolean): SortOption[] {
  return isOwner ? SORT_OPTIONS : SORT_OPTIONS.filter((o) => !o.ownerOnly);
}

// --- comparator helpers ---------------------------------------------------

const ms = (iso: string | null): number | null =>
  iso == null ? null : new Date(iso).getTime();

// Descending compare with nulls sorted last regardless of direction.
function descNullsLast(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

const idDesc = (a: SortableDish, b: SortableDish) => b.id - a.id;
const idAsc = (a: SortableDish, b: SortableDish) => a.id - b.id;

const COMPARATORS: Record<SortKey, (a: SortableDish, b: SortableDish) => number> = {
  suggested: (a, b) =>
    Number(b.favorite) - Number(a.favorite) ||
    descNullsLast(ms(a.lastCookedAt), ms(b.lastCookedAt)) ||
    idDesc(a, b),
  recent: (a, b) => descNullsLast(ms(a.createdAt), ms(b.createdAt)) || idDesc(a, b),
  oldest: (a, b) => -descNullsLast(ms(a.createdAt), ms(b.createdAt)) || idAsc(a, b),
  name: (a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) ||
    idAsc(a, b),
  "cooked-most": (a, b) =>
    b.cookCount - a.cookCount ||
    descNullsLast(ms(a.lastCookedAt), ms(b.lastCookedAt)) ||
    idDesc(a, b),
  "cooked-recent": (a, b) =>
    descNullsLast(ms(a.lastCookedAt), ms(b.lastCookedAt)) || idDesc(a, b),
  rating: (a, b) =>
    descNullsLast(a.averageRating, b.averageRating) ||
    b.ratingCount - a.ratingCount ||
    idDesc(a, b),
};

// Non-mutating, stable sort by the given key. Returns a new array.
export function sortDishes<T extends SortableDish>(dishes: readonly T[], key: SortKey): T[] {
  const cmp = COMPARATORS[key] ?? COMPARATORS[DEFAULT_SORT];
  return [...dishes].sort(cmp);
}
