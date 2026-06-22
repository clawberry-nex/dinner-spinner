// scripts/backfill-translate-sections.ts
// One-shot (HISTORICAL, already run): re-ingest existing dishes through the
// ingest pipeline for translated method text, numbered steps, and ingredient
// sections. Safe by default — writes a preview and changes nothing.
// NOTE: superseded for ingredient↔method linking by scripts/backfill-inline-refs.ts
// (ADR-0001). This script REWRITES prose (re-ingest); the inline-refs backfill
// only inserts reference markers and leaves the wording untouched.
//
// Usage (env from .env.production.local for prod, or your local env):
//   node --env-file=.env.production.local scripts/backfill-translate-sections.ts            # dry-run all candidates
//   node --env-file=.env.production.local scripts/backfill-translate-sections.ts --only 48  # dry-run one dish
//   node --env-file=.env.production.local scripts/backfill-translate-sections.ts --apply    # write changes
//
// Requires: DATABASE_URL, NEX_API_TOKEN, (optional) CLAUDE_AGENT_URL.

import { sql } from "../lib/db.ts";
import { rowToDish, DishInputSchema } from "../lib/types.ts";
import { buildIngestPrompt } from "../lib/ingest/prompt.ts";
import { DISH_INPUT_JSON_SCHEMA } from "../lib/ingest/schema.ts";
import {
  startClaudeAgentJob,
  pollClaudeAgentJob,
} from "../lib/ingest/claude-agent.ts";
import { languageName } from "../lib/languages.ts";
import { writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? Number(process.argv[onlyIdx + 1]) : null;

// Typed string (not string|undefined) so the closure below sees a narrowed
// type; the guard still throws at runtime when unset/empty.
const token: string = process.env.NEX_API_TOKEN ?? "";
if (!token) throw new Error("NEX_API_TOKEN required");
const baseUrl =
  process.env.CLAUDE_AGENT_URL ?? "https://nex.tail7f6b96.ts.net:10000";

async function reingestOne(row: Record<string, unknown>) {
  const dish = rowToDish(row);
  const userId = row.user_id as string;
  // Query pantry_names directly — DON'T import lib/pantry.ts (it has
  // `import "server-only"`, which throws under plain node/tsx).
  const pantryRows = await sql`
    SELECT name FROM pantry_names WHERE user_id = ${userId}
  `;
  const pantry = pantryRows
    .map((r) => (r.name as string).toLowerCase())
    .sort();
  const langRows = await sql`
    SELECT default_language FROM users WHERE id = ${userId}
  `;
  const targetLanguage = languageName(
    (langRows[0]?.default_language as string | null) ?? null,
  );
  // Feed the existing recipe + title/subtitle back through ingest.
  const userInput = [
    `Title: ${dish.title}`,
    dish.subtitle ? `Subtitle: ${dish.subtitle}` : "",
    "",
    "Ingredients:",
    ...dish.ingredients.map(
      (i) =>
        `- ${i.quantity} ${i.unit ?? ""} ${i.descriptor ?? ""} ${i.name}${i.preparation ? ", " + i.preparation : ""}`.replace(/\s+/g, " ").trim(),
    ),
    "",
    "Method:",
    dish.recipe ?? "",
  ].join("\n");

  const prompt = buildIngestPrompt({ userInput, pantryList: pantry, targetLanguage });
  const job = await startClaudeAgentJob({
    prompt,
    responseSchema: DISH_INPUT_JSON_SCHEMA,
    token,
    baseUrl,
    // Haiku — matches the live ingest route; completes within claude-agent's
    // 8-turn structured-output budget where Sonnet exhausted it.
    model: "haiku",
  });
  // Poll until done.
  for (let i = 0; i < 120; i++) {
    const r = await pollClaudeAgentJob(job.jobId, { token, baseUrl });
    if (r.status === "done") {
      const parsed = DishInputSchema.safeParse(r.structured);
      if (!parsed.success) throw new Error("re-ingest failed validation");
      return { dish, next: parsed.data };
    }
    if (r.status === "failed") throw new Error(r.errorMessage ?? "job failed");
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("timed out");
}

async function main() {
  const rows = ONLY
    ? await sql`SELECT * FROM dishes WHERE id = ${ONLY}`
    : await sql`SELECT * FROM dishes WHERE method_refs IS NULL ORDER BY id`;
  console.log(`${rows.length} candidate dish(es). apply=${APPLY}`);

  const preview: unknown[] = [];
  for (const row of rows) {
    const id = row.id as number;
    try {
      const { dish, next } = await reingestOne(row);
      preview.push({
        id,
        before: { title: dish.title, recipe: dish.recipe, ingredients: dish.ingredients },
        after: { title: next.title, recipe: next.recipe, ingredients: next.ingredients },
      });
      console.log(`#${id} "${dish.title}" → "${next.title}"`);
      if (APPLY) {
        await sql`
          UPDATE dishes SET
            title = ${next.title},
            subtitle = ${next.subtitle ?? null},
            recipe = ${next.recipe ?? null},
            ingredients = ${JSON.stringify(next.ingredients)}::jsonb,
            updated_at = now()
          WHERE id = ${id}
        `;
      }
    } catch (err) {
      console.error(`#${id} FAILED:`, err instanceof Error ? err.message : err);
    }
  }

  if (!APPLY) {
    const out = `backfill-preview-${ONLY ?? "all"}.json`;
    writeFileSync(out, JSON.stringify(preview, null, 2));
    console.log(`\nDry run — wrote ${out}. Review, then re-run with --apply.`);
  } else {
    console.log("\nApplied.");
  }
  process.exit(0);
}

main();
