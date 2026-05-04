# AI dish-photo generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a provider-agnostic image-gen pipeline so a future model URL can be slotted in via two env vars, with admin-form per-dish generation and a bulk backfill action.

**Architecture:** Three thin pure modules — prompt builder, provider abstraction (HTTP / stub), Blob storage — wired by two new API route handlers (`POST /api/dishes/[id]/image`, `POST /api/dishes/images/backfill`). The `dishes.image_url` column already exists and `DishArt` already prefers it over the placeholder, so no schema or rendering changes are needed.

**Tech Stack:** Next.js 16 App Router · TypeScript · Neon Postgres (`@neondatabase/serverless`) · Vercel Blob (`@vercel/blob`) · `node --experimental-strip-types --test` for unit tests · Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-04-ai-dish-photos-design.md`

---

## Task 1: House-style prompt builder

**Files:**
- Create: `lib/image-prompt.ts`
- Test: `lib/image-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/image-prompt.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImagePrompt, IMAGE_STYLE_PREAMBLE } from "./image-prompt.ts";

test("buildImagePrompt always starts with the house-style preamble", () => {
  const prompt = buildImagePrompt({ title: "Bobotie", subtitle: null });
  assert.ok(prompt.startsWith(IMAGE_STYLE_PREAMBLE), "preamble must lead the prompt");
});

test("buildImagePrompt appends title when no subtitle", () => {
  const prompt = buildImagePrompt({ title: "Bobotie", subtitle: null });
  // The dish description should contain the title at minimum.
  assert.match(prompt, /Bobotie/);
});

test("buildImagePrompt appends title + subtitle when both present", () => {
  const prompt = buildImagePrompt({
    title: "Bobotie",
    subtitle: "South African spiced mince bake with a creamy egg custard topping",
  });
  assert.match(prompt, /Bobotie/);
  assert.match(prompt, /South African spiced mince bake/);
});

test("buildImagePrompt trims whitespace and ignores empty subtitles", () => {
  const a = buildImagePrompt({ title: "  Bobotie  ", subtitle: "   " });
  const b = buildImagePrompt({ title: "Bobotie", subtitle: null });
  assert.equal(a, b, "whitespace-only subtitle should behave like null");
});

