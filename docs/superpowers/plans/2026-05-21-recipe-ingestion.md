# Recipe Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only "Ingest" flow that turns a pasted prompt, recipe text, URL, or photo into a populated dish form via the claude-agent public API on nex.

**Architecture:** A new server route `POST /api/ingest` is a thin proxy that builds a prompt + JSON Schema and calls claude-agent `/chat` (Funnel `:10000`). The returned `structured` payload is re-validated with Zod and handed back to a new `/admin/ingest` client page. The page stashes the payload in `sessionStorage` and navigates to `/admin?fromIngest=1`, where the existing dish form hydrates from it for review-before-save. The existing `POST /api/dishes` save path (and its auto-image-gen) is unchanged.

**Tech Stack:** Next 16 App Router, TypeScript, Zod, `zod-to-json-schema` (new dep), Tailwind v4, `node:test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-21-recipe-ingestion-design.md`

---

## File structure

**New files:**

| Path | Responsibility |
|---|---|
| `lib/ingest/prompt.ts` | Pure function building the ingestion prompt from inputs + vocabulary. Server-only. |
| `lib/ingest/prompt.test.ts` | Snapshot-style tests for prompt rendering. |
| `lib/ingest/schema.ts` | Memoized JSON Schema derived from `DishInputSchema` via `zod-to-json-schema`. Server-only. |
| `lib/ingest/schema.test.ts` | Schema shape test (required fields, no `$ref` wrapping). |
| `lib/ingest/claude-agent.ts` | Typed client for `POST /chat`: fetch + timeout + error mapping. Server-only. Accepts an injectable `fetcher` for tests. |
| `lib/ingest/claude-agent.test.ts` | Tests against an injected mock fetcher. |
| `lib/image-compress.ts` | Browser-only: `File → 2048px JPEG q=0.85 → base64`. No automated test (DOM-dependent); manual smoke instead. |
| `app/api/ingest/route.ts` | `POST` handler. Auth, request validation, prompt build, claude-agent call, Zod re-validate, response envelope. `maxDuration = 60`. |
| `app/admin/ingest/page.tsx` | Client UI: unified textarea + image attach, submit, loading, error, success redirect. |

**Modified files:**

| Path | Change |
|---|---|
| `package.json` | Add `zod-to-json-schema` dep. |
| `lib/pantry.ts` | Export the existing private `getPantryDefaults` (rename: keep behavior, expose). |
| `app/admin/page.tsx` | Add "Ingest" link button in the dishes header; add `dishInputToDraft` helper and a hydration `useEffect` that consumes `sessionStorage` when `?fromIngest=1` is present. |

**Out of plan (per spec):** multi-image, photo-as-dish-image, streaming, multi-dish, conversational refinement, caching, OCR-only fast path, language detection, external webhooks.

---

## Prerequisites already satisfied

- Project A (claude-agent v1.39.0) ships `images` + `response_schema` on `POST /api/v1/chat`. Verified against `~/claude-agent/openapi.yaml` on 2026-05-21.
- `NEX_API_TOKEN` already present in Vercel production env (token id `nCNE-uyZVRMbfzjlH0RwW`, label `dinner-spinner`, scope `chat`). For local dev, set the same in `.env.local`.

---

### Task 1: Add `zod-to-json-schema` dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dep**

Run from the project root:
```bash
npm install zod-to-json-schema
```

- [ ] **Step 2: Verify it landed**

Run:
```bash
grep zod-to-json-schema package.json
```
Expected: a line under `"dependencies"` matching `"zod-to-json-schema": "^<version>"`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add zod-to-json-schema for ingest JSON Schema generation"
```

---

### Task 2: JSON Schema generator

Builds a flat JSON Schema for `DishInputSchema` that we can send as `response_schema` to claude-agent.

**Files:**
- Create: `lib/ingest/schema.ts`
- Create: `lib/ingest/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ingest/schema.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { DISH_INPUT_JSON_SCHEMA } from "./schema.ts";

test("schema is a flat object (no $ref wrapping)", () => {
  const s = DISH_INPUT_JSON_SCHEMA as Record<string, unknown>;
  assert.equal(s.type, "object");
  assert.ok(s.properties, "expected top-level `properties`");
  assert.equal(
    (s as { $ref?: unknown }).$ref,
    undefined,
    "schema should not wrap in $ref",
  );
});

test("schema marks title as required", () => {
  const s = DISH_INPUT_JSON_SCHEMA as { required?: string[] };
  assert.ok(s.required?.includes("title"), "title must be required");
});

