// lib/recipe.ts
// Pure helpers for recipe method text and ingredient↔method linking.
// Shared by the dish detail view (RecipeMethod) and cook mode (CookView)
// so numbering and matching behave identically everywhere.

export interface RecipeSection {
  title: string | null;
  steps: string[];
}

// Parse a recipe markdown blob into sections of steps. Recognizes:
//   ## Heading   — starts a new section
//   1. Step text — numbered list item
//   - Step text  — bulleted list item
//   prose line   — treated as its own step (so prose recipes still number)
// Per-section step numbering is applied at render time (index within section).
export function parseMethod(md: string): RecipeSection[] {
  const sections: RecipeSection[] = [];
  let current: RecipeSection | null = null;
  const ensureSection = () => {
    if (!current) {
      current = { title: null, steps: [] };
      sections.push(current);
    }
    return current;
  };

  // Tolerate LITERAL escape sequences (backslash-n / backslash-r-backslash-n):
  // some ingested recipes were stored with "\n" as two characters instead of a
  // real newline (a Haiku structured-output quirk — normally repaired at ingest
  // by normalizeEscapedWhitespace, but this keeps the renderer robust for any
  // already-stored rows that bypassed it).
  const normalized = md.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      current = { title: heading[1].trim(), steps: [] };
      sections.push(current);
      continue;
    }

    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) {
      ensureSection().steps.push(numbered[1].trim());
      continue;
    }

    const bulleted = line.match(/^[-*]\s+(.*)$/);
    if (bulleted) {
      ensureSection().steps.push(bulleted[1].trim());
      continue;
    }

    ensureSection().steps.push(line);
  }

  return sections.filter((s) => s.steps.length > 0);
}

export interface SectionGroup<T> {
  title: string | null;
  items: { item: T; index: number }[];
}

// Group items by section, preserving first-seen section order. Items with no
// section (null/blank) collect into a trailing null-title group. When NO item
// has a section, returns a single null-title group containing everything —
// so existing (sectionless) dishes render exactly as a flat list.
export function groupIngredientsBySection<T>(
  items: T[],
  getSection: (item: T) => string | null | undefined,
): SectionGroup<T>[] {
  const titled = new Map<string, SectionGroup<T>>();
  const order: string[] = [];
  const nullGroup: SectionGroup<T> = { title: null, items: [] };

  items.forEach((item, index) => {
    const raw = getSection(item);
    const title = raw && raw.trim() ? raw.trim() : null;
    if (title === null) {
      nullGroup.items.push({ item, index });
      return;
    }
    let g = titled.get(title);
    if (!g) {
      g = { title, items: [] };
      titled.set(title, g);
      order.push(title);
    }
    g.items.push({ item, index });
  });

  const out: SectionGroup<T>[] = order.map((t) => titled.get(t)!);
  if (nullGroup.items.length > 0) out.push(nullGroup);
  // Edge: no items at all → return one empty null group for stable rendering.
  return out.length > 0 ? out : [nullGroup];
}

export interface IngredientSpan {
  start: number;
  end: number;
  idxs: number[];
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Literal-name matcher (the fallback path). Word-boundary, case-insensitive,
// tolerant of a trailing plural "s". Used per-step when a step carries no inline
// `[label](#id)` reference (hand-edited, legacy, or genuinely untagged steps).
export function findNameSpans(
  text: string,
  ingredients: { name: string }[],
): IngredientSpan[] {
  if (ingredients.length === 0) return [];
  const entries = ingredients
    .map((ing, idx) => ({ name: ing.name.trim(), idx }))
    .filter((e) => e.name.length >= 3)
    .sort((a, b) => b.name.length - a.name.length);
  if (entries.length === 0) return [];

  const alternation = entries.map((e) => escapeRegex(e.name)).join("|");
  const re = new RegExp(`\\b(?:${alternation})s?\\b`, "gi");
  const spans: IngredientSpan[] = [];

  for (const m of text.matchAll(re)) {
    const matched = m[0];
    const normalized = matched.replace(/s$/i, "").toLowerCase();
    const hit = entries.find(
      (e) =>
        e.name.toLowerCase() === normalized ||
        e.name.toLowerCase() === matched.toLowerCase(),
    );
    if (!hit) continue;
    const start = m.index ?? 0;
    spans.push({ start, end: start + matched.length, idxs: [hit.idx] });
  }
  return spans;
}

// Inline `[label](#id)` references in the Method text are parsed by
// parseInlineRefs (lib/inline-refs.ts); the renderer resolves their ids to
// ingredient indices. findNameSpans above is the per-step fallback for any step
// that carries no inline reference (hand-edited, legacy, or genuinely untagged).