test("buildImagePrompt does not produce double-spaces or trailing whitespace", () => {
  const prompt = buildImagePrompt({
    title: "Gnocchi with Mushrooms",
    subtitle: "Spinach and walnut, 30-minute weeknight",
  });
  assert.doesNotMatch(prompt, /  /, "no double spaces");
  assert.equal(prompt, prompt.trim(), "no leading/trailing whitespace");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test lib/image-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/image-prompt.ts`:

```ts
import type { Dish } from "./types.ts";

// House-style preamble — the strict visual rules every generated image
// must obey. Iterate this copy in git; the dish-specific tail just names
// what's on the plate.
//
// Keep it as one paragraph. Most image models weight the front of the
// prompt more heavily, so the framing/lighting/palette rules go first
// and the dish description trails.
export const IMAGE_STYLE_PREAMBLE = [
  "Photorealistic editorial food photography.",
  "Square 1:1 crop, top-down overhead angle.",
  "A single serving plated on a matte off-white ceramic plate, centered.",
  "The plate rests on a textured dark linen tablecloth in muted earth tones.",
  "Soft, diffused northern daylight from the upper-left,",
  "gentle natural shadows, no harsh highlights, no studio glare.",
  "One piece of brushed-steel cutlery beside the plate (fork or spoon as appropriate),",
  "and a small folded linen napkin in a muted earth tone partially under the plate.",
  "Restrained styling, sparse composition, no garnish-spam.",
  "No text, no logos, no watermarks, no human hands, no labels.",
  "Cookbook editorial restraint, color palette warm and earthy.",
].join(" ");

export function buildImagePrompt(
  dish: Pick<Dish, "title" | "subtitle">,
): string {
  const title = dish.title.trim();
  const subtitle = dish.subtitle?.trim();
  const description = subtitle ? `${title} — ${subtitle}` : title;
  return `${IMAGE_STYLE_PREAMBLE} The dish: ${description}.`;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --experimental-strip-types --test lib/image-prompt.test.ts`
Expected: PASS — 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/image-prompt.ts lib/image-prompt.test.ts
git commit -m "Add house-style image prompt builder"
```

---

## Task 2: Provider interface + stub + factory

**Files:**
- Create: `lib/image-provider.ts`
- Test: `lib/image-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/image-provider.test.ts`:

```ts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

beforeEach(() => {
  delete process.env.IMAGE_GEN_URL;
  delete process.env.IMAGE_GEN_TOKEN;
});

test("getProvider returns the stub when env is missing", async () => {
  // Re-import per test so module-load-time decisions can't sneak in.
  const { getProvider } = await import(`./image-provider.ts?cb=${Date.now()}`);
  const p = getProvider();
  await assert.rejects(
    () => p.generate("anything"),
    /image generation not configured/,
  );
});

test("getProvider returns the stub when only one of the two env vars is set", async () => {
  process.env.IMAGE_GEN_URL = "https://example.test/img";
  // IMAGE_GEN_TOKEN intentionally unset
  const { getProvider } = await import(`./image-provider.ts?cb=${Date.now() + 1}`);
  const p = getProvider();
  await assert.rejects(
    () => p.generate("anything"),
    /image generation not configured/,
  );
});

test("getProvider returns the http provider when both env vars are set", async () => {
  process.env.IMAGE_GEN_URL = "https://example.test/img";
  process.env.IMAGE_GEN_TOKEN = "secret-token";
  const { getProvider, HttpProvider } = await import(
    `./image-provider.ts?cb=${Date.now() + 2}`
  );
  const p = getProvider();
  assert.ok(p instanceof HttpProvider, "should be HttpProvider");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test lib/image-provider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/image-provider.ts`:

```ts
// Provider abstraction for AI image generation. The factory picks
// between a stub (throws a helpful "not configured" message) and the
// HTTP provider (POSTs to a configured URL with a bearer token).
//
// Adding a new provider — or tweaking the request shape of HttpProvider
// for a specific service — is the only place that needs to change when
// the actual generation URL is wired in.

export interface ImageProvider {
  generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }>;
}

const NOT_CONFIGURED =
  "image generation not configured: set IMAGE_GEN_URL and IMAGE_GEN_TOKEN in env";

export class StubProvider implements ImageProvider {
  async generate(_prompt: string): Promise<{ bytes: Uint8Array; mime: string }> {
    throw new Error(NOT_CONFIGURED);
  }
}

export class HttpProvider implements ImageProvider {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  async generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `image provider returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const contentType = res.headers.get("content-type") ?? "";
    // Shape A: server streams the image directly.
    if (contentType.startsWith("image/")) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return { bytes: buf, mime: contentType };
    }
    // Shape B: server returns JSON with a { url } pointing to the image.
    if (contentType.includes("json")) {
      const json = (await res.json()) as { url?: string };
      if (!json.url) {
        throw new Error("image provider JSON missing { url } field");
      }
      const imgRes = await fetch(json.url);
      if (!imgRes.ok) {
        throw new Error(
          `image provider follow-up URL returned ${imgRes.status}`,
        );
      }
      const buf = new Uint8Array(await imgRes.arrayBuffer());
      const followMime =
        imgRes.headers.get("content-type") ?? "image/jpeg";
      return { bytes: buf, mime: followMime };
    }
    throw new Error(
      `image provider returned unexpected content-type: ${contentType}`,
    );
  }
}

