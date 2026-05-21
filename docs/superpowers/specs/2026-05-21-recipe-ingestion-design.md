# Recipe ingestion via claude-agent — design

Status: approved, ready for implementation planning
Date: 2026-05-21

## Goal

Reduce the data-entry friction for adding new dishes. Today, adding a dish means filling 8 fields per ingredient by hand in the admin form. With this feature, an admin can paste a recipe (free-text prompt, prose, URL, or photo) into a unified input and get the dish form pre-populated with a structured payload for review and save.

The parser is Anthropic's Claude, accessed through the existing claude-agent public API running on nex (`nex.tail7f6b96.ts.net`). The claude-agent API needs two additive extensions before this feature can be built.

## Architecture

```
┌──────────────────────────┐         ┌──────────────────────────────────┐
│  dinner-spinner (Vercel) │         │  claude-agent (nex, PM2)         │
│                          │         │                                  │
│  /admin/ingest UI        │         │  POST /api/v1/chat               │
│    └─ POST /api/ingest ──┼────────►│    { prompt,                     │
│         (server proxy)   │         │      images?: [{data,mediaType}],│
│                          │         │      response_schema?: JsonSch } │
│                          │         │      ↓                           │
│                          │         │    Anthropic SDK (image blocks   │
│                          │         │      + synthetic submit_result   │
│                          │         │      tool when schema present)   │
│                          │         │      ↓                           │
│         ▲                │         │    { response: "...",            │
│         │ {dish payload} │◄────────┼──    structured: {...validated}, │
│  /admin form prefill     │         │      cost_usd, turn_count }      │
│    └─ POST /api/dishes ──┼─►(DB)   │                                  │
│       (existing path)    │         └──────────────────────────────────┘
└──────────────────────────┘
```

Two projects, sequenced:

1. **Project A — claude-agent API extension** (in `~/claude-agent` repo). Adds `images` and `response_schema` to `POST /api/v1/chat`. Has its own brainstorming/spec/plan cycle in that repo. Must ship before Project B can be implemented.
2. **Project B — dinner-spinner ingest feature** (this spec). Consumes the extended claude-agent.

## Project A — claude-agent contract (prerequisite)

The only thing Project A must honor for Project B is the API contract below. Implementation lives in the claude-agent repo and is out of scope for this spec.

### `ChatRequest` additions

**`images?: Array<{ data: string; media_type: string }>`**

