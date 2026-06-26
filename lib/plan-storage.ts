// Key-parameterized plan storage. The live app uses key "mealPlan" with a
// server PUT (see lib/meal-plan.ts); the read-only demo uses "demoMealPlan"
// with NO server sync. Parse logic is split from localStorage access so it's
// unit-testable (localStorage isn't available under the tsx test runner).

export type PlanEntry = { id: number; servings: number; day?: number | null };

function isValidDay(day: unknown): day is number {
  return typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6;
}

export function normalizePlanEntry(raw: unknown): PlanEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "number" || typeof r.servings !== "number") return null;
  const entry: PlanEntry = { id: r.id, servings: r.servings };
  if (isValidDay(r.day)) entry.day = r.day;
  return entry;
}

export function parsePlan(raw: string | null): PlanEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizePlanEntry).filter((e): e is PlanEntry => e !== null);
  } catch {
    return [];
  }
}

export function readPlan(key: string): PlanEntry[] {
  if (typeof window === "undefined") return [];
  return parsePlan(localStorage.getItem(key));
}

export function writePlan(key: string, entries: PlanEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {}
}
