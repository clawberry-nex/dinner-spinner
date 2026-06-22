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
