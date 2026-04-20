// Per-dish "last chosen servings" memory. Pure client-side: a single
// localStorage key holds a `{ [dishId]: servings }` map so the dish
// detail stepper can restore the previously used count.

"use client";

const KEY = "lastServings";

function readMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, number>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {}
}

function isValid(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1;
}

export function readLastServings(dishId: number): number | null {
  const map = readMap();
  const n = map[String(dishId)];
  return isValid(n) ? n : null;
}

export function writeLastServings(dishId: number, servings: number): void {
  if (!isValid(servings)) return;
  const map = readMap();
  map[String(dishId)] = servings;
  writeMap(map);
}

export function clearLastServings(dishId: number): void {
  const map = readMap();
  if (!(String(dishId) in map)) return;
  delete map[String(dishId)];
  writeMap(map);
}
