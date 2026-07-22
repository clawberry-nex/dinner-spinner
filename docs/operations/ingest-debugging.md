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
