// Pure helpers for the week-view meal plan. `day` on a PlanEntry is
// an integer 0..6 (0 = Monday, 6 = Sunday, ISO week order) or
// missing/null for "unassigned — sits in the pool column".

export type WeekPlanEntry = {
  id: number;
  servings: number;
  day?: number | null;
};

export const DAY_LABELS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

export const DAY_LABELS_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export function isValidDay(day: unknown): day is number {
  return (
    typeof day === "number" &&
    Number.isInteger(day) &&
    day >= 0 &&
    day <= 6
  );
}

export function entryDay(entry: WeekPlanEntry): number | null {
  return isValidDay(entry.day) ? entry.day : null;
}

// moveEntry returns a new array with the target entry's `day` set to
// the provided day. Passing `null` (or any invalid day) strips the
// `day` key entirely so the entry returns to the pool.
export function moveEntry<E extends WeekPlanEntry>(
  entries: readonly E[],
  dishId: number,
  day: number | null,
): E[] {
  return entries.map((e) => {
    if (e.id !== dishId) return { ...e };
    if (day === null) {
      const { day: _removed, ...rest } = e;
      void _removed;
      return { ...(rest as E) };
    }
    if (!isValidDay(day)) return { ...e };
    return { ...e, day };
  });
}

// resetWeek strips `day` from every entry. Entries themselves are
// kept — "reset week" is about un-slotting, not clearing the plan.
export function resetWeek<E extends WeekPlanEntry>(
  entries: readonly E[],
): E[] {
  return entries.map((e) => {
    const { day: _removed, ...rest } = e;
    void _removed;
    return { ...(rest as E) };
  });
}

export type GroupedWeek<E extends WeekPlanEntry> = {
  pool: E[];
  days: [E[], E[], E[], E[], E[], E[], E[]];
};

export function groupByDay<E extends WeekPlanEntry>(
  entries: readonly E[],
): GroupedWeek<E> {
  const days: [E[], E[], E[], E[], E[], E[], E[]] = [
    [], [], [], [], [], [], [],
  ];
  const pool: E[] = [];
  for (const e of entries) {
    const d = entryDay(e);
    if (d === null) pool.push(e);
    else days[d].push(e);
  }
  return { pool, days };
}
