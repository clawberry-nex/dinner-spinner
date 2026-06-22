import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseInlineRefs,
  rewriteIndexRefsToIds,
  assignIngredientIds,
  methodProseUnchanged,
} from "./inline-refs.ts";

// A deterministic id generator for tests: yields from a fixed list.
function genFrom(seq: string[]): () => string {
  let i = 0;
  return () => seq[i++] ?? `x${i}`;
}

// ---- parseInlineRefs: render-side parse of [label](#ids) ----

test("plain text with no refs passes through unchanged", () => {
  const out = parseInlineRefs("Heat the pan and wait.");
  assert.equal(out.text, "Heat the pan and wait.");
  assert.deepEqual(out.refs, []);
});

test("a single ref keeps the label as display text and records its offset + id", () => {
  const out = parseInlineRefs("Beat the [eggs](#e1).");
  assert.equal(out.text, "Beat the eggs.");
  assert.equal(out.refs.length, 1);
  // "eggs" sits at offset 9..13 in the DISPLAY text "Beat the eggs."
  assert.deepEqual(out.refs[0], { start: 9, end: 13, ids: ["e1"] });
});

test("a collective ref carries every comma-separated id", () => {
  const out = parseInlineRefs("Knead [the dough](#e1,e4,e5) well.");
  assert.equal(out.text, "Knead the dough well.");
  assert.equal(out.refs.length, 1);
  assert.deepEqual(out.refs[0].ids, ["e1", "e4", "e5"]);
  assert.equal(out.text.slice(out.refs[0].start, out.refs[0].end), "the dough");
});

test("two refs in one step get offsets into the COLLAPSED display text", () => {
  const out = parseInlineRefs("Fold [eggs](#e1) into [flour](#e2).");
  assert.equal(out.text, "Fold eggs into flour.");
  assert.equal(out.refs.length, 2);
  assert.equal(out.text.slice(out.refs[0].start, out.refs[0].end), "eggs");
  assert.equal(out.text.slice(out.refs[1].start, out.refs[1].end), "flour");
});

test("tolerates index-form targets (#0) emitted by the model before id rewrite", () => {
  const out = parseInlineRefs("Add the [cumin](#2).");
  assert.deepEqual(out.refs[0].ids, ["2"]);
  assert.equal(out.text, "Add the cumin.");
});

// ---- rewriteIndexRefsToIds: index → stable id swap at ingest ----

test("rewrites a single index reference to the ingredient's id", () => {
  const out = rewriteIndexRefsToIds("Beat the [eggs](#0).", ["ax", "bx"]);
  assert.equal(out, "Beat the [eggs](#ax).");
});

test("rewrites every index in a collective reference", () => {
  const out = rewriteIndexRefsToIds("Knead [the dough](#0,1).", ["ax", "bx"]);
  assert.equal(out, "Knead [the dough](#ax,bx).");
});

test("drops an out-of-range index but keeps the valid ones", () => {
  const out = rewriteIndexRefsToIds("Mix [it](#0,9).", ["ax"]);
  assert.equal(out, "Mix [it](#ax).");
});

test("unwraps a reference to its bare label when no index is in range", () => {
  const out = rewriteIndexRefsToIds("See [the sauce](#9).", ["ax"]);
  assert.equal(out, "See the sauce.");
});

test("leaves an already-id (non-numeric) target untouched", () => {
  const out = rewriteIndexRefsToIds("Add [salt](#zz9).", ["ax"]);
  assert.equal(out, "Add [salt](#zz9).");
});

// ---- assignIngredientIds ----

test("mints an id for every ingredient that lacks one", () => {
  const out = assignIngredientIds(
    [{ name: "egg" }, { name: "flour" }, { name: "cumin" }],
    genFrom(["a", "b", "c"]),
  );
  assert.deepEqual(out.map((i) => i.id), ["a", "b", "c"]);
});

test("preserves an existing id and only mints the missing ones", () => {
  const out = assignIngredientIds(
    [{ name: "egg", id: "keep" }, { name: "flour" }],
    genFrom(["new"]),
  );
  assert.deepEqual(out.map((i) => i.id), ["keep", "new"]);
});

test("never mints an id that collides with one already in the list", () => {
  // gen offers "dup" first, which is already taken → it must skip to "ok".
  const out = assignIngredientIds(
    [{ name: "egg", id: "dup" }, { name: "flour" }],
    genFrom(["dup", "ok"]),
  );
  assert.deepEqual(out.map((i) => i.id), ["dup", "ok"]);
});

test("does not mutate the input ingredients", () => {
  const input = [{ name: "egg" }];
  assignIngredientIds(input, genFrom(["a"]));
  assert.equal("id" in input[0], false);
});

// ---- methodProseUnchanged (backfill guard) ----

test("true when the annotation only added inline markers", () => {
  assert.equal(
    methodProseUnchanged("Beat the eggs and fold in flour.", "Beat the [eggs](#0) and fold in [flour](#1)."),
    true,
  );
});

test("true despite differing whitespace around the inserted markers", () => {
  assert.equal(
    methodProseUnchanged("Beat the eggs.", "Beat   the [eggs](#0).\n"),
    true,
  );
});

test("false when the annotation reworded the prose", () => {
  assert.equal(
    methodProseUnchanged("Beat the eggs.", "Beat the [eggs](#0) thoroughly."),
    false,
  );
});

test("false when the annotation dropped a sentence", () => {
  assert.equal(
    methodProseUnchanged("Beat the eggs. Then rest the batter.", "Beat the [eggs](#0)."),
    false,
  );
});

// Regression (backfill dry-run, Rendang): some legacy rows store the method with
// LITERAL backslash-n (two chars) instead of a real newline; the annotated
// output comes back with real newlines. Same prose — the guard must accept it,
// or every literal-\n dish gets falsely rejected.
test("true when the original has a literal backslash-n and the annotation has a real newline", () => {
  assert.equal(
    methodProseUnchanged("## Paste\\n\\n1. Clean the ginger.", "## Paste\n\n1. Clean [the ginger](#0)."),
    true,
  );
});