export function getProvider(): ImageProvider {
  const url = process.env.IMAGE_GEN_URL;
  const token = process.env.IMAGE_GEN_TOKEN;
  if (!url || !token) return new StubProvider();
  return new HttpProvider(url, token);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --experimental-strip-types --test lib/image-provider.test.ts`
Expected: PASS — 3/3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/image-provider.ts lib/image-provider.test.ts
git commit -m "Add image-provider abstraction with stub and HTTP impl"
```

---

## Task 3: Add `@vercel/blob` dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install**

```bash
npm install @vercel/blob
```

- [ ] **Step 2: Verify it landed**

Run: `grep '"@vercel/blob"' package.json`
Expected: a single line with the package and a version range.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add @vercel/blob dependency for dish-photo storage"
```

---

## Task 4: Blob storage wrapper

**Files:**
- Create: `lib/image-storage.ts`

No tests for this thin wrapper — verifying it requires a real `BLOB_READ_WRITE_TOKEN` and a network call, which we'll cover by hand once the Blob store is enabled in Vercel.

- [ ] **Step 1: Write the implementation**

Create `lib/image-storage.ts`:

```ts
import { put } from "@vercel/blob";

// Drops the bytes into the project's Vercel Blob store and returns the
// permanent CDN URL. Keep this narrow — route handlers should not
// import @vercel/blob directly so the dependency stays swappable.
//
// Path scheme:  dishes/{dishId}/{nanoid}.{ext}
// The nanoid suffix means re-rolling a dish gives the user a fresh
// URL — no CDN cache surprises.

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    default:
      return "img";
  }
}

function nanoid(): string {
  // 12 url-safe chars, plenty for collision avoidance at this scale.
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Buffer.from(bytes).toString("base64url");
}

export async function uploadDishImage(
  dishId: number,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const ext = extFromMime(mime);
  const path = `dishes/${dishId}/${nanoid()}.${ext}`;
  const result = await put(path, bytes, {
    access: "public",
    contentType: mime,
    addRandomSuffix: false,
  });
  return result.url;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/image-storage.ts
git commit -m "Add Vercel Blob upload wrapper for dish images"
```

---

## Task 5: Single-dish generate endpoint

**Files:**
- Create: `app/api/dishes/[id]/image/route.ts`

No automated test — the route composes already-tested pure modules with HTTP/DB infrastructure. We'll verify by hand against the deployed site after env is configured.

- [ ] **Step 1: Write the implementation**

Create `app/api/dishes/[id]/image/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { buildImagePrompt } from "@/lib/image-prompt";
import { getProvider } from "@/lib/image-provider";
import { uploadDishImage } from "@/lib/image-storage";

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/dishes/[id]/image">,
) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) {
    return Response.json({ error: "Bad id" }, { status: 400 });
  }
  const rows = await sql`SELECT * FROM dishes WHERE id = ${dishId}`;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const dish = rowToDish(rows[0]);

  let imageUrl: string;
  try {
    const prompt = buildImagePrompt({
      title: dish.title,
      subtitle: dish.subtitle,
    });
    const { bytes, mime } = await getProvider().generate(prompt);
    imageUrl = await uploadDishImage(dishId, bytes, mime);
  } catch (err) {
    const message = err instanceof Error ? err.message : "image generation failed";
    return Response.json({ error: message }, { status: 502 });
  }

  await sql`
    UPDATE dishes
       SET image_url = ${imageUrl},
           updated_at = now()
     WHERE id = ${dishId}
  `;
  return Response.json({ imageUrl });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `RouteContext<"/api/dishes/[id]/image">` is unknown, run `npx next typegen` first — Next 16 generates the route-context types into `.next/dev/types/`.

- [ ] **Step 3: Commit**

```bash
git add app/api/dishes/[id]/image/route.ts
git commit -m "Add POST /api/dishes/[id]/image endpoint"
```

---

## Task 6: Admin form Generate button

**Files:**
- Modify: `app/admin/page.tsx` (around the existing imageUrl input, line ~501–520)

- [ ] **Step 1: Read the current imageUrl block**

Open `app/admin/page.tsx` and find the existing `<label className="flex flex-col gap-1"><span>Image URL</span>...</label>` block (around line 501). Confirm the structure matches before editing.

- [ ] **Step 2: Replace that block with the version that adds Generate**

Replace the existing imageUrl block (the `<label>...</label>` containing the `Image URL` input and preview) with:

