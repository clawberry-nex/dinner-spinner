// scripts/backfill-inline-refs.ts
// One-shot backfill (ADR-0001): give every existing dish inline `[label](#id)`
// ingredient references in its Method text + stable ingredient ids, WITHOUT
// touching the wording.
//
// For each candidate dish a Haiku pass inserts ONLY the markers into the exact
// existing method text. A prose-unchanged guard (methodProseUnchanged) then
// strips the markers back out and compares to the original; if anything but the
// markers changed, the annotation is REJECTED and the dish is left exactly as it
// was (cook mode falls back to literal name-matching). On success we assign
// stable ids to the ingredients and rewrite the model's index references to ids.
//
// Idempotent: a dish whose ingredients already all carry ids is skipped (unless
// --force). Failure-isolated: one dish erroring never aborts the sweep.
// Dry-run by default — writes a preview JSON and changes nothing.
//
// Usage (env: source the dinner-spinner PROD env first, e.g. `vercel env pull`
// then `node --env-file=.env.production.local …`, or run on a box where
// DATABASE_URL + NEX_API_TOKEN point at prod):
//   tsx scripts/backfill-inline-refs.ts                      # dry-run, ALL users
//   tsx scripts/backfill-inline-refs.ts --user me@x.com      # dry-run, one user
//   tsx scripts/backfill-inline-refs.ts --only 48            # dry-run, one dish
//   tsx scripts/backfill-inline-refs.ts --limit 5            # dry-run, first 5 candidates
//   tsx scripts/backfill-inline-refs.ts --apply              # WRITE, all users
//   ...combine with --user / --only / --limit / --force / --concurrency N
//
// Requires: DATABASE_URL, NEX_API_TOKEN, (optional) CLAUDE_AGENT_URL.

import { sql } from "../lib/db.ts";
import { rowToDish, type Dish } from "../lib/types.ts";
import {
  startClaudeAgentJob,
  pollClaudeAgentJob,
} from "../lib/ingest/claude-agent.ts";
import { normalizeEscapedWhitespace } from "../lib/ingest/sanitize.ts";
import {
  parseInlineRefs,
  methodProseUnchanged,
  assignIngredientIds,
  rewriteIndexRefsToIds,
} from "../lib/inline-refs.ts";
import { writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
function argVal(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const ONLY = argVal("--only") != null ? Number(argVal("--only")) : null;
const USER = argVal("--user");
const LIMIT = argVal("--limit") != null ? Number(argVal("--limit")) : null;
const CONCURRENCY = argVal("--concurrency") != null ? Number(argVal("--concurrency")) : 4;
// The model occasionally rewords instead of only inserting markers (~5%,
// nondeterministic). Each attempt is a fresh roll, so retry for a clean one.
const GUARD_RETRIES = argVal("--guard-retries") != null ? Number(argVal("--guard-retries")) : 4;

const token: string = process.env.NEX_API_TOKEN ?? "";
if (!token) throw new Error("NEX_API_TOKEN required");
const baseUrl =
  process.env.CLAUDE_AGENT_URL ?? "https://nex.tail7f6b96.ts.net:10000";

// Single string field — the method, verbatim, with markers added.
const ANNOTATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    recipe: {
      type: "string",
      description:
        "The method text, returned verbatim, with inline [label](#index) markers added and NOTHING else changed.",
    },
  },
  required: ["recipe"],
};

function ingredientLines(d: Dish): string {
  return d.ingredients
    .map((i, idx) => `${idx}: ${[i.descriptor, i.name].filter(Boolean).join(" ")}`)
    .join("\n");
}

function buildAnnotatePrompt(d: Dish): string {
  return `You are adding inline ingredient references to a recipe's method. Insert ONLY the markers and return the method otherwise byte-for-byte identical — do NOT rewrite, translate, reorder, summarise, fix, or reword anything.

INGREDIENTS (index: name):
${ingredientLines(d)}

METHOD (annotate this exact text — it may be in any language; keep that language):
${d.recipe}

TASK: wherever the METHOD mentions an ingredient — including loose references like "the seeds", "the dough", "the spices", "the sauce" — wrap the natural words already there in a markdown-style link whose target is "#" + that ingredient's INDEX from the list above. Examples: "Beat [the eggs](#0) until pale.", "Fold in [the flour](#3).". A phrase that names several ingredients lists their indices comma-separated: "[the dough](#0,3,4)".

HARD RULES:
- Change NOTHING except inserting the [ ]( ) characters. Same words, same spelling, same punctuation, same line breaks, same "## " headers, same "1." / "2." numbering.
- Wrap only words that are ALREADY in the method; never add, drop, or alter a word.
- Only use an index that appears in the INGREDIENTS list. Wrap only references you are sure of; if unsure, leave that text untouched.
- Return the complete method via submit_result's "recipe" field.

Call submit_result now.`;
}

// A dish is already migrated once every ingredient carries an id (a successful
// run is the only thing that assigns ids). Dishes with no ingredients have
// nothing to reference and are skipped.
function isMigrated(d: Dish): boolean {
  return d.ingredients.length > 0 && d.ingredients.every((i) => !!i.id);
}