- `data`: base64-encoded image bytes.
- `media_type`: one of `image/jpeg`, `image/png`, `image/webp`, `image/gif` (Anthropic's supported set).
- Cardinality: v1 enforces max 1 (matches dinner-spinner's "one image per ingest" choice). Array shape leaves headroom for future consumers.
- Server-side: validate `media_type` allowlist, reject payloads above a hard cap of 10 MB per image (client compresses to under 1 MB anyway).
- Passed to the Anthropic SDK as content blocks alongside the prompt text:

  ```ts
  { role: "user", content: [
      { type: "image", source: { type: "base64", media_type, data } },
      { type: "text", text: prompt },
  ]}
  ```

**`response_schema?: JsonSchema`**

- When present, claude-agent defines a synthetic tool `submit_result` with `input_schema: response_schema`, sets `tool_choice: { type: "tool", name: "submit_result" }`, runs the call, and returns the tool's input as a new field on the response.
- When absent, behavior is unchanged.
- claude-agent does NOT re-validate `structured` against the schema (Anthropic enforces structurally; semantic validation is the caller's job).

### `ChatResponse` additions

**`structured?: object | null`**

- Present iff the call used `response_schema` and the model invoked the tool.
- Null if `response_schema` was sent but the model refused to use the tool (in which case the response also surfaces an error).

### Error case

If the model refuses to call the synthetic tool, claude-agent returns `502 schema_not_satisfied` in the existing error envelope shape, including the raw `response` text in the message for caller-side debugging.

### OpenAPI & smoke test

- Two new fields on `ChatRequest`, one new field on `ChatResponse`. Both additive — no breaking change for existing consumers.
- `scripts/smoke-test.sh` gains two assertions: one image round-trip ("describe this 1x1 pixel"), one schema round-trip ("return {foo: 'bar'}").

## Project B — dinner-spinner

### `/api/ingest` server route

**Route**: `POST /api/ingest` (Next 16 route handler in `app/api/ingest/route.ts`).

**Auth**: admin cookie or bearer `API_TOKEN`. Reuse the existing helpers in `lib/auth.ts` (same gate as `POST /api/dishes`).

**Request body**:

```ts
{
  input?: string;       // free text, recipe prose, or URL
  image?: {             // base64, already compressed client-side
    data: string;
    mediaType: "image/jpeg" | "image/png" | "image/webp";
  };
}
```

At least one of `input` or `image` must be present (Zod refinement).

**Flow**:

1. Build a prompt programmatically (see "Prompt construction" below), including the schema rules + the user's input.
2. Generate JSON Schema from the existing `DishInputSchema` (Zod) via `zod-to-json-schema`.
3. POST to `https://nex.tail7f6b96.ts.net:10000/chat` (Tailscale Funnel — note `/api/v1` prefix is stripped on the public URL, per nex's `CLAUDE.md`) with headers `Authorization: Bearer ${NEX_API_TOKEN}` and body:

   ```ts
   { prompt, images?: [image], response_schema: <DishInputJsonSchema> }
   ```

4. Receive `{ structured: <dishPayload> }` — re-validate with Zod `DishInputSchema` server-side (defense in depth; claude-agent doesn't do semantic validation).
5. Return `200 { dish: <validatedPayload> }` or an appropriate error envelope.

**Env vars added**:

- `NEX_API_TOKEN` — production secret. Mint a fresh token labeled `dinner-spinner` in the claude-agent dashboard with scope `chat`. Store in Vercel project env.

**Timeouts**:

- `fetch` timeout to claude-agent: 60s (first call is ~12s due to SDK startup).
- Set route-level `export const maxDuration = 60` in `route.ts` to bump above Vercel Hobby's 10s default.

**Errors**: see "Error handling" section below.

### `/admin/ingest` UI

**New route**: `app/admin/ingest/page.tsx` (client component). Already covered by `proxy.ts` admin matcher (`/admin/:path*`).

**UI elements**:

- Single textarea: "Paste a recipe, URL, or describe a dish".
- Image attach button + thumbnail preview when selected.
- "Ingest" button (disabled until at least one of textarea/image is populated).
- Loading state: ~12s spinner with "Reading your recipe…" copy.
- Error state: inline message + (when relevant) raw `response` text for debugging + "back to manual entry" link.

**Entry point**: a new "Ingest" button on the admin home (`app/admin/page.tsx`) next to the existing "Add dish" affordance. Clicking navigates to `/admin/ingest`.

**Client-side image compression** (before base64-ing):

- Load File → `createImageBitmap` → draw onto `<canvas>` resized to max 2048px (longest edge) → `canvas.toBlob({ type: 'image/jpeg', quality: 0.85 })` → base64.
- Reject input > 20 MB pre-compression (sanity guard).
- Output is consistently <1 MB; well under all body-size limits in the chain.

**On success — form pre-fill mechanism**:

1. Stash the returned `dish` payload in `sessionStorage` under key `dinner-spinner:ingest-draft`.
2. `router.push('/admin?fromIngest=1')`.
3. In `app/admin/page.tsx`, on mount: check `searchParams.get('fromIngest')`. If set, read `sessionStorage`, initialize the `draft` state from it, clear `sessionStorage`, replace the URL to drop the query param.
4. User sees the existing dish form pre-populated. They review, tweak, click Save. The existing `POST /api/dishes` path handles persistence + auto image generation.

Rationale for `sessionStorage` over query params: a parsed dish payload (full recipe, 20+ ingredients) can be 5–15 KB; URL hand-off would be ugly. `sessionStorage` is same-origin, same-tab — fine for this use case and survives the navigation cleanly.

**Cancel path**: closing the ingest page or hitting Back without ingesting persists nothing. No drafts in the database.

### Prompt construction

The `/api/ingest` route builds the prompt programmatically before sending to claude-agent. Single template, no Read-from-AGENTS.md tool calls (the rules live in dinner-spinner code; vocabulary auto-syncs by import).

**Inputs to the prompt builder**:

- `userInput: string | null` — textarea content.
- `hasImage: boolean` — adjusts the wording slightly when an image is attached.
- `pantryList: string[]` — fetched via `getPantryDefaults()` from `lib/pantry.ts` at request time (already in DB; no internal HTTP hop needed).
- `STANDARD_UNITS`, `STANDARD_INGREDIENTS` — imported from `lib/vocabulary.ts` (auto-syncs as the vocab grows).

**Prompt skeleton** (~1.5 KB rendered):

```
You parse cooking recipes into structured JSON for the Dinner Spinner app.

INPUT (recipe text, URL, free-text prompt, or an attached image — possibly several):
${userInput ?? "(see attached image)"}

If the input contains a URL, fetch it and read the recipe from the page.
If an image is attached, read the recipe text or ingredient list from it.

OUTPUT
Call the `submit_result` tool with a payload matching its schema.
DO NOT respond with prose. Use the tool.

RULES — ingredient parsing
- Split every ingredient into structured fields. Never cram everything into `name`.
- name = the bare purchasable thing, singular ("tomato", not "tomatoes"; "onion", not "onions").
- descriptor = size/quality affecting purchase ("small", "medium", "large", "ripe"). Never "fresh" — that's implied.
- preparation = cut/cook prep ("thinly sliced", "peeled and diced", "trimmed").
- Colour that changes the product stays in `name`: "green chili" ≠ "red chili"; "red pepper" ≠ "yellow pepper".
- Translate Dutch → English: "stuks" → "piece", "el" → "tbsp", "tl" → "tsp", "teentjes" → "clove", "uien" → "onion", "knoflook" → "garlic".

RULES — units (prefer one of these)
Weight: g, kg, oz, lb
Volume: ml, l, tsp, tbsp, cup, fl oz
Count: piece, clove, wedge, slice, sprig, leaf, head, bulb, stalk, bunch, handful, can, jar, bottle, pack
Imprecise: pinch, dash, splash, drizzle, to taste
Always singular ("clove", not "cloves").

RULES — standard ingredient names
Prefer these canonical names where applicable:
${STANDARD_INGREDIENTS.join(", ")}
If the recipe genuinely needs something not in this list (gochujang, tahini, sumac, nduja), use the literal name — don't force a bad mapping.

RULES — pantry flag
Set `pantry: true` for ingredients in this list (exact match or close semantic match like "cumin powder" → "cumin"):
${pantryList.join(", ")}
Use judgment for near-matches. Don't aggressively flag "smoked paprika" just because "paprika" might be in the list.
For "salt and black pepper to taste" → two ingredients, both `pantry: true`, `unit: "to taste"`, `quantity: 1`.

RULES — flags
- scalable: false for FIXED quantities regardless of servings (1 bay leaf, 1 cinnamon stick, 1 star anise, 1 stock cube). Default unset (= scalable).
- optional: true if the recipe says "optional", "to taste" (non-pantry), "to serve", "to garnish". Default unset (= required).
- alternatives: array of strings for "X or Y" — primary in `name`, alternatives listed. e.g. "butter or olive oil" → name: "butter", alternatives: ["olive oil"].

RULES — top-level dish fields
- title: short dish name.
- subtitle: 1-line description, only if the recipe context supports one. Skip if unclear.
- recipe: long-form cooking instructions in markdown, only if the input contained instructions. Skip if input was just an ingredient list or brief prompt.
- baseServings: number stated in the recipe. Default 4 if unstated.
- tags: infer obvious dietary/protein tags only — "vegetarian", "vegan", "chicken", "beef", "fish", "pasta", "rice", "soup", "curry", "stir fry", "salad", "dessert", "breakfast". Do NOT invent personal tags like "Finn likes this" or "weeknight".
- image_description: one short phrase describing the finished dish for image generation, e.g. "creamy mushroom pasta with parsley garnish on a creamware plate". Keep it visual and food-focused.

Now parse the input and call submit_result.
```

**Schema** sent as `response_schema`: derived at runtime from `lib/types.ts::DishInputSchema` via `zod-to-json-schema`. Single source of truth — the same schema that gates `POST /api/dishes`.

**Why this works for all four input shapes**:

- Free-text prompt ("Indian-style lentil curry for 4") — Claude composes a plausible recipe from training data.
- Pasted recipe text — Claude parses directly.
- URL — Claude uses its built-in WebFetch tool and reads the page.
- Photo — Claude vision reads the image (cookbook page, screenshot, ingredient list).

### New dependency

- `zod-to-json-schema` (~10 KB, no runtime deps).

## Error handling

Every error in the ingest UI shows: a short message, optional details, and a "back to manual entry" link that drops to the existing dish form.

| Stage | Failure | UI message | Recoverable? |
|---|---|---|---|
| Client validation | Empty input + no image | "Add some text or attach an image" | yes — disable button until valid |
| Image compression | File > 20 MB or unsupported type | "Image too large or unsupported format" | yes — pick a different image |
| `POST /api/ingest` (server) | claude-agent 401 (bad token) | "Ingestion misconfigured — contact admin" | no — env var fix needed |
| | claude-agent 429 `rate_limited` | "Daily ingest cap reached. Try after midnight UTC." | yes — wait + retry |
| | claude-agent 5xx / timeout | "Couldn't reach the parser. Try again in a moment." | yes — retry button |
| | claude-agent `schema_not_satisfied` | "Couldn't parse this — Claude didn't return valid output." Show raw `response` text for debugging. | yes — edit input + retry |
| Zod re-validate on dinner-spinner | Structured payload fails dinner-spinner's stricter rules | Same as above + show which field failed | yes — edit input + retry |
| Vercel function timeout (60s cap) | Genuinely stuck | "Took too long. Try again." | yes — retry |

**Retry mechanic**: on transient errors, the UI shows a "Retry" button that resubmits the same input. `session_id` is NOT reused — fresh call each time keeps the conversation clean.

**Audit / observability**:

- claude-agent already audits every request to `~/claude-agent/data/api-audit.jsonl` — covers the dinner-spinner side automatically.
- Dinner-spinner logs ingest attempts (success/fail, latency, `cost_usd`) to `console.log` — surfaces in Vercel logs. No new DB table.

**Auth fail-safe**: if `NEX_API_TOKEN` env var is missing, `/api/ingest` returns `503 ingest_disabled` immediately rather than calling claude-agent with no auth header.

## Out of scope (explicitly YAGNI for v1)

- **Multi-image ingest** — single image only; array shape leaves headroom.
- **Use uploaded photo as the dish image** — auto-gen still kicks in on save (existing flow). Most input photos will be cookbook pages, not appetizing dish shots, so reusing them as the dish image would usually be wrong. Add later as an opt-in toggle if desired.
- **Streaming the parse** — `/chat` supports SSE, but a 12s spinner is fine for this UX. Plain blocking call.
- **Multi-dish ingest** — one dish per request. Pasting a "30 weeknight dinners" article picks one.
- **Conversational refinement** — no "edit this with another prompt" loop. If the parse is wrong, user edits in the admin form (which is the whole point of review-before-save).
- **Caching identical inputs** — same recipe pasted twice parses twice. Not worth the cache infra for a personal admin tool.
- **OCR-only mode for trusted images** — always run through Claude even for clean text screenshots. Simplicity wins.
- **Auto-detect language and translate** — Claude handles non-English recipes natively; no separate translation step.
- **Webhook from external services** ("send recipe from Slack/email → ingest") — interesting but a separate feature.

## Testing surface

- **Unit**: prompt builder is a pure function; snapshot test the rendered prompt against representative inputs.
- **Unit**: `zod-to-json-schema` output for `DishInputSchema` — schema shape test (verify required fields, enum values land where expected).
- **Integration**: hit a mocked claude-agent (return canned `structured` payloads, including the error cases) and verify `/api/ingest` end-to-end mapping.
- **Manual smoke**: paste 3–5 recipe examples (one prose, one URL, one photo, one Dutch, one free-text-prompt) against the real claude-agent on nex post-deploy. Cost ~$0.025 total.

## Open questions

None — all design forks resolved during brainstorming. Implementation plan is the next step (via `superpowers:writing-plans`) once Project A ships and the API contract is live.
