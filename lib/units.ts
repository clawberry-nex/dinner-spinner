// Unit conversion for shopping-list aggregation.
//
// Canonical units: grams for weight, millilitres for volume. Count and
// imprecise units (piece, clove, handful, to taste, …) have no canonical
// form — they stay as literal strings and only aggregate with matching
// literals. Cross-category conversions (e.g. cup flour ↔ g flour) are
// intentionally NOT supported because they require per-ingredient density,
// which we don't have.

const WEIGHT_TO_G: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.3495,
  lb: 453.592,
};

const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  l: 1000,
  tsp: 5,
  tbsp: 15,
  cup: 240,
  "fl oz": 29.5735,
};

export type UnitCategory = "weight" | "volume" | "other";

function norm(unit: string | null | undefined): string | null {
  if (!unit) return null;
  return unit.trim().toLowerCase();
}

export function getCategory(unit: string | null | undefined): UnitCategory {
  const u = norm(unit);
  if (!u) return "other";
  if (u in WEIGHT_TO_G) return "weight";
  if (u in VOLUME_TO_ML) return "volume";
  return "other";
}

// Convert a (quantity, unit) pair to its canonical form. Returns the
// original quantity unchanged if the unit isn't in a convertible category.
export function toCanonical(
  quantity: number,
  unit: string | null | undefined,
): number {
  const u = norm(unit);
  if (!u) return quantity;
  if (u in WEIGHT_TO_G) return quantity * WEIGHT_TO_G[u];
  if (u in VOLUME_TO_ML) return quantity * VOLUME_TO_ML[u];
  return quantity;
}

// Given a canonical quantity (grams or ml) and its category, return a
// display-friendly (quantity, unit) pair. Uses kg/l for bigger amounts.
export function fromCanonical(
  canonicalQty: number,
  category: UnitCategory,
): { quantity: number; unit: string | null } {
  if (category === "weight") {
    if (canonicalQty >= 1000) {
      return { quantity: canonicalQty / 1000, unit: "kg" };
    }
    return { quantity: canonicalQty, unit: "g" };
  }
  if (category === "volume") {
    if (canonicalQty >= 1000) {
      return { quantity: canonicalQty / 1000, unit: "l" };
    }
    return { quantity: canonicalQty, unit: "ml" };
  }
  return { quantity: canonicalQty, unit: null };
}
