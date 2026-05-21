import "server-only";
import type { Ingredient } from "./types";
import { sql } from "./db";
import { PANTRY_DEFAULTS as HARDCODED_DEFAULTS } from "./vocabulary";

/**
 * Fetch the user-curated pantry defaults from the DB. Falls back to the
 * hardcoded seed set in lib/vocabulary.ts if the query fails (useful for
 * local dev before the schema has been applied).
 */
export async function getPantryDefaults(userId: string): Promise<Set<string>> {
  try {
    const rows = await sql`SELECT name FROM pantry_names WHERE user_id = ${userId}`;
    return new Set(rows.map((r) => (r.name as string).toLowerCase()));
  } catch (err) {
    console.error(
      "pantry_names query failed, falling back to hardcoded defaults",
      err,
    );
    return new Set(
      [...HARDCODED_DEFAULTS].map((n) => n.toLowerCase()),
    );
  }
}

/**
 * For any ingredient where `pantry` isn't explicitly set, auto-flag
 * `pantry: true` if its name is in the user-curated pantry defaults.
 * Explicit `pantry: false` is always respected.
 */
export async function applyPantryDefaults(
  ingredients: Ingredient[],
  userId: string,
): Promise<Ingredient[]> {
  const defaults = await getPantryDefaults(userId);
  return ingredients.map((ing) => {
    if (ing.pantry === false) return ing;
    if (ing.pantry) return ing;
    if (defaults.has(ing.name.toLowerCase().trim())) {
      return { ...ing, pantry: true };
    }
    return ing;
  });
}
