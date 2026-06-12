// Combine an Android Web Share Target's title/text/url query params (any subset)
// into a single ingest-input string: trim, drop empties, de-dupe, newline-join.
export function buildSharePrefillFromSearch(search: string): string {
  const p = new URLSearchParams(search);
  const parts = [p.get("title"), p.get("text"), p.get("url")]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  const deduped = parts.filter((s, i) => parts.indexOf(s) === i);
  return deduped.join("\n");
}