test("schema declares an ingredients array of objects", () => {
  const s = DISH_INPUT_JSON_SCHEMA as {
    properties?: Record<string, { type?: string; items?: { type?: string } }>;
  };
  const ing = s.properties?.ingredients;
  assert.equal(ing?.type, "array");
  assert.equal(ing?.items?.type, "object");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test --experimental-strip-types --no-warnings lib/ingest/schema.test.ts
```
Expected: FAIL with "Cannot find module" or similar for `./schema.ts`.

- [ ] **Step 3: Implement `lib/ingest/schema.ts`**

```typescript
import "server-only";
import { zodToJsonSchema } from "zod-to-json-schema";
import { DishInputSchema } from "@/lib/types";

// `$refStrategy: "none"` inlines all nested schemas so the output is a
// single flat JSON Schema object — what Anthropic expects for a tool's
// `input_schema`. Without this, zod-to-json-schema emits
// `{ $ref, definitions: {...} }` which the tool-use API doesn't accept.
export const DISH_INPUT_JSON_SCHEMA = zodToJsonSchema(DishInputSchema, {
  $refStrategy: "none",
});
```

Note: `server-only` keeps this off the client bundle. `@/lib/types` is the existing path alias for the Zod schema.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test --experimental-strip-types --no-warnings lib/ingest/schema.test.ts
```
Expected: 3 passing tests, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/ingest/schema.ts lib/ingest/schema.test.ts
git commit -m "Add JSON Schema generator for ingest response_schema"
```

---

### Task 3: Prompt builder

Pure function. Renders the ingestion prompt with vocabulary and pantry interpolated.

**Files:**
- Create: `lib/ingest/prompt.ts`
- Create: `lib/ingest/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ingest/prompt.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIngestPrompt } from "./prompt.ts";

const FIXTURE = {
  userInput: "2 onions, 1 tbsp olive oil",
  pantryList: ["salt", "black pepper", "olive oil"],
};

test("includes the user input verbatim", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("2 onions, 1 tbsp olive oil"));
});

test("renders the pantry list", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("salt, black pepper, olive oil"));
});

test("references the submit_result tool", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("submit_result"));
});

test("when only an image is attached, prompts to read from the image", () => {
  const p = buildIngestPrompt({
    userInput: null,
    pantryList: ["salt"],
  });
  assert.ok(p.includes("(see attached image)"));
});

test("includes core ingredient parsing rules", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("singular"));
  assert.ok(p.includes("green chili"));
  assert.ok(/stuks.*piece/.test(p), "Dutch → English translation rule");
});

test("includes obvious-tag whitelist and forbids personal tags", () => {
  const p = buildIngestPrompt(FIXTURE);
  assert.ok(p.includes("vegetarian"));
  assert.ok(p.toLowerCase().includes("finn likes this"));
});