```tsx
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Image URL</span>
            <div className="flex gap-2">
              <input
                type="url"
                placeholder="https://…"
                value={draft.imageUrl}
                onChange={(e) =>
                  setDraft({ ...draft, imageUrl: e.target.value })
                }
                className="flex-1 rounded border border-zinc-300 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
              />
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={!draft.id || generatingImage}
                onClick={generateImage}
                title={
                  draft.id
                    ? "Generate AI photo for this dish"
                    : "Save the dish first, then generate"
                }
              >
                {generatingImage ? "Generating…" : "Generate"}
              </Button>
            </div>
            {imageMsg && (
              <span className="text-sm text-warn">{imageMsg}</span>
            )}
            {draft.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={draft.imageUrl}
                alt="preview"
                className="mt-2 h-32 w-auto rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
            )}
          </label>
```

- [ ] **Step 3: Add the state + handler near the top of `AdminPage`**

Inside `AdminPage`, just below the existing `useState` declarations (find the cluster around `setBackupMsg`, line ~160), add:

```tsx
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageMsg, setImageMsg] = useState<string | null>(null);

  async function generateImage() {
    if (!draft.id) return;
    setGeneratingImage(true);
    setImageMsg(null);
    try {
      const res = await fetch(`/api/dishes/${draft.id}/image`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        imageUrl?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (!data.imageUrl) throw new Error("response missing imageUrl");
      setDraft((d) => ({ ...d, imageUrl: data.imageUrl! }));
    } catch (err) {
      setImageMsg(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGeneratingImage(false);
    }
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify the page still loads**

Run `npm run dev` (the dev DB doesn't need to work for the admin page to compile). Open `http://localhost:3002/admin/login` and confirm the page renders without a hydration error in the browser console. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/admin/page.tsx
git commit -m "Wire Generate button into admin dish form"
```

---

## Task 7: Bulk backfill endpoint

**Files:**
- Create: `app/api/dishes/images/backfill/route.ts`

- [ ] **Step 1: Write the implementation**

Create `app/api/dishes/images/backfill/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { buildImagePrompt } from "@/lib/image-prompt";
import { getProvider } from "@/lib/image-provider";
import { uploadDishImage } from "@/lib/image-storage";

const CONCURRENCY = 4;

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

type BulkBody = { overwrite?: boolean };

async function generateForDishId(dishId: number): Promise<void> {
  const rows = await sql`SELECT * FROM dishes WHERE id = ${dishId}`;
  if (rows.length === 0) throw new Error("dish not found");
  const dish = rowToDish(rows[0]);
  const prompt = buildImagePrompt({ title: dish.title, subtitle: dish.subtitle });
  const { bytes, mime } = await getProvider().generate(prompt);
  const imageUrl = await uploadDishImage(dishId, bytes, mime);
  await sql`
    UPDATE dishes
       SET image_url = ${imageUrl},
           updated_at = now()
     WHERE id = ${dishId}
  `;
}

