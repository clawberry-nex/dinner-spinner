import type { Ingredient } from "./types";

// Derived dietary classification. No persistence — compute on the fly so
// adding/removing an ingredient updates the chips immediately.

export type Allergen =
  | "dairy"
  | "eggs"
  | "gluten"
  | "nuts"
  | "fish"
  | "shellfish"
  | "soy";

export type DietFlags = {
  vegetarian: boolean;
  vegan: boolean;
  contains: Set<Allergen>;
};

// Per-ingredient attributes. Default (when a field is omitted) is
// vegan:true, vegetarian:true, contains: []. We only list entries
// that deviate from the default OR carry allergen information.
type IngredientAttrs = {
  vegetarian?: boolean;
  vegan?: boolean;
  contains?: Allergen[];
};

// Keyed by lowercased canonical name from STANDARD_INGREDIENTS. A small
// number of aliases are added at the bottom for forgiveness (plurals that
// the ingestion layer sometimes misses, common variants).
export const INGREDIENT_ATTRIBUTES: Readonly<Record<string, IngredientAttrs>> = {
  // --- animal proteins (meat / poultry) -----------------------------------
  "chicken breast": { vegetarian: false, vegan: false },
  "chicken thigh": { vegetarian: false, vegan: false },
  "chicken wing": { vegetarian: false, vegan: false },
  "whole chicken": { vegetarian: false, vegan: false },
  "beef mince": { vegetarian: false, vegan: false },
  "beef steak": { vegetarian: false, vegan: false },
  "stewing beef": { vegetarian: false, vegan: false },
  "pork mince": { vegetarian: false, vegan: false },
  "pork chop": { vegetarian: false, vegan: false },
  bacon: { vegetarian: false, vegan: false },
  sausage: { vegetarian: false, vegan: false },
  "lamb mince": { vegetarian: false, vegan: false },
  "lamb chop": { vegetarian: false, vegan: false },
  // --- fish / seafood -----------------------------------------------------
  salmon: { vegetarian: false, vegan: false, contains: ["fish"] },
  tuna: { vegetarian: false, vegan: false, contains: ["fish"] },
  cod: { vegetarian: false, vegan: false, contains: ["fish"] },
  prawn: { vegetarian: false, vegan: false, contains: ["shellfish"] },
  "fish sauce": { vegetarian: false, vegan: false, contains: ["fish"] },
  "oyster sauce": { vegetarian: false, vegan: false, contains: ["shellfish"] },
  // --- animal-adjacent vegetarian -----------------------------------------
  egg: { vegan: false, contains: ["eggs"] },
  honey: { vegan: false },
  // --- dairy --------------------------------------------------------------
  milk: { vegan: false, contains: ["dairy"] },
  butter: { vegan: false, contains: ["dairy"] },
  "unsalted butter": { vegan: false, contains: ["dairy"] },
  cream: { vegan: false, contains: ["dairy"] },
  "double cream": { vegan: false, contains: ["dairy"] },
  "sour cream": { vegan: false, contains: ["dairy"] },
  yoghurt: { vegan: false, contains: ["dairy"] },
  mozzarella: { vegan: false, contains: ["dairy"] },
  cheddar: { vegan: false, contains: ["dairy"] },
  parmesan: { vegan: false, contains: ["dairy"] },
  feta: { vegan: false, contains: ["dairy"] },
  ricotta: { vegan: false, contains: ["dairy"] },
  mascarpone: { vegan: false, contains: ["dairy"] },
  halloumi: { vegan: false, contains: ["dairy"] },
  "cream cheese": { vegan: false, contains: ["dairy"] },
  // --- gluten-bearing pantry ---------------------------------------------
  "plain flour": { contains: ["gluten"] },
  "bread flour": { contains: ["gluten"] },
  pasta: { contains: ["gluten"] },
  spaghetti: { contains: ["gluten"] },
  penne: { contains: ["gluten"] },
  "lasagna sheet": { contains: ["gluten"] },
  noodles: { contains: ["gluten"] },
  bread: { contains: ["gluten"] },
  breadcrumbs: { contains: ["gluten"] },
  panko: { contains: ["gluten"] },
  couscous: { contains: ["gluten"] },
  oats: { contains: ["gluten"] }, // cross-contamination by default
  // --- soy ----------------------------------------------------------------
  "soy sauce": { contains: ["soy", "gluten"] },
  tofu: { contains: ["soy"] },
  tempeh: { contains: ["soy"] },
  // --- tree nuts / peanuts -----------------------------------------------
  almond: { contains: ["nuts"] },
  walnut: { contains: ["nuts"] },
  cashew: { contains: ["nuts"] },
  peanut: { contains: ["nuts"] },
  pistachio: { contains: ["nuts"] },
  hazelnut: { contains: ["nuts"] },
  "pine nut": { contains: ["nuts"] },
  // --- stocks -------------------------------------------------------------
  "chicken stock": { vegetarian: false, vegan: false },
  "beef stock": { vegetarian: false, vegan: false },
};

// Aliases map alternate spellings/forms to canonical table keys. The
// server normally normalises plurals on ingest, but people are messy —
// this keeps classification robust against "chickpeas"/"almonds"/etc.
const ALIASES: Readonly<Record<string, string>> = {
  chickpeas: "chickpea",
  almonds: "almond",
  walnuts: "walnut",
  cashews: "cashew",
  peanuts: "peanut",
  pistachios: "pistachio",
  hazelnuts: "hazelnut",
  "pine nuts": "pine nut",
  eggs: "egg",
  prawns: "prawn",
  shrimp: "prawn",
  shrimps: "prawn",
};

