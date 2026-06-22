// lib/inline-refs.ts
// The single owner of the inline ingredient-reference format that lives inside a
// Dish's Method text: `[label](#id)`, or `[label](#id1,id2,...)` for a phrase
// that names several ingredients ("the dough" → flour, water, yeast). The
// renderer (lib/recipe.ts), the ingest persistence (lib/dish-create.ts) and the
// backfill all parse/produce this one format here so they can never drift.
//
// Ids are short, dish-local, opaque tokens (see mintIngredientId). At INGEST the
// model emits references by list INDEX (`#0`); persistence rewrites those to ids
// once the ingredients have them (rewriteIndexRefsToIds).

export interface InlineRef {
  start: number;
  end: number;
  ids: string[];
}

// Matches `[label](#id)` and `[label](#id1,id2,...)`. Ids are lowercase
// alphanumerics — this also matches the index form (`#0`) the model emits at
// ingest, before rewriteIndexRefsToIds swaps them for real ids. Labels may hold
// anything except a `]`. Global + case-insensitive.
export const INLINE_REF_RE = /\[([^\]]+)\]\(#([a-z0-9]+(?:,[a-z0-9]+)*)\)/gi;

// Strip the tag syntax to recover the display text (labels kept, markers gone)
// and record where each reference's LABEL lands in that display text, with the
// ids it points at. Offsets index the returned `text`, not the raw input — so
// the renderer can overlay spans on what the reader actually sees.
export function parseInlineRefs(raw: string): { text: string; refs: InlineRef[] } {
  const refs: InlineRef[] = [];
  let text = "";
  let lastIndex = 0;
  // Fresh RegExp per call: INLINE_REF_RE is global (stateful lastIndex).
  const re = new RegExp(INLINE_REF_RE.source, "gi");
  for (const m of raw.matchAll(re)) {
    const label = m[1];
    const ids = m[2].split(",");
    text += raw.slice(lastIndex, m.index);
    const start = text.length;
    text += label;
    refs.push({ start, end: text.length, ids });
    lastIndex = m.index + m[0].length;
  }
  text += raw.slice(lastIndex);
  return { text, refs };
}

// At ingest the model references ingredients by their list INDEX (`#0`, `#1,2`).
// Once each ingredient has a stable id, swap every numeric index for the id of
// the ingredient at that position. An out-of-range index is dropped from its
// list; a reference left with no ids is unwrapped to its bare label. Non-numeric
// targets (already ids) are left untouched.
export function rewriteIndexRefsToIds(recipe: string, ids: string[]): string {
  const re = new RegExp(INLINE_REF_RE.source, "gi");
  return recipe.replace(re, (_whole, label: string, target: string) => {
    const mapped: string[] = [];
    for (const tok of target.split(",")) {
      if (/^\d+$/.test(tok)) {
        const idx = Number(tok);
        if (idx >= 0 && idx < ids.length) mapped.push(ids[idx]);
        // out-of-range index → drop it
      } else {
        mapped.push(tok); // already an id → keep
      }
    }
    return mapped.length === 0 ? label : `[${label}](#${mapped.join(",")})`;
  });
}

// A short, opaque, dish-local id. 4 base-36 chars (~1.7M space) is ample within
// one dish's ingredient list; assignIngredientIds guards against collisions
// regardless. Random (not sequential) so deleting + re-adding a row can't reuse
// a live id.
export function mintIngredientId(): string {
  return Math.random().toString(36).slice(2, 6);
}

// Give every ingredient a stable id: existing ids are preserved, missing ones
// are minted uniquely within the list. Returns a new array of new objects (input
// untouched). `gen` is injectable for deterministic tests. STUB.
export function assignIngredientIds<T extends { id?: string | null }>(
  ingredients: T[],
  gen: () => string = mintIngredientId,
): T[] {
  const used = new Set<string>();
  for (const ing of ingredients) if (ing.id) used.add(ing.id);
  return ingredients.map((ing) => {
    if (ing.id) return { ...ing };
    let id = gen();
    let guard = 0;
    while (used.has(id) && guard++ < 1000) id = gen();
    used.add(id);
    return { ...ing, id };
  });
}

// The backfill's safety guard: true when `annotated` differs from `original`
// ONLY by added inline-reference markers — i.e. stripping the tags out of
// `annotated` recovers the original prose (whitespace-insensitive). Any real
// edit to the wording returns false, so the backfill can reject it. STUB.
export function methodProseUnchanged(original: string, annotated: string): boolean {
  // Collapse whitespace AND treat literal escape sequences (`\n`, `\r\n`, `\t`)
  // as whitespace — some legacy rows store the method with literal backslash-n
  // while the annotated output uses real newlines; that difference is not a
  // prose change and must not trip the guard.
  const norm = (s: string) =>
    s
      .replace(/\\r\\n/g, " ")
      .replace(/\\[nt]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return norm(parseInlineRefs(annotated).text) === norm(original);
}
