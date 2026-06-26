// Read-only data source for the /demo experience. Pure helpers (testable)
// plus async loaders bound to the bundled snapshot. NEVER touches the DB or
// /api/* — that is the read-only guarantee.
import type { Dish } from "@/lib/types";
import { DEMO_DISHES, DEMO_TAGS } from "./dishes";

// Mirrors GET /api/dishes: AND-semantics tag filter, ordered by title ASC.
export function filterDishesByTags(dishes: Dish[], tags: string[]): Dish[] {
  const wanted = tags.map((t) => t.trim()).filter(Boolean);
  const matched = wanted.length
    ? dishes.filter((d) => wanted.every((t) => d.tags.includes(t)))
    : dishes.slice();
  return matched.sort((a, b) => a.title.localeCompare(b.title));
}

export function deriveTags(dishes: Dish[]): string[] {
  const set = new Set<string>();
  for (const d of dishes) for (const t of d.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function demoLoadDishes(tags: string[]): Promise<Dish[]> {
  return filterDishesByTags(DEMO_DISHES, tags);
}

export async function demoLoadTags(): Promise<string[]> {
  return DEMO_TAGS.length ? DEMO_TAGS : deriveTags(DEMO_DISHES);
}