test("includes at least one standard ingredient name", () => {
  const p = buildIngestPrompt(FIXTURE);
  // STANDARD_INGREDIENTS contains "onion" — verify the auto-sync wiring.
  assert.ok(p.includes("onion"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test --experimental-strip-types --no-warnings lib/ingest/prompt.test.ts
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `lib/ingest/prompt.ts`**

```typescript
import "server-only";
import { STANDARD_INGREDIENTS } from "@/lib/vocabulary";

export interface IngestPromptInput {
  /** Free-text from the textarea: prompt, recipe prose, or URL. May be null when only an image is attached. */
  userInput: string | null;
  /** Pantry default names, lowercased. */
  pantryList: string[];
}

export function buildIngestPrompt(input: IngestPromptInput): string {
  const inputBody =
    input.userInput && input.userInput.trim().length > 0
      ? input.userInput.trim()
      : "(see attached image)";

  return `You parse cooking recipes into structured JSON for the Dinner Spinner app.

INPUT (recipe text, URL, free-text prompt, or an attached image — possibly several):
${inputBody}

If the input contains a URL, fetch it and read the recipe from the page.
If an image is attached, read the recipe text or ingredient list from it.

OUTPUT
Call the \`submit_result\` tool with a payload matching its schema.
DO NOT respond with prose. Use the tool.

RULES — ingredient parsing
- Split every ingredient into structured fields. Never cram everything into \`name\`.
- name = the bare purchasable thing, singular ("tomato", not "tomatoes"; "onion", not "onions").
- descriptor = size/quality affecting purchase ("small", "medium", "large", "ripe"). Never "fresh" — that's implied.
- preparation = cut/cook prep ("thinly sliced", "peeled and diced", "trimmed").
- Colour that changes the product stays in \`name\`: "green chili" ≠ "red chili"; "red pepper" ≠ "yellow pepper".
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
Set \`pantry: true\` for ingredients in this list (exact match or close semantic match like "cumin powder" → "cumin"):
${input.pantryList.join(", ")}
Use judgment for near-matches. Don't aggressively flag "smoked paprika" just because "paprika" might be in the list.
For "salt and black pepper to taste" → two ingredients, both \`pantry: true\`, \`unit: "to taste"\`, \`quantity: 1\`.

RULES — flags
- scalable: false for FIXED quantities regardless of servings (1 bay leaf, 1 cinnamon stick, 1 star anise, 1 stock cube). Default unset (= scalable).
- optional: true if the recipe says "optional", "to taste" (non-pantry), "to serve", "to garnish". Default unset (= required).
- alternatives: array of strings for "X or Y" — primary in \`name\`, alternatives listed. e.g. "butter or olive oil" → name: "butter", alternatives: ["olive oil"].

RULES — top-level dish fields
- title: short dish name.
- subtitle: 1-line description, only if the recipe context supports one. Skip if unclear.
- recipe: long-form cooking instructions in markdown, only if the input contained instructions. Skip if input was just an ingredient list or brief prompt.
- baseServings: number stated in the recipe. Default 4 if unstated.
- tags: infer obvious dietary/protein tags only — "vegetarian", "vegan", "chicken", "beef", "fish", "pasta", "rice", "soup", "curry", "stir fry", "salad", "dessert", "breakfast". Do NOT invent personal tags like "Finn likes this" or "weeknight".
- image_description: one short phrase describing the finished dish for image generation, e.g. "creamy mushroom pasta with parsley garnish on a creamware plate". Keep it visual and food-focused.

Now parse the input and call submit_result.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test --experimental-strip-types --no-warnings lib/ingest/prompt.test.ts
```
Expected: 7 passing tests, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/ingest/prompt.ts lib/ingest/prompt.test.ts
git commit -m "Add ingest prompt builder"
```

---

### Task 4: Claude-agent client

Wraps the `POST /chat` fetch call. Handles timeout, error mapping, and dependency-injects a `fetcher` for testability.

**Files:**
- Create: `lib/ingest/claude-agent.ts`
- Create: `lib/ingest/claude-agent.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/ingest/claude-agent.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { callClaudeAgent, ClaudeAgentError } from "./claude-agent.ts";

const SCHEMA = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("returns parsed `structured` on a 200", async () => {
  const fetcher = async () =>
    jsonResponse({
      session_id: "abc",
      response: "",
      structured: { title: "Pasta" },
      cost_usd: 0.005,
      turn_count: 1,
    });
  const out = await callClaudeAgent(
    {
      prompt: "p",
      responseSchema: SCHEMA,
      token: "nxk_test",
      baseUrl: "http://mock.test",
    },
    { fetcher },
  );
  assert.deepEqual(out.structured, { title: "Pasta" });
});

test("sends the expected request body", async () => {
  let captured: { url?: string; body?: unknown; auth?: string | null } = {};
  const fetcher: typeof fetch = async (input, init) => {
    captured.url = String(input);
    captured.body = JSON.parse(String(init?.body ?? "{}"));
    const headers = new Headers(init?.headers);
    captured.auth = headers.get("authorization");
    return jsonResponse({
      session_id: "x",
      response: "",
      structured: { title: "x" },
      cost_usd: 0,
      turn_count: 1,
    });
  };
  await callClaudeAgent(
    {
      prompt: "hello",
      responseSchema: SCHEMA,
      image: { data: "AAAA", mediaType: "image/jpeg" },
      token: "nxk_test",
      baseUrl: "http://mock.test",
    },
    { fetcher },
  );
  assert.equal(captured.url, "http://mock.test/chat");
  assert.equal(captured.auth, "Bearer nxk_test");
  assert.deepEqual(captured.body, {
    prompt: "hello",
    response_schema: SCHEMA,
    images: [{ data: "AAAA", media_type: "image/jpeg" }],
  });
});

test("throws ClaudeAgentError with `schema_not_satisfied` on 502", async () => {
  const fetcher = async () =>
    jsonResponse(
      { error: { code: "schema_not_satisfied", message: "agent did not call tool" } },
      502,
    );
  await assert.rejects(
    () =>
      callClaudeAgent(
        { prompt: "x", responseSchema: SCHEMA, token: "t", baseUrl: "http://x" },
        { fetcher },
      ),
    (err: unknown) => {
      assert.ok(err instanceof ClaudeAgentError);
      assert.equal(err.code, "schema_not_satisfied");
      assert.equal(err.status, 502);
      return true;
    },
  );
});

test("throws ClaudeAgentError with `rate_limited` on 429", async () => {
  const fetcher = async () =>
    new Response(
      JSON.stringify({ error: { code: "rate_limited", message: "cap reached" } }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": "12345" } },
    );
  await assert.rejects(
    () =>
      callClaudeAgent(
        { prompt: "x", responseSchema: SCHEMA, token: "t", baseUrl: "http://x" },
        { fetcher },
      ),
    (err: unknown) => {
      assert.ok(err instanceof ClaudeAgentError);
      assert.equal(err.code, "rate_limited");
      assert.equal(err.retryAfter, 12345);
      return true;
    },
  );
});

test("throws ClaudeAgentError with `bad_response` when structured is missing", async () => {
  const fetcher = async () =>
    jsonResponse({ session_id: "x", response: "no schema used", cost_usd: 0, turn_count: 1 });
  await assert.rejects(
    () =>
      callClaudeAgent(
        { prompt: "x", responseSchema: SCHEMA, token: "t", baseUrl: "http://x" },
        { fetcher },
      ),
    (err: unknown) => {
      assert.ok(err instanceof ClaudeAgentError);
      assert.equal(err.code, "bad_response");
      return true;
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --test --experimental-strip-types --no-warnings lib/ingest/claude-agent.test.ts
```
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement `lib/ingest/claude-agent.ts`**

```typescript
import "server-only";

export type ClaudeAgentErrorCode =
  | "unauthorized"
  | "scope_missing"
  | "rate_limited"
  | "queue_full"
  | "disabled"
  | "not_found"
  | "validation"
  | "agent_error"
  | "schema_not_satisfied"
  | "bad_response"
  | "network_error"
  | "timeout";

export class ClaudeAgentError extends Error {
  code: ClaudeAgentErrorCode;
  status: number | null;
  retryAfter: number | null;
  rawResponse: string | null;

  constructor(opts: {
    code: ClaudeAgentErrorCode;
    message: string;
    status?: number | null;
    retryAfter?: number | null;
    rawResponse?: string | null;
  }) {
    super(opts.message);
    this.name = "ClaudeAgentError";
    this.code = opts.code;
    this.status = opts.status ?? null;
    this.retryAfter = opts.retryAfter ?? null;
    this.rawResponse = opts.rawResponse ?? null;
  }
}

export interface CallArgs {
  prompt: string;
  responseSchema: object;
  image?: { data: string; mediaType: string };
  token: string;
  baseUrl: string;
  /** ms; default 60000. */
  timeoutMs?: number;
}

export interface CallResult {
  structured: unknown;
  costUsd: number | null;
  rawResponse: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function callClaudeAgent(
  args: CallArgs,
  opts: { fetcher?: typeof fetch } = {},
): Promise<CallResult> {
  const fetcher = opts.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await fetcher(`${args.baseUrl}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify({
        prompt: args.prompt,
        response_schema: args.responseSchema,
        ...(args.image
          ? { images: [{ data: args.image.data, media_type: args.image.mediaType }] }
          : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new ClaudeAgentError({
        code: "timeout",
        message: `claude-agent did not respond within ${args.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
      });
    }
    throw new ClaudeAgentError({
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  clearTimeout(timeout);

  const body = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string }; structured?: unknown; response?: string; cost_usd?: number | null }
    | null;

  if (!res.ok) {
    const code = (body?.error?.code as ClaudeAgentErrorCode) ?? "agent_error";
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;
    throw new ClaudeAgentError({
      code,
      message: body?.error?.message ?? `claude-agent ${res.status}`,
      status: res.status,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
      rawResponse: body?.response ?? null,
    });
  }

  if (!body || body.structured === undefined || body.structured === null) {
    throw new ClaudeAgentError({
      code: "bad_response",
      message: "claude-agent returned no `structured` field",
      status: res.status,
      rawResponse: body?.response ?? null,
    });
  }

  return {
    structured: body.structured,
    costUsd: body.cost_usd ?? null,
    rawResponse: body.response ?? "",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
node --test --experimental-strip-types --no-warnings lib/ingest/claude-agent.test.ts
```
Expected: 5 passing tests, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/ingest/claude-agent.ts lib/ingest/claude-agent.test.ts
git commit -m "Add claude-agent /chat client wrapper for ingest"
```

---

### Task 5: Export `getPantryDefaults` from `lib/pantry.ts`

Tiny enabler: the route needs the pantry list as a sorted array for the prompt builder, and the current helper is private.

**Files:**
- Modify: `lib/pantry.ts:11`

- [ ] **Step 1: Add `export` keyword to the existing function**

Change line 11 of `lib/pantry.ts` from:
```typescript
async function getPantryDefaults(): Promise<Set<string>> {
```
to:
```typescript
export async function getPantryDefaults(): Promise<Set<string>> {
```

- [ ] **Step 2: Verify the project still typechecks**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors (the change is purely additive — nothing else needs to change).

- [ ] **Step 3: Commit**

```bash
git add lib/pantry.ts
git commit -m "Export getPantryDefaults for ingest prompt builder"
```

---

### Task 6: `POST /api/ingest` server route

Orchestrates auth, validation, prompt + schema build, claude-agent call, Zod re-validate, and error mapping.

**Files:**
- Create: `app/api/ingest/route.ts`

- [ ] **Step 1: Implement the route**

Create `app/api/ingest/route.ts`:

```typescript
import { cookies } from "next/headers";
import { z } from "zod";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { DishInputSchema } from "@/lib/types";
import { getPantryDefaults } from "@/lib/pantry";
import { buildIngestPrompt } from "@/lib/ingest/prompt";
import { DISH_INPUT_JSON_SCHEMA } from "@/lib/ingest/schema";
import { callClaudeAgent, ClaudeAgentError } from "@/lib/ingest/claude-agent";

// claude-agent's first call is ~12s; allow comfortable headroom on top of
// Vercel Hobby's 10s default.
export const maxDuration = 60;

const CLAUDE_AGENT_BASE_URL =
  process.env.CLAUDE_AGENT_URL ?? "https://nex.tail7f6b96.ts.net:10000";

const IngestRequestSchema = z
  .object({
    input: z.string().trim().min(1).max(50_000).optional(),
    image: z
      .object({
        data: z.string().min(1).max(15_000_000), // base64 cap ~15MB
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      })
      .optional(),
  })
  .refine((v) => v.input || v.image, {
    message: "Provide `input`, `image`, or both",
  });

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

function errorEnvelope(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (!(await isAuthorized(request))) {
    return errorEnvelope("unauthorized", "Unauthorized", 401);
  }

  const token = process.env.NEX_API_TOKEN;
  if (!token) {
    return errorEnvelope(
      "ingest_disabled",
      "Recipe ingestion is not configured (NEX_API_TOKEN missing).",
      503,
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorEnvelope("validation", "Body must be JSON", 400);
  }
  const parsed = IngestRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorEnvelope("validation", parsed.error.message, 400);
  }
  const { input, image } = parsed.data;

  const pantrySet = await getPantryDefaults();
  const pantryList = Array.from(pantrySet).sort();
  const prompt = buildIngestPrompt({
    userInput: input ?? null,
    pantryList,
  });

  const t0 = Date.now();
  let result;
  try {
    result = await callClaudeAgent({
      prompt,
      responseSchema: DISH_INPUT_JSON_SCHEMA,
      image,
      token,
      baseUrl: CLAUDE_AGENT_BASE_URL,
    });
  } catch (err) {
    if (err instanceof ClaudeAgentError) {
      // Map claude-agent codes to upstream-facing statuses.
      const status =
        err.code === "rate_limited" || err.code === "queue_full"
          ? 429
          : err.code === "timeout"
            ? 504
            : err.code === "unauthorized" || err.code === "scope_missing"
              ? 502 // misconfig from our side — surface as upstream issue
              : 502;
      console.error("[ingest] claude-agent failure", {
        code: err.code,
        status: err.status,
        rawResponse: err.rawResponse,
      });
      return errorEnvelope(err.code, err.message, status, {
        rawResponse: err.rawResponse,
        retryAfter: err.retryAfter,
      });
    }
    console.error("[ingest] unexpected failure", err);
    return errorEnvelope("agent_error", "Unexpected ingest failure", 500);
  }

  // Defense in depth: re-validate the structured payload against the
  // canonical Zod schema before handing it to the client. claude-agent
  // enforces JSON Schema structurally but not semantically (e.g. string
  // length, enum-like constraints).
  const validated = DishInputSchema.safeParse(result.structured);
  if (!validated.success) {
    console.error("[ingest] Zod re-validate failed", {
      issues: validated.error.issues,
      structured: result.structured,
    });
    return errorEnvelope(
      "bad_response",
      "Parsed dish failed validation",
      502,
      { issues: validated.error.issues, structured: result.structured },
    );
  }

  console.log("[ingest] ok", {
    latencyMs: Date.now() - t0,
    costUsd: result.costUsd,
    title: validated.data.title,
  });

  return Response.json({ dish: validated.data });
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. (If `RouteContext` complains, run `npx next typegen` first per `AGENTS.md`.)

- [ ] **Step 3: Smoke-test the route against the live claude-agent**

Start the dev server in one terminal:
```bash
npm run dev
```

In another terminal, with `NEX_API_TOKEN` and `API_TOKEN` set in `.env.local`, run:
```bash
source .env.local 2>/dev/null || true
curl -sS -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"input":"Quick weeknight tomato pasta: 400g spaghetti, 1 can chopped tomatoes, 3 cloves garlic, salt and pepper. Serves 2."}' \
  | jq '.dish | {title, baseServings, tags, ingredientCount: (.ingredients | length)}'
```
Expected: a JSON `dish` envelope with `title`, `tags`, and at least 4 ingredients. Total wall time ~12s on a cold call, ~2s on subsequent calls.

If you see `"code":"ingest_disabled"` → `NEX_API_TOKEN` not in `.env.local`.
If you see `"code":"unauthorized"` from `/api/ingest` itself → `API_TOKEN` mismatch in your bearer.

- [ ] **Step 4: Commit**

```bash
git add app/api/ingest/route.ts
git commit -m "Add POST /api/ingest server route"
```

---

### Task 7: Client-side image compression

Browser utility. Loads a `File`, resizes to max 2048px longest edge, encodes JPEG q=0.85, returns base64.

**Files:**
- Create: `lib/image-compress.ts`

- [ ] **Step 1: Implement the utility**

Create `lib/image-compress.ts`:

```typescript
const MAX_RAW_BYTES = 20 * 1024 * 1024; // 20MB pre-compression sanity cap
const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;
const SUPPORTED_INPUT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);

export interface CompressedImage {
  /** Base64 string (no `data:` prefix). */
  data: string;
  /** Always `image/jpeg` after compression. */
  mediaType: "image/jpeg";
}

export async function compressImage(file: File): Promise<CompressedImage> {
  if (file.size > MAX_RAW_BYTES) {
    throw new Error(
      `Image too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 20MB).`,
    );
  }
  if (!SUPPORTED_INPUT_TYPES.has(file.type)) {
    throw new Error(`Unsupported image type: ${file.type || "unknown"}.`);
  }

  // ImageBitmap respects EXIF orientation in modern browsers when given
  // `imageOrientation: "from-image"`. createImageBitmap is the only
  // documented portable path that handles HEIC/HEIF on iOS Safari.
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Failed to encode JPEG.");

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const data = btoa(binary);

  return { data, mediaType: "image/jpeg" };
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/image-compress.ts
git commit -m "Add client-side image compression utility for ingest"
```

(No automated test — `createImageBitmap` / `document.createElement` require a browser DOM. Manual smoke happens in Task 8 once the UI exists.)

---

### Task 8: `/admin/ingest` UI page

The user-facing ingest page. Unified textarea + image attach, submit button, loading/error states, success redirect.

**Files:**
- Create: `app/admin/ingest/page.tsx`

- [ ] **Step 1: Implement the page**

Create `app/admin/ingest/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage, type CompressedImage } from "@/lib/image-compress";
import { AppHeader } from "../../_components/app-header";
import { Button } from "../../_components/ui";

const SESSION_KEY = "dinner-spinner:ingest-draft";

export default function IngestPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [compressedPreviewUrl, setCompressedPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<string | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setCompressedPreviewUrl(f ? URL.createObjectURL(f) : null);
    setError(null);
  }

  function clearFile() {
    setFile(null);
    if (compressedPreviewUrl) URL.revokeObjectURL(compressedPreviewUrl);
    setCompressedPreviewUrl(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() && !file) return;
    setLoading(true);
    setError(null);
    setRawResponse(null);

    try {
      let image: CompressedImage | undefined;
      if (file) image = await compressImage(file);

      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: input.trim() || undefined,
          image,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        dish?: unknown;
        error?: { code?: string; message?: string; rawResponse?: string | null };
      };
      if (!res.ok || !body.dish) {
        setError(body.error?.message ?? `Ingest failed (${res.status})`);
        setRawResponse(body.error?.rawResponse ?? null);
        return;
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(body.dish));
      router.push("/admin?fromIngest=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected failure");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = (input.trim().length > 0 || file !== null) && !loading;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-4">
      <AppHeader />
      <h1 className="mb-4 text-2xl font-semibold">Ingest a recipe</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Paste a recipe, a URL, or describe a dish in your own words. Optionally
        attach a photo (a cookbook page, a recipe screenshot, an ingredient
        list). Claude will parse it; you&apos;ll review the result in the
        normal dish form before saving.
      </p>

      <form onSubmit={submit} className="space-y-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={10}
          placeholder="Paste a recipe, URL, or describe a dish…"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          disabled={loading}
        />

        <div className="space-y-2">
          <label className="block text-sm font-medium">Attach photo (optional)</label>
          <input
            type="file"
            accept="image/*"
            onChange={onFile}
            disabled={loading}
            className="block w-full text-sm"
          />
          {compressedPreviewUrl && (
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={compressedPreviewUrl}
                alt="attached"
                className="max-h-48 rounded-md border border-zinc-300 dark:border-zinc-700"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFile}
                disabled={loading}
              >
                Remove
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={!canSubmit}>
            {loading ? "Reading your recipe…" : "Ingest →"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/admin")}
            disabled={loading}
          >
            Cancel
          </Button>
        </div>

        {error && (
          <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <p>{error}</p>
            {rawResponse && (
              <details>
                <summary className="cursor-pointer text-xs underline">
                  Show raw response
                </summary>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs">
                  {rawResponse}
                </pre>
              </details>
            )}
            <p className="text-xs">
              <a href="/admin" className="underline">
                Back to manual entry
              </a>
            </p>
          </div>
        )}
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. (Run `npx next typegen` first if it complains about generated types.)

- [ ] **Step 3: Commit**

```bash
git add app/admin/ingest/page.tsx
git commit -m "Add /admin/ingest UI with image attach + compression"
```

(Form pre-fill on `/admin` is wired up in Task 9 — until then, submitting still stores to sessionStorage and navigates, but `/admin` won't hydrate from it.)

---

### Task 9: Admin home — Ingest button + form pre-fill hydration

Two changes to `app/admin/page.tsx`: an "Ingest" entry-point button, and a `useEffect` that consumes `sessionStorage` when `?fromIngest=1` is present.

**Files:**
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: Add `dishInputToDraft` helper near the existing `dishToDraft`**

In `app/admin/page.tsx`, find the existing `dishToDraft` function (around line 69) and add this new function immediately after it (before `draftToPayload`):

```typescript
function dishInputToDraft(d: import("@/lib/types").DishInput): Draft {
  return {
    id: null,
    title: d.title,
    subtitle: d.subtitle ?? "",
    recipe: d.recipe ?? "",
    notes: d.notes ?? "",
    tagsInput: (d.tags ?? []).join(", "),
    baseServings: String(d.baseServings ?? 4),
    imageUrl: d.imageUrl ?? "",
    imageDescription: d.imageDescription ?? "",
    emoji: d.emoji ?? "",
    accent: d.accent ?? "",
    favorite: d.favorite ?? false,
    ingredients:
      (d.ingredients ?? []).length > 0
        ? d.ingredients!.map((i) => ({
            quantity: String(i.quantity),
            unit: i.unit ?? "",
            descriptor: i.descriptor ?? "",
            name: i.name,
            preparation: i.preparation ?? "",
            pantry: !!i.pantry,
            fixed: i.scalable === false,
            optional: !!i.optional,
            alternativesInput: (i.alternatives ?? []).join(", "),
          }))
        : [{ ...EMPTY_INGREDIENT }],
  };
}
```

- [ ] **Step 2: Add the hydration effect**

In `app/admin/page.tsx`, find the existing mount effect (around line 406):

```typescript
useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect
  reload().catch(() => {});
}, []);
```

Add a **second** `useEffect` immediately after it:

```typescript
useEffect(() => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("fromIngest") !== "1") return;
  const raw = window.sessionStorage.getItem("dinner-spinner:ingest-draft");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as import("@/lib/types").DishInput;
    setDraft(dishInputToDraft(parsed));
  } catch {
    // Bad JSON in sessionStorage is non-fatal — just leave the draft empty.
  }
  window.sessionStorage.removeItem("dinner-spinner:ingest-draft");
  url.searchParams.delete("fromIngest");
  window.history.replaceState({}, "", url.toString());
}, []);
```

- [ ] **Step 3: Add the Ingest button**

Find the "All dishes" header (around line 960):

```tsx
<h2 className="text-xl font-semibold">All dishes ({dishes.length})</h2>
```

Wrap it (or sit next to it) with the Ingest link. Replace that one line and any sibling layout container as needed to render this:

```tsx
<div className="flex items-center justify-between gap-3">
  <h2 className="text-xl font-semibold">All dishes ({dishes.length})</h2>
  <Button asChild variant="secondary" size="sm">
    <a href="/admin/ingest">Ingest →</a>
  </Button>
</div>
```

If the project's `Button` doesn't support `asChild`, use a plain styled anchor instead:

```tsx
<a
  href="/admin/ingest"
  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
>
  Ingest →
</a>
```

- [ ] **Step 4: Typecheck**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/admin/page.tsx
git commit -m "Wire /admin Ingest button + form pre-fill from sessionStorage"
```

---

### Task 10: Manual smoke test

Validate the end-to-end flow against the real claude-agent and the real dinner-spinner UI in dev.

- [ ] **Step 1: Ensure env is set in `.env.local`**

Required:
- `NEX_API_TOKEN=nxk_…` (minted, scope `chat`, label `dinner-spinner`)
- `API_TOKEN=…` (existing — same value as in Vercel production)
- `DATABASE_URL=…` (existing)

If `NEX_API_TOKEN` is missing locally, mint a separate dev token from claude-agent's "API Tokens" tab, or copy the prod value temporarily.

- [ ] **Step 2: Start dev server**

```bash
npm run dev
```

- [ ] **Step 3: Smoke each input type**

Open `http://localhost:3000/admin`, log in if needed, click "Ingest →". For each case below: submit, wait, confirm the admin form pre-fills correctly, then click Cancel/Reset (do NOT save unless you want the dish in your DB).

1. **Free-text prompt**: "Thai green chicken curry for 4, weeknight friendly"
   - Expected: dish with chicken thigh / breast, green curry paste, coconut milk, etc. `baseServings: 4`. Tags include `chicken` and `curry`.

2. **Pasted recipe text**: paste a full recipe from a cookbook including ingredient list and steps.
   - Expected: `recipe` field populated with markdown steps, ingredients structured with descriptor/preparation split.

3. **URL**: paste a public recipe URL (e.g. a BBC Good Food page).
   - Expected: dish parsed from the page — `title` matches the page, ingredients structured. May be slower (claude-agent uses WebFetch).

4. **Photo**: attach a phone photo of a cookbook page.
   - Expected: image compresses (preview thumbnail looks reasonable), parse succeeds, ingredients match the page.

5. **Dutch**: paste a Dutch recipe with "stuks", "el", "teentjes".
   - Expected: units normalize to "piece", "tbsp", "clove"; names normalize to English singulars.

- [ ] **Step 4: Smoke the error paths**

1. Submit with empty input and no image → Ingest button stays disabled (no API call made).
2. Attach a >20MB raw image → expect a client-side error before submission.
3. Temporarily remove `NEX_API_TOKEN` from `.env.local`, restart dev, submit → expect `ingest_disabled` error in the UI.

- [ ] **Step 5: Document the smoke results in the commit (no code change)**

```bash
git commit --allow-empty -m "Smoke-test recipe ingestion (5 input types + 3 error paths)"
```

---

## Deployment

After Task 10 passes, push to `main`. Vercel auto-deploys. `NEX_API_TOKEN` is already in the Vercel production env. After deploy, the curl/UI test from Task 6 Step 3 can be re-run against `https://dinner-spinner-lake.vercel.app/api/ingest` for a final production smoke.

## Notes for future iterations (NOT this plan)

- If the ~12s first-call latency is annoying, switch to SSE streaming (`Accept: text/event-stream`) so the UI can show progress.
- If users routinely attach dish photos rather than recipe pages, add a toggle to use the upload as the dish image instead of auto-generating.
- Multi-image (e.g. cookbook spreads) → bump the array to N>1 once claude-agent allows it.