// One annotation attempt: start a job, poll to completion, repair literal-"\n".
async function annotateOnce(d: Dish): Promise<string> {
  const job = await startClaudeAgentJob({
    prompt: buildAnnotatePrompt(d),
    responseSchema: ANNOTATE_SCHEMA,
    token,
    baseUrl,
    model: "haiku",
  });
  for (let i = 0; i < 120; i++) {
    const r = await pollClaudeAgentJob(job.jobId, { token, baseUrl });
    if (r.status === "done") {
      const structured = r.structured as { recipe?: unknown };
      if (typeof structured?.recipe !== "string") {
        throw new Error("structured output had no string `recipe`");
      }
      // Repair Haiku's literal-"\n" quirk before the guard compares prose.
      const obj: Record<string, unknown> = { recipe: structured.recipe };
      normalizeEscapedWhitespace(obj);
      return obj.recipe as string;
    }
    if (r.status === "failed") throw new Error(r.errorMessage ?? "job failed");
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("timed out");
}

// Structured output is nondeterministic: the model occasionally answers in prose
// instead of calling submit_result. Give it two tries before giving up.
async function annotate(d: Dish): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await annotateOnce(d);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

type PreviewRow = {
  id: number;
  title: string;
  status: "ok" | "no-refs" | "guard-rejected" | "failed";
  refCount?: number;
  before?: string | null;
  after?: string;
  attempted?: string;
  error?: string;
};

const stats = { ok: 0, noRefs: 0, guardRejected: 0, failed: 0 };

async function processDish(d: Dish, preview: PreviewRow[]): Promise<void> {
  try {
    // Deterministically clean the source up front so we annotate — and store —
    // clean text and the guard compares like-for-like:
    //  - repair literal "\n" (every stored recipe has it: a Haiku quirk);
    //  - strip stray wrapping-quote import artifacts (some rows end with a bare
    //    `"`; none legitimately start/end with one). The model drops these on its
    //    own, which would otherwise read as a prose change and trip the guard.
    const src: Record<string, unknown> = { recipe: d.recipe ?? "" };
    normalizeEscapedWhitespace(src);
    const original = (src.recipe as string).trim().replace(/^"+/, "").replace(/"+$/, "").trim();

    // Retry on a reworded answer (not just on a hard error): a fresh roll usually
    // inserts only the markers. Only dishes the model keeps rewording fall through
    // to the name-match fallback.
    let annotated: string | null = null;
    let lastAttempt = "";
    for (let attempt = 0; attempt < GUARD_RETRIES; attempt++) {
      lastAttempt = await annotate({ ...d, recipe: original });
      if (methodProseUnchanged(original, lastAttempt)) {
        annotated = lastAttempt;
        break;
      }
    }
    if (annotated === null) {
      stats.guardRejected++;
      console.warn(`#${d.id} "${d.title}" — GUARD REJECTED after ${GUARD_RETRIES} tries (model kept rewording); left untouched`);
      preview.push({ id: d.id, title: d.title, status: "guard-rejected", before: d.recipe, attempted: lastAttempt });
      return;
    }
    const refCount = parseInlineRefs(annotated).refs.length;
    const ingredients = assignIngredientIds(d.ingredients);
    const finalRecipe = rewriteIndexRefsToIds(annotated, ingredients.map((i) => i.id!));
    if (refCount === 0) stats.noRefs++;
    else stats.ok++;
    console.log(`#${d.id} "${d.title}" — ${refCount} ref(s)${APPLY ? " [APPLIED]" : ""}`);
    preview.push({
      id: d.id,
      title: d.title,
      status: refCount === 0 ? "no-refs" : "ok",
      refCount,
      before: d.recipe,
      after: finalRecipe,
    });
    if (APPLY) {
      await sql`
        UPDATE dishes
        SET recipe = ${finalRecipe},
            ingredients = ${JSON.stringify(ingredients)}::jsonb,
            updated_at = now()
        WHERE id = ${d.id}
      `;
    }
  } catch (err) {
    stats.failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`#${d.id} "${d.title}" FAILED: ${msg}`);
    preview.push({ id: d.id, title: d.title, status: "failed", error: msg });
  }
}

async function main() {
  let rows: Record<string, unknown>[];
  if (ONLY != null) {
    rows = await sql`SELECT * FROM dishes WHERE id = ${ONLY}`;
  } else if (USER) {
    rows = await sql`
      SELECT d.* FROM dishes d
      JOIN users u ON u.id = d.user_id
      WHERE lower(u.email) = lower(${USER})
      ORDER BY d.id
    `;
  } else {
    rows = await sql`SELECT * FROM dishes ORDER BY id`;
  }

  let dishes = rows
    .map(rowToDish)
    // Needs a method to annotate AND ingredients to reference.
    .filter((d) => d.recipe != null && d.recipe.trim().length > 0 && d.ingredients.length > 0);
  const total = dishes.length;
  if (!FORCE) dishes = dishes.filter((d) => !isMigrated(d));
  const skipped = total - dishes.length;
  if (LIMIT != null) dishes = dishes.slice(0, LIMIT);

  console.log(
    `${dishes.length} candidate dish(es) (${skipped} already migrated, skipped)` +
      `${USER ? ` · user=${USER}` : ""}${ONLY != null ? ` · only=${ONLY}` : ""}` +
      ` · apply=${APPLY} · concurrency=${CONCURRENCY}`,
  );

  const preview: PreviewRow[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < dishes.length) {
      await processDish(dishes[cursor++], preview);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(CONCURRENCY, dishes.length)) }, worker),
  );

  preview.sort((a, b) => a.id - b.id);
  console.log(
    `\nDone. ok=${stats.ok} no-refs=${stats.noRefs} guard-rejected=${stats.guardRejected} failed=${stats.failed}`,
  );

  if (!APPLY) {
    const out = `backfill-inline-refs-preview-${ONLY ?? USER ?? "all"}.json`;
    writeFileSync(out, JSON.stringify(preview, null, 2));
    console.log(`Dry run — wrote ${out}. Review, then re-run with --apply.`);
  } else {
    console.log("Applied.");
  }
  process.exit(0);
}

main();
