import { MethodRefSchema } from "../types.ts";

// claude-agent's structured output can hand back `methodRefs` in shapes our
// canonical DishInputSchema rejects: a JSON string, a non-array, or an array
// containing individually-malformed entries (an over-length `phrase`, an empty
// `ingredients`, …). methodRefs only drive cook-mode highlighting, and cook mode
// already falls back to literal string-matching whenever a ref is absent — so a
// single bad entry must never sink the whole import.
//
// Coerce a JSON-string into an array, drop a non-array outright, and drop just
// the entries that fail MethodRefSchema (keeping the good ones). Mutates `raw`
// in place; safe to call on any/unknown structured payload.
export function coerceMethodRefs(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.methodRefs === "string") {
    try {
      obj.methodRefs = JSON.parse(obj.methodRefs);
    } catch {
      delete obj.methodRefs;
    }
  }
  if (obj.methodRefs != null && !Array.isArray(obj.methodRefs)) {
    delete obj.methodRefs;
    return;
  }
  if (Array.isArray(obj.methodRefs)) {
    obj.methodRefs = obj.methodRefs.filter((m) => MethodRefSchema.safeParse(m).success);
  }
}

// Convert LITERAL escape sequences (backslash-n, backslash-r-backslash-n,
// backslash-t) into the real characters. Haiku's structured-output tool call
// nondeterministically fills multiline text fields (notably `recipe`) with
// literal "\n" instead of pressing newline; claude-agent passes it through and
// our renderer (parseMethod splits on real "\n") then can't see the steps — a
// `## Section`-leading method collapses into a single heading and shows as "no
// method". Repairing it here (right after coerceMethodRefs, in BOTH ingest
// paths) is model-quirk-proof and keeps storage canonical. Recipes never
// legitimately contain a backslash-n, so this is safe. Mutates `raw` in place.
function unescapeWhitespace(s: string): string {
  return s.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

export function normalizeEscapedWhitespace(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const obj = raw as Record<string, unknown>;

  for (const key of ["recipe", "subtitle"]) {
    if (typeof obj[key] === "string") obj[key] = unescapeWhitespace(obj[key] as string);
  }

  if (Array.isArray(obj.ingredients)) {
    for (const ing of obj.ingredients) {
      if (!ing || typeof ing !== "object") continue;
      const io = ing as Record<string, unknown>;
      for (const key of ["preparation", "descriptor", "section"]) {
        if (typeof io[key] === "string") io[key] = unescapeWhitespace(io[key] as string);
      }
    }
  }
}
