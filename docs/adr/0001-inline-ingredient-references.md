# Ingredient references are stored inline in the method text

## Context

Cook-mode highlighting links phrases in a Dish's Method to the ingredient(s)
they name. The original design stored these as a separate `method_refs` array of
`{phrase, ingredientIndices}`, where each `phrase` had to be an exact substring
of the model's own prose and the renderer re-searched every phrase across every
step at render time. This was fragile in four ways: the model had to self-quote
its prose character-for-character (drift → silent miss); a phrase occurring in
two steps highlighted in both (re-search ambiguity); `method_refs` being a nested
array triggered repeated structured-output failures (the `anyOf`/`json-schema-to-zod`
problem, JSON-string emission); and editing any ingredient dropped the whole ref
array.

## Decision

Store each reference inline in the Method text as a markdown-style link
`[label](#id)` (comma-separated ids for a collective phrase), pointing at a
**stable per-ingredient id** rather than a list position. The reference now
travels with the text, authored in place by the same model that writes the step —
there is no active separate store and no re-matching. The `method_refs` schema
field, phrase matcher, and editor invalidation dance are deleted. The legacy
database column remains in `db/schema.sql` for old rows and one-shot migration
tooling, but runtime reads and writes ignore it. Literal ingredient-name
matching is kept as a per-step fallback for untagged, hand-edited, and legacy
steps.

## Consequences

- The `dishes.recipe` column now carries lightweight markup — visible when
  hand-editing the method and in backup JSON (both survive a round-trip).
- Each ingredient gains a stable `id`, durable across reordering/insertion/
  deletion; ingredient references and cook-mode taps resolve by id.
- The ingest structured output for `recipe` is a plain string again, removing
  the nested-array failure mode and `coerceMethodRefs`. The schema still runs
  through `stripNullFromAnyOf` because claude-agent's schema reconstruction does
  not enforce nullable `anyOf` fields correctly.
- Existing dishes (all users) are migrated by a one-shot LLM annotation pass that
  is guarded to leave the prose unchanged; dishes it can't annotate cleanly stay
  untagged and fall back to name-matching.

## Considered alternatives

- **Keep phrase-matching, harden it** — rejected: the two-sources-that-must-agree
  coupling is the root cause; hardening the matcher doesn't remove it.
- **Clean `recipe` + separate offset map** — rejected: offsets desync the instant
  the text is edited, reintroducing the same drift in a new form.