// Substring cues that fire when the ingredient name isn't in the table.
// These are deliberately asymmetric: "red flags" only. We never promote a
// dish to vegan/vegetarian based on a substring — unknown is permissive
// *except* when an obvious animal-product cue is present.
type Cue = { match: string; attrs: IngredientAttrs };
const CUES: readonly Cue[] = [
  { match: "beef", attrs: { vegetarian: false, vegan: false } },
  { match: "pork", attrs: { vegetarian: false, vegan: false } },
  { match: "chicken", attrs: { vegetarian: false, vegan: false } },
  { match: "lamb", attrs: { vegetarian: false, vegan: false } },
  { match: "duck", attrs: { vegetarian: false, vegan: false } },
  { match: "turkey", attrs: { vegetarian: false, vegan: false } },
  { match: "bacon", attrs: { vegetarian: false, vegan: false } },
  { match: "ham", attrs: { vegetarian: false, vegan: false } },
  { match: "anchovy", attrs: { vegetarian: false, vegan: false, contains: ["fish"] } },
  { match: "fish", attrs: { vegetarian: false, vegan: false, contains: ["fish"] } },
  { match: "prawn", attrs: { vegetarian: false, vegan: false, contains: ["shellfish"] } },
  { match: "shrimp", attrs: { vegetarian: false, vegan: false, contains: ["shellfish"] } },
  { match: "crab", attrs: { vegetarian: false, vegan: false, contains: ["shellfish"] } },
  { match: "lobster", attrs: { vegetarian: false, vegan: false, contains: ["shellfish"] } },
  // allergen cues that don't flip vegetarian/vegan
  { match: "cheese", attrs: { vegan: false, contains: ["dairy"] } },
  { match: "milk", attrs: { vegan: false, contains: ["dairy"] } },
  { match: "butter", attrs: { vegan: false, contains: ["dairy"] } },
  { match: "cream", attrs: { vegan: false, contains: ["dairy"] } },
  { match: "yoghurt", attrs: { vegan: false, contains: ["dairy"] } },
  { match: "yogurt", attrs: { vegan: false, contains: ["dairy"] } },
  { match: "egg", attrs: { vegan: false, contains: ["eggs"] } },
];

function normaliseName(raw: string): string {
  return raw.trim().toLowerCase();
}

function lookup(name: string): IngredientAttrs | null {
  const key = normaliseName(name);
  if (key in INGREDIENT_ATTRIBUTES) return INGREDIENT_ATTRIBUTES[key];
  const aliased = ALIASES[key];
  if (aliased && aliased in INGREDIENT_ATTRIBUTES) {
    return INGREDIENT_ATTRIBUTES[aliased];
  }
  return null;
}

function cueMatch(name: string): IngredientAttrs | null {
  const key = normaliseName(name);
  let combined: IngredientAttrs | null = null;
  for (const { match, attrs } of CUES) {
    if (!key.includes(match)) continue;
    combined = combined ?? {};
    if (attrs.vegetarian === false) combined.vegetarian = false;
    if (attrs.vegan === false) combined.vegan = false;
    if (attrs.contains?.length) {
      combined.contains = [...(combined.contains ?? []), ...attrs.contains];
    }
  }
  return combined;
}

export function computeDietFlags(ingredients: Ingredient[]): DietFlags {
  const contains = new Set<Allergen>();
  let vegetarian = true;
  let vegan = true;

  for (const raw of ingredients) {
    const attrs = lookup(raw.name) ?? cueMatch(raw.name);
    if (!attrs) continue;
    if (attrs.vegetarian === false) vegetarian = false;
    if (attrs.vegan === false) vegan = false;
    if (attrs.contains) {
      for (const a of attrs.contains) contains.add(a);
    }
  }

  // Consistency: vegan implies vegetarian. If something turned off
  // vegetarian we must also be non-vegan.
  if (!vegetarian) vegan = false;

  return { vegetarian, vegan, contains };
}

// Flat list of (label, tone) chips ready to render. Tone helps the caller
// pick a colour: "good" for diet flags ("vegan"/"vegetarian"), "warn" for
// allergen flags ("contains dairy").
export type DietChip = { label: string; tone: "good" | "warn" };

const ALLERGEN_ORDER: readonly Allergen[] = [
  "dairy",
  "eggs",
  "gluten",
  "nuts",
  "fish",
  "shellfish",
  "soy",
];

export function formatDietChips(flags: DietFlags): DietChip[] {
  const chips: DietChip[] = [];
  if (flags.vegan) {
    chips.push({ label: "vegan", tone: "good" });
  } else if (flags.vegetarian) {
    chips.push({ label: "vegetarian", tone: "good" });
  }
  for (const a of ALLERGEN_ORDER) {
    if (flags.contains.has(a)) {
      chips.push({ label: `contains ${a}`, tone: "warn" });
    }
  }
  return chips;
}

// Canonical list of dishes-page filter keys. Exported so the UI and the
// predicate stay in sync.
export const DIET_FILTERS = [
  "vegetarian",
  "vegan",
  "no dairy",
  "no gluten",
  "no nuts",
] as const;
export type DietFilter = (typeof DIET_FILTERS)[number];

export function dishMatchesDietFilter(
  flags: DietFlags,
  filter: DietFilter,
): boolean {
  switch (filter) {
    case "vegetarian":
      return flags.vegetarian;
    case "vegan":
      return flags.vegan;
    case "no dairy":
      return !flags.contains.has("dairy");
    case "no gluten":
      return !flags.contains.has("gluten");
    case "no nuts":
      return !flags.contains.has("nuts");
  }
}