// Tiny concurrency-limited runner. No new dependency just for this.
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  async function pump() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        const value = await worker(items[i]);
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: BulkBody = {};
  try {
    body = (await request.json()) as BulkBody;
  } catch {
    // empty body is fine — defaults apply
  }
  const overwrite = body.overwrite === true;

  const idRows = overwrite
    ? await sql`SELECT id FROM dishes ORDER BY id`
    : await sql`SELECT id FROM dishes WHERE image_url IS NULL ORDER BY id`;
  const ids = idRows.map((r) => Number(r.id));

  const settled = await runWithConcurrency(ids, CONCURRENCY, generateForDishId);
  const failed: Array<{ dishId: number; error: string }> = [];
  let ok = 0;
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      ok++;
    } else {
      const reason = s.reason;
      failed.push({
        dishId: ids[i],
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  });
  return Response.json({ ok, failed, total: ids.length });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/dishes/images/backfill/route.ts
git commit -m "Add POST /api/dishes/images/backfill bulk endpoint"
```

---

## Task 8: Admin list "Generate missing images" button

**Files:**
- Modify: `app/admin/page.tsx` (around the existing `<h2>All dishes</h2>` header, line ~858)

- [ ] **Step 1: Add state + handler**

Inside `AdminPage`, near the other state declarations (next to `generatingImage` from Task 6), add:

```tsx
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  async function bulkGenerate() {
    if (!confirm("Generate AI photos for every dish missing one? This will use credits.")) return;
    setBulkRunning(true);
    setBulkMsg("Generating…");
    try {
      const res = await fetch("/api/dishes/images/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overwrite: false }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: number;
        failed?: Array<{ dishId: number; error: string }>;
        total?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const failedCount = data.failed?.length ?? 0;
      setBulkMsg(`Generated ${data.ok ?? 0} / ${data.total ?? 0}. ${failedCount} failed.`);
      if (data.failed && data.failed.length > 0) {
        // eslint-disable-next-line no-console
        console.warn("Bulk image-gen failures:", data.failed);
      }
      // Refresh the dishes list so the new image_urls show up.
      // `reload()` is the existing helper at app/admin/page.tsx:184.
      await reload();
    } catch (err) {
      setBulkMsg(err instanceof Error ? err.message : "Bulk generation failed");
    } finally {
      setBulkRunning(false);
    }
  }
```

(`reload()` is already declared at `app/admin/page.tsx:184` and re-fetches `/api/dishes` + supporting endpoints; no refactor needed.)

- [ ] **Step 2: Replace the dishes-list header line**

Find:

```tsx
        <h2 className="mb-3 text-xl font-semibold">All dishes ({dishes.length})</h2>
```

Replace with:

```tsx
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-xl font-semibold">All dishes ({dishes.length})</h2>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={bulkGenerate}
            disabled={bulkRunning}
          >
            {bulkRunning ? "Generating…" : "Generate missing images"}
          </Button>
          {bulkMsg && <span className="text-sm text-ink-3">{bulkMsg}</span>}
        </div>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/admin/page.tsx
git commit -m "Add bulk \"Generate missing images\" button to admin list"
```

---

## Task 9: Update `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append new variables**

Append the following lines to `.env.example`:

```
# AI image generation. Both must be set for the Generate buttons to
# work. Without them, the admin UI shows a clear "not configured"
# error. The provider's POST endpoint is expected to either return
# image bytes directly (Content-Type: image/...) or JSON with a
# { url } field that points to the image.
IMAGE_GEN_URL=
IMAGE_GEN_TOKEN=

# BLOB_READ_WRITE_TOKEN is auto-injected when the Vercel Blob store
# is added to the project — no manual setting needed in production.
# In local dev, pull it with `vercel env pull .env.local`.
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "Document IMAGE_GEN_URL/IMAGE_GEN_TOKEN env vars"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run the full test suite**

Run: `node --experimental-strip-types --test lib/*.test.ts`
Expected: every test green, including the new prompt + provider tests.

- [ ] **Step 2: Type-check the project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds; the new routes (`/api/dishes/[id]/image`, `/api/dishes/images/backfill`) appear in the route map as `ƒ` (dynamic / server-rendered).

- [ ] **Step 4: Try the admin UI in dev**

Run: `npm run dev`. Visit `http://localhost:3002/admin/login`, log in, edit a dish, click **Generate**. Expected response: error toast `image generation not configured: set IMAGE_GEN_URL and IMAGE_GEN_TOKEN in env`. This confirms the stub provider is wired correctly. Stop the dev server.

- [ ] **Step 5: Commit any small fixes from verification (only if needed)**

```bash
git status
# If anything changed:
git add <files>
git commit -m "Polish: <what>"
```

---

## Plug-in steps (out of plan, post-merge)

These are the steps you take once you've signed up with a provider:

1. In the Vercel dashboard → Storage → Add **Blob** → connect to the `dinner-spinner` project. `BLOB_READ_WRITE_TOKEN` is auto-injected.
2. In Vercel → Settings → Environment Variables, add `IMAGE_GEN_URL` and `IMAGE_GEN_TOKEN` with your provider's POST endpoint and bearer token.
3. Redeploy (auto, on next commit, or manual via `vercel deploy --prod --yes`).
4. Open `/admin`, click any dish, hit **Generate**. Inspect the result.
5. Once happy, click **Generate missing images** on the admin list to backfill all 20 dishes.
6. If the provider's request shape doesn't match `{ prompt }`, edit `lib/image-provider.ts::HttpProvider.generate` accordingly — that's the only file that needs to change.
