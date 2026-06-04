// lib/recipe.ts
// Pure helpers for recipe method text and ingredient↔method linking.
// Shared by the dish detail view (RecipeMethod) and cook mode (CookView)
// so numbering and matching behave identically everywhere.

import type { MethodRef } from "./types.ts";

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

  for (const rawLine of md.split("\n")) {
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

// Literal-name matcher (the legacy/fallback path). Word-boundary, case-
// insensitive, tolerant of a trailing plural "s". Used when a dish has no
// methodRefs (old dishes, or a hand-edited method).
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

// Phrase matcher (preferred). For each methodRef, find every occurrence of its
// exact phrase in the text and link it to the referenced ingredient indices.
// Phrases were authored by the model from this exact (translated) text, so the
// match is reliable and language/loose-reference proof.
export function findPhraseSpans(
  text: string,
  refs: MethodRef[],
): IngredientSpan[] {
  const spans: IngredientSpan[] = [];
  for (const ref of refs) {
    const phrase = ref.phrase.trim();
    if (!phrase) continue;
    const re = new RegExp(escapeRegex(phrase), "gi");
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      spans.push({ start, end: start + m[0].length, idxs: ref.ingredients.slice() });
    }
  }
  return spans;
}

// Drop refs whose ingredient indices are out of range for the persisted
// ingredient array; drop refs left with no valid index. Returns null when
// nothing survives (so the column is cleared and cook-mode falls back).
export function sanitizeMethodRefs(
  refs: MethodRef[] | null | undefined,
  ingredientCount: number,
): MethodRef[] | null {
  if (!refs || refs.length === 0) return null;
  const cleaned = refs
    .map((r) => ({
      phrase: r.phrase,
      ingredients: r.ingredients.filter(
        (i) => Number.isInteger(i) && i >= 0 && i < ingredientCount,
      ),
    }))
    .filter((r) => r.phrase.trim().length > 0 && r.ingredients.length > 0);
  return cleaned.length > 0 ? cleaned : null;
}
