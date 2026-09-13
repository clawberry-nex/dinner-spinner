# Debug a failed recipe ingest

Use this when Dinner Spinner reports `Parsed dish failed validation`. Nex kept
the model's exact structured result even though Dinner Spinner's second Zod
validation rejected it. Completed Nex jobs are recoverable for roughly 24 hours;
cleanup runs opportunistically when jobs are polled.

## 1. Find the Nex job id

Inspect recent job polls in the on-box audit log. Print only timestamp, path,
and status so token identifiers do not end up in terminals or notes:

```bash
tail -n 1000 /home/mirko/claude-agent/data/api-audit.jsonl \
  | jq -r 'select(.method == "GET" and (.path | startswith("/api/v1/jobs/"))) | [.ts, .path, .status] | @tsv'
```

Match the failure time and copy the id after `/api/v1/jobs/` into
`DINNER_JOB_ID`.

## 2. Fetch the original structured payload

Always pull the live Vercel production environment to temporary files. Do not
trust a cached `.env.production.local`, and never record a token value or prefix
in this runbook.

```bash
DINNER_ENV_FILE=$(mktemp)
export DINNER_PAYLOAD_FILE=$(mktemp)
cleanup_dinner_debug() {
  shred -u "$DINNER_ENV_FILE" "$DINNER_PAYLOAD_FILE"
}
trap cleanup_dinner_debug EXIT

vercel env pull "$DINNER_ENV_FILE" --environment=production --yes
set -a
. "$DINNER_ENV_FILE"
set +a

DINNER_JOB_ID='<job-id>'
curl -fsS \
  -H "Authorization: Bearer $NEX_API_TOKEN" \
  "http://127.0.0.1:4567/api/v1/jobs/$DINNER_JOB_ID" \
  | jq -e 'select(.status == "done" and .structured != null) | .structured' \
  > "$DINNER_PAYLOAD_FILE"
```

The job must have `status: "done"`; validation failures happen after
Nex completes, in `app/api/ingest/jobs/[id]/route.ts`. A 404 usually means the
job aged out or the token differs from the token that created it.

## 3. Show the exact schema violations

From the Dinner Spinner repository:

```bash
npx --yes tsx -e '
  import { readFileSync } from "node:fs";
  import { DishInputSchema } from "./lib/types.ts";
  const value = JSON.parse(readFileSync(process.env.DINNER_PAYLOAD_FILE!, "utf8"));
  const result = DishInputSchema.safeParse(value);
  console.dir(result.success ? result.data : result.error.issues, { depth: null });
  process.exit(result.success ? 0 : 1);
'
```

Fix the contract, prompt, or normalization boundary that owns the reported
field. Reproducing the complete call should be a fallback: use
`buildIngestPrompt`, `DISH_INPUT_JSON_SCHEMA`, and the same model selection as
`app/api/ingest/route.ts` so the reproduction does not silently test a different
pipeline.

## Model routing and fidelity evaluation

All recipe jobs explicitly use Nex's Codex provider. The service is still named
`claude-agent`, and `CLAUDE_AGENT_URL` remains its compatible URL override; neither
selects an Anthropic model. `lib/ingest/nex-agent.ts::RECIPE_MODELS` owns routing:

| Workload | Explicit model |
|---|---|
| Text/URL recipe parsing | `codex:gpt-5.6-sol` |
| Recipe photo transcription | `codex:gpt-6-astra` |
| Batch detection and per-recipe parsing | `codex:gpt-5.6-sol` |
| Translation/inline-reference backfill scripts | `codex:gpt-5.6-sol` |
| Generated dish photos (separate images API) | `gpt-image-2` |

The recipe client rejects missing and unsupported models before submission.
Nex supplies strict JSON output and native image attachments; prompts ask for
JSON directly. No `submit_result` tool or Anthropic fallback is used.

The model capabilities were checked against the official
[Sol model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[Astra model documentation](https://developers.openai.com/api/docs/models/gpt-6-astra),
and [Sol migration guidance](https://developers.openai.com/api/docs/guides/upgrading-to-gpt-5p6-sol).

After loading a **fresh production environment** as above, these opt-in commands
exercise the real Nex API without creating dishes or generating dish photos:

```bash
npx tsx scripts/eval-recipe-ingest.ts
npx tsx scripts/eval-recipe-ingest.ts --detect
npx tsx scripts/eval-recipe-ingest.ts --photo /path/to/chili-source.jpg
```

The photo mode expects an image of `lib/ingest/fixtures/chili-con-carne.txt`.
All modes write their output to gitignored `verify/openai-migration/`. The
fixture checks cover all 17 measured ingredients, teaspoon/tablespoon identity,
onion powder, canned/ground product forms, the fixed stock cube, optional toppings,
key method details, and valid ingredient-reference indices. Detection must preserve
two recipe chunks verbatim. These are regression evaluations, not a universal
runtime comparison of arbitrary recipes against their sources.

On 2026-09-13, live Sol text parsing completed in about 63 seconds, Sol detection
in 14 seconds, and Astra transcription of a rendered recipe image in 96 seconds;
all passed the fidelity checks. This verifies native image handling and legible
text extraction, not accuracy on every real-world camera photo.
