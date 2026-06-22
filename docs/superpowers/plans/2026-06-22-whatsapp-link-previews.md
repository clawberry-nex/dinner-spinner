# WhatsApp-rich link previews — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shared dish, profile, and home links unfurl in WhatsApp into a branded 1200×630 card (photo + name + wordmark) plus correct Open Graph / Twitter meta.

**Architecture:** Each shareable page gets a dynamic `opengraph-image` route (Next file convention) that queries the row anonymously (public-only), composes a card with Satori (`next/og` `ImageResponse`) using bundled fonts, then re-encodes the PNG to a small JPEG with `sharp` (WhatsApp drops WebP and oversized images). Pages add `generateMetadata`; the root layout adds `metadataBase` so image URLs resolve absolute; `proxy.ts` exempts the new image paths for anon crawlers.

**Tech Stack:** Next.js 16.2.3 (App Router), TypeScript, `next/og` (Satori), `sharp` 0.34, `@neondatabase/serverless` (`sql`), Vercel Blob (existing photo store).

## Global Constraints

- **Read the Next 16 `opengraph-image` doc before coding** the routes: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md`. (This repo's Next diverges from training data — AGENTS.md.)
- `opengraph-image` default export receives `{ params }` where **`params` is a `Promise`** (Next 16). It may return a plain `Response`; the injected `og:image:*` meta is driven by the `size` + `contentType` **exports**, not the returned object.
- OG routes that read the DB MUST export `runtime = "nodejs"` (sharp needs Node) and `dynamic = "force-dynamic"` (uncached, always current).
- Card image is **1200×630**, **`image/jpeg`**, composed on espresso `#15110E` with ember `#E27D45`, cream `#F3EADF`, gold `#E6B450`, panel `#1F1915`, dim `#BBAE9F`.
- A page file may export **either** `metadata` **or** `generateMetadata`, never both — converting one means deleting the other.
- `robots: { index: false, follow: false }` stays on dish + profile pages (social crawlers unfurl regardless).
- Tests: `node:test` + `node:assert/strict`, imports use the **`.ts`** extension, run with `npx tsx --test <file>` (no `npm test` script). Production `lib`/`app` imports are **extensionless** and may use the `@/` alias.
- Every commit message ends with the two standard trailers:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01FZuM2W2b71ipHX4mwFYkmd`.

## File Structure

| File | Responsibility |
|---|---|
| `lib/og/meta.ts` | Pure `dishOgText` / `profileOgText` → `{title, description}`. No I/O. |
| `lib/og/meta.test.ts` | Unit tests for the above. |
| `lib/og/image.ts` | `fetchAsJpegDataUrl(url)` — fetch a Blob image, `sharp` → JPEG data URL. |
| `lib/og/image.test.ts` | Unit tests (stubbed fetcher). |
| `lib/og/fonts.ts` | `loadOgFonts()` — read bundled TTFs as buffers for `ImageResponse`. |
| `lib/og/fonts.test.ts` | Smoke test: 3 fonts, non-empty. |
| `lib/og/render.ts` | `renderCardJpeg(element)` — Satori PNG → sharp JPEG `Response`; `OG_SIZE`. |
| `assets/og-fonts/*.ttf` | Bundled Spectral 700 + Schibsted 700/500. |
| `app/_og/card.tsx` | Presentational `FallbackCard` / `DishCard` / `ProfileCard` (Satori JSX). |
| `app/opengraph-image.tsx` | Home card route. |
| `app/dishes/[id]/opengraph-image.tsx` | Dish card route. |
| `app/u/[handle]/opengraph-image.tsx` | Profile card route. |
| `app/layout.tsx` | + `metadataBase`, `openGraph`, `twitter`. |
| `app/dishes/[id]/page.tsx` | `metadata` → `generateMetadata`. |
| `app/u/[handle]/page.tsx` | `metadata` → `generateMetadata`. |
| `proxy.ts` | Exempt home + dish OG image paths for anon. |

---

### Task 1: OG text helpers

**Files:**
- Create: `lib/og/meta.ts`
- Test: `lib/og/meta.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type OgText = { title: string; description: string }`
  - `dishOgText(dish: { title: string; subtitle: string | null; tags: string[]; baseServings: number }): OgText`
  - `profileOgText(profile: { name: string | null; handle: string; bio: string | null }, publicCount: number): OgText`

- [ ] **Step 1: Write the failing test**

`lib/og/meta.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dishOgText, profileOgText } from "./meta.ts";

test("dishOgText uses subtitle when present", () => {
  const r = dishOgText({ title: "Thai Green Curry", subtitle: "Fragrant & quick", tags: ["vegetarian"], baseServings: 4 });
  assert.deepEqual(r, { title: "Thai Green Curry", description: "Fragrant & quick" });
});

test("dishOgText falls back to tags (max 3) + servings when no subtitle", () => {
  const r = dishOgText({ title: "Dal", subtitle: null, tags: ["vegan", "indian", "cheap", "extra"], baseServings: 6 });
  assert.deepEqual(r, { title: "Dal", description: "vegan · indian · cheap · serves 6" });
});

test("dishOgText with blank subtitle and no tags is just servings", () => {
  const r = dishOgText({ title: "Toast", subtitle: "   ", tags: [], baseServings: 2 });
  assert.equal(r.description, "serves 2");
});

test("profileOgText uses name + bio", () => {
  const r = profileOgText({ name: "Mirko", handle: "mirko", bio: "Home cook" }, 12);
  assert.deepEqual(r, { title: "Mirko's recipes", description: "Home cook" });
});

test("profileOgText falls back to handle and pluralizes count", () => {
  assert.deepEqual(
    profileOgText({ name: null, handle: "chef", bio: null }, 1),
    { title: "@chef", description: "1 recipe on Dinner Spinner" },
  );
  assert.equal(
    profileOgText({ name: "  ", handle: "chef", bio: "  " }, 0).description,
    "0 recipes on Dinner Spinner",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/og/meta.test.ts`
Expected: FAIL — cannot find module `./meta.ts`.

- [ ] **Step 3: Write minimal implementation**

`lib/og/meta.ts`:
```ts
// Pure text builders for link-preview metadata (Open Graph / Twitter / the
// composed card). No I/O so they're unit-tested; shared by the page
// generateMetadata and the opengraph-image routes so both stay in sync.

export type OgText = { title: string; description: string };

export function dishOgText(dish: {
  title: string;
  subtitle: string | null;
  tags: string[];
  baseServings: number;
}): OgText {
  const subtitle = dish.subtitle?.trim();
  if (subtitle) return { title: dish.title, description: subtitle };
  const parts: string[] = [];
  if (dish.tags.length > 0) parts.push(dish.tags.slice(0, 3).join(" · "));
  parts.push(`serves ${dish.baseServings}`);
  return { title: dish.title, description: parts.join(" · ") };
}

export function profileOgText(
  profile: { name: string | null; handle: string; bio: string | null },
  publicCount: number,
): OgText {
  const name = profile.name?.trim();
  const title = name ? `${name}'s recipes` : `@${profile.handle}`;
  const bio = profile.bio?.trim();
  const description = bio
    ? bio
    : `${publicCount} ${publicCount === 1 ? "recipe" : "recipes"} on Dinner Spinner`;
  return { title, description };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/og/meta.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/og/meta.ts lib/og/meta.test.ts
git commit -m "feat(og): pure dish/profile link-preview text helpers"
```

---

### Task 2: OG rendering toolkit (fonts, image, render)

**Files:**
- Create: `assets/og-fonts/Spectral-700.ttf`, `assets/og-fonts/SchibstedGrotesk-700.ttf`, `assets/og-fonts/SchibstedGrotesk-500.ttf`
- Create: `lib/og/fonts.ts`, `lib/og/image.ts`, `lib/og/render.ts`
- Test: `lib/og/image.test.ts`, `lib/og/fonts.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fetchAsJpegDataUrl(url: string, opts?: { fetcher?: typeof fetch; timeoutMs?: number; size?: number }): Promise<string | null>`
  - `loadOgFonts(): Promise<Array<{ name: string; data: Buffer; weight: 500 | 700; style: "normal" }>>`
  - `renderCardJpeg(element: import("react").ReactElement): Promise<Response>`
  - `OG_SIZE = { width: 1200, height: 630 }`

- [ ] **Step 1: Download the bundled fonts**

```bash
mkdir -p assets/og-fonts
curl -fsSL -o assets/og-fonts/Spectral-700.ttf          "https://cdn.jsdelivr.net/fontsource/fonts/spectral@latest/latin-700-normal.ttf"
curl -fsSL -o assets/og-fonts/SchibstedGrotesk-700.ttf  "https://cdn.jsdelivr.net/fontsource/fonts/schibsted-grotesk@latest/latin-700-normal.ttf"
curl -fsSL -o assets/og-fonts/SchibstedGrotesk-500.ttf  "https://cdn.jsdelivr.net/fontsource/fonts/schibsted-grotesk@latest/latin-500-normal.ttf"
ls -l assets/og-fonts/   # three .ttf files, ~40–57 KB each
```

- [ ] **Step 2: Write the failing tests**

`lib/og/image.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fetchAsJpegDataUrl } from "./image.ts";

function stubFetch(body: { ok: boolean; bytes?: Buffer }): typeof fetch {
  return (async () => ({
    ok: body.ok,
    arrayBuffer: async () => {
      const b = body.bytes ?? Buffer.alloc(0);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  })) as unknown as typeof fetch;
}

test("fetchAsJpegDataUrl converts a fetched image to a jpeg data url", async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .png().toBuffer();
  const url = await fetchAsJpegDataUrl("https://blob/x.webp", { fetcher: stubFetch({ ok: true, bytes: png }) });
  assert.ok(url && url.startsWith("data:image/jpeg;base64,"));
});

test("fetchAsJpegDataUrl returns null on a non-ok response", async () => {
  assert.equal(await fetchAsJpegDataUrl("https://blob/missing", { fetcher: stubFetch({ ok: false }) }), null);
});

test("fetchAsJpegDataUrl returns null when the bytes are not an image", async () => {
  assert.equal(
    await fetchAsJpegDataUrl("https://blob/junk", { fetcher: stubFetch({ ok: true, bytes: Buffer.from("not an image") }) }),
    null,
  );
});
```

`lib/og/fonts.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOgFonts } from "./fonts.ts";

test("loadOgFonts returns three non-empty fonts", async () => {
  const fonts = await loadOgFonts();
  assert.equal(fonts.length, 3);
  for (const f of fonts) {
    assert.ok(f.name.length > 0);
    assert.ok(f.data.length > 1000);
  }
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx tsx --test lib/og/image.test.ts lib/og/fonts.test.ts`
Expected: FAIL — cannot find `./image.ts` / `./fonts.ts`.

- [ ] **Step 4: Write the implementations**

`lib/og/image.ts`:
```ts
import sharp from "sharp";

// Fetch an image (the dish/avatar WebP on Vercel Blob) and return it as a
// square JPEG data URL. Satori (next/og) cannot decode WebP and remote-image
// fetching is unreliable, so OG cards embed photos as JPEG data URLs.
// Returns null on any failure — the caller renders a photo-less card.
export async function fetchAsJpegDataUrl(
  url: string,
  opts: { fetcher?: typeof fetch; timeoutMs?: number; size?: number } = {},
): Promise<string | null> {
  const fetcher = opts.fetcher ?? fetch;
  const size = opts.size ?? 630;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetcher(url, { signal: controller.signal });
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    const jpeg = await sharp(input).resize(size, size, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

`lib/og/fonts.ts`:
```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type OgFont = { name: string; data: Buffer; weight: 500 | 700; style: "normal" };

// process.cwd() is the Next project root at runtime (per next/og docs).
const DIR = join(process.cwd(), "assets", "og-fonts");

let cache: OgFont[] | null = null;

// Read the bundled TTFs once per lambda. Buffers are accepted directly by
// ImageResponse's `fonts` option.
export async function loadOgFonts(): Promise<OgFont[]> {
  if (cache) return cache;
  const [spectral700, schibsted700, schibsted500] = await Promise.all([
    readFile(join(DIR, "Spectral-700.ttf")),
    readFile(join(DIR, "SchibstedGrotesk-700.ttf")),
    readFile(join(DIR, "SchibstedGrotesk-500.ttf")),
  ]);
  cache = [
    { name: "Spectral", data: spectral700, weight: 700, style: "normal" },
    { name: "Schibsted Grotesk", data: schibsted700, weight: 700, style: "normal" },
    { name: "Schibsted Grotesk", data: schibsted500, weight: 500, style: "normal" },
  ];
  return cache;
}
```

`lib/og/render.ts`:
```ts
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { ReactElement } from "react";
import { loadOgFonts } from "./fonts";

export const OG_SIZE = { width: 1200, height: 630 } as const;

// Compose a card with Satori (PNG) then re-encode to a small JPEG. WhatsApp
// silently drops WebP and oversized og:images; a 1200×630 JPEG q80 lands
// ~150–250 KB and renders as a full-width banner.
export async function renderCardJpeg(element: ReactElement): Promise<Response> {
  const fonts = await loadOgFonts();
  const png = new ImageResponse(element, { ...OG_SIZE, fonts });
  const pngBuf = Buffer.from(await png.arrayBuffer());
  const jpeg = await sharp(pngBuf).jpeg({ quality: 80 }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test lib/og/image.test.ts lib/og/fonts.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (`render.ts` imports `next/og` + `react` types.)

- [ ] **Step 7: Commit**

```bash
git add assets/og-fonts lib/og/image.ts lib/og/image.test.ts lib/og/fonts.ts lib/og/fonts.test.ts lib/og/render.ts
git commit -m "feat(og): card rendering toolkit (fonts, image data-url, satori→jpeg)"
```

---

### Task 3: Card components + home card + root metadata + proxy

**Files:**
- Create: `app/_og/card.tsx`, `app/opengraph-image.tsx`
- Modify: `app/layout.tsx` (metadata object), `proxy.ts` (anon-allow block)

**Interfaces:**
- Consumes: `renderCardJpeg`, `OG_SIZE` (Task 2).
- Produces (from `app/_og/card.tsx`):
  - `FallbackCard(props: { tagline?: string }): ReactElement`
  - `DishCard(props: { photo: string | null; title: string; meta: string }): ReactElement`
  - `ProfileCard(props: { photo: string | null; name: string; handle: string | null; line: string }): ReactElement`

- [ ] **Step 1: Create the card components**

`app/_og/card.tsx` (all three cards live here so they share one visual language; `DishCard`/`ProfileCard` bodies are filled in now and reused by Tasks 4–5):
```tsx
// Presentational cards rendered inside Satori (next/og). Every element uses
// display:flex (Satori requirement); text is truncated in JS rather than CSS
// line-clamp to stay within type-checked CSSProperties.

const C = {
  bg: "#15110E",
  panel: "#1F1915",
  text: "#F3EADF",
  dim: "#BBAE9F",
  accent: "#E27D45",
  gold: "#E6B450",
};

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

function Ring() {
  return <div style={{ width: 120, height: 120, borderRadius: 120, border: `12px solid ${C.accent}`, display: "flex" }} />;
}

function Kicker() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontFamily: "Schibsted Grotesk", fontWeight: 700, fontSize: 26, letterSpacing: 4, color: C.accent }}>
        DINNER SPINNER
      </div>
      <div style={{ display: "flex", marginTop: 8, width: 64, height: 5, borderRadius: 5, background: C.accent }} />
    </div>
  );
}

export function FallbackCard({ tagline = "Pick a dinner, scale the recipe, build a shopping list." }: { tagline?: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: C.bg, padding: 90 }}>
      <Ring />
      <div style={{ display: "flex", marginTop: 36, fontFamily: "Spectral", fontWeight: 700, fontSize: 78, color: C.text }}>Dinner Spinner</div>
      <div style={{ display: "flex", marginTop: 18, fontFamily: "Schibsted Grotesk", fontWeight: 500, fontSize: 30, color: C.dim, textAlign: "center", maxWidth: 820 }}>
        {truncate(tagline, 120)}
      </div>
    </div>
  );
}

export function DishCard({ photo, title, meta }: { photo: string | null; title: string; meta: string }) {
  if (!photo) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", background: C.bg, padding: 90 }}>
        <Kicker />
        <div style={{ display: "flex", marginTop: 28, fontFamily: "Spectral", fontWeight: 700, fontSize: 76, lineHeight: 1.05, color: C.text }}>
          {truncate(title, 60)}
        </div>
        <div style={{ display: "flex", marginTop: 20, fontFamily: "Schibsted Grotesk", fontWeight: 500, fontSize: 30, color: C.dim }}>
          {truncate(meta, 80)}
        </div>
      </div>
    );
  }
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "row", background: C.bg }}>
      <img src={photo} width={630} height={630} style={{ width: 630, height: 630, objectFit: "cover" }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 56, background: C.panel }}>
        <Kicker />
        <div style={{ display: "flex", overflow: "hidden", fontFamily: "Spectral", fontWeight: 700, fontSize: 60, lineHeight: 1.08, color: C.text }}>
          {truncate(title, 70)}
        </div>
        <div style={{ display: "flex", overflow: "hidden", fontFamily: "Schibsted Grotesk", fontWeight: 500, fontSize: 28, color: C.dim }}>
          {truncate(meta, 90)}
        </div>
      </div>
    </div>
  );
}

export function ProfileCard({ photo, name, handle, line }: { photo: string | null; name: string; handle: string | null; line: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "row", background: C.bg }}>
      {photo ? (
        <img src={photo} width={630} height={630} style={{ width: 630, height: 630, objectFit: "cover" }} />
      ) : (
        <div style={{ width: 630, height: 630, display: "flex", alignItems: "center", justifyContent: "center", background: C.panel }}>
          <Ring />
        </div>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: 56, background: C.panel }}>
        <Kicker />
        <div style={{ display: "flex", overflow: "hidden", marginTop: 28, fontFamily: "Spectral", fontWeight: 700, fontSize: 58, color: C.text }}>
          {truncate(name, 40)}
        </div>
        {handle ? (
          <div style={{ display: "flex", marginTop: 10, fontFamily: "Schibsted Grotesk", fontWeight: 500, fontSize: 30, color: C.gold }}>@{handle}</div>
        ) : null}
        <div style={{ display: "flex", overflow: "hidden", marginTop: 20, fontFamily: "Schibsted Grotesk", fontWeight: 500, fontSize: 28, color: C.dim }}>
          {truncate(line, 90)}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the home card route**

`app/opengraph-image.tsx`:
```tsx
import { FallbackCard } from "@/app/_og/card";
import { renderCardJpeg } from "@/lib/og/render";

export const runtime = "nodejs";
export const alt = "Dinner Spinner";
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";

export default async function Image() {
  return renderCardJpeg(<FallbackCard />);
}
```

- [ ] **Step 3: Add metadataBase + openGraph to the root layout**

In `app/layout.tsx`, replace the `export const metadata: Metadata = { ... }` object with:
```ts
export const metadata: Metadata = {
  metadataBase: new URL(process.env.AUTH_URL ?? "http://localhost:3000"),
  title: "Dinner Spinner",
  description: "Pick a dinner, scale the recipe, build a shopping list.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Dinner",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "Dinner Spinner",
    title: "Dinner Spinner",
    description: "Pick a dinner, scale the recipe, build a shopping list.",
  },
  twitter: { card: "summary_large_image" },
};
```
(Keep the existing icons comment if desired; only `metadataBase`, `openGraph`, and `twitter` are additions.)

- [ ] **Step 4: Exempt the new OG image paths in `proxy.ts`**

Replace the anon public-reads `if` block (the one testing `/u/` and `/^\/dishes\/\d+$/`) with:
```ts
  if (
    pathname.startsWith("/u/") ||
    /^\/dishes\/\d+$/.test(pathname) ||
    /^\/dishes\/\d+\/opengraph-image/.test(pathname) ||
    /^\/opengraph-image/.test(pathname) ||
    (isApi && /^\/api\/dishes\/\d+$/.test(pathname) && req.method === "GET")
  ) {
    return;
  }
```
(Profile OG at `/u/<handle>/opengraph-image` is already covered by `startsWith("/u/")`.)

- [ ] **Step 5: Type-check**

Run: `npx next typegen && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/_og/card.tsx app/opengraph-image.tsx app/layout.tsx proxy.ts
git commit -m "feat(og): branded cards, home og-image, metadataBase + proxy exemptions"
```

---

### Task 4: Dish OG card + dish page metadata

**Files:**
- Create: `app/dishes/[id]/opengraph-image.tsx`
- Modify: `app/dishes/[id]/page.tsx` (`metadata` → `generateMetadata`)

**Interfaces:**
- Consumes: `DishCard`, `FallbackCard`, `renderCardJpeg`, `fetchAsJpegDataUrl`, `dishOgText`, `sql`.
- Produces: the dish `og:image` route + `og:*`/`twitter:*` tags on the dish page.

- [ ] **Step 1: Create the dish OG image route**

`app/dishes/[id]/opengraph-image.tsx`:
```tsx
import { sql } from "@/lib/db";
import { DishCard, FallbackCard } from "@/app/_og/card";
import { renderCardJpeg } from "@/lib/og/render";
import { fetchAsJpegDataUrl } from "@/lib/og/image";
import { dishOgText } from "@/lib/og/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Recipe on Dinner Spinner";
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) return renderCardJpeg(<FallbackCard />);

  const rows = await sql`
    SELECT title, subtitle, tags, base_servings, image_url
      FROM dishes
     WHERE id = ${dishId} AND public = true
     LIMIT 1
  `;
  if (rows.length === 0) return renderCardJpeg(<FallbackCard />);
  const row = rows[0];

  const { title, description } = dishOgText({
    title: row.title as string,
    subtitle: (row.subtitle as string | null) ?? null,
    tags: (row.tags as string[]) ?? [],
    baseServings: row.base_servings as number,
  });

  const photo = row.image_url ? await fetchAsJpegDataUrl(row.image_url as string) : null;
  return renderCardJpeg(<DishCard photo={photo} title={title} meta={description} />);
}
```

- [ ] **Step 2: Convert the dish page to `generateMetadata`**

In `app/dishes/[id]/page.tsx`, **delete** the existing `export const metadata: Metadata = { ... }` block and add this import + function (the file already imports `Metadata`, `sql`):
```ts
import { dishOgText } from "@/lib/og/meta";

export async function generateMetadata(
  props: PageProps<"/dishes/[id]">,
): Promise<Metadata> {
  const base: Metadata = { robots: { index: false, follow: false } };
  const { id } = await props.params;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) return base;

  const rows = await sql`
    SELECT title, subtitle, tags, base_servings
      FROM dishes WHERE id = ${dishId} AND public = true LIMIT 1
  `;
  if (rows.length === 0) return base;
  const row = rows[0];

  const { title, description } = dishOgText({
    title: row.title as string,
    subtitle: (row.subtitle as string | null) ?? null,
    tags: (row.tags as string[]) ?? [],
    baseServings: row.base_servings as number,
  });
  return {
    ...base,
    title,
    description,
    openGraph: { type: "article", title, description, url: `/dishes/${dishId}` },
    twitter: { card: "summary_large_image", title, description },
  };
}
```
(The `og:image`/`twitter:image` tags are injected automatically by the `opengraph-image` route — do not set `openGraph.images` here. A private dish returns `base` only, so no public data leaks.)

- [ ] **Step 3: Type-check**

Run: `npx next typegen && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/dishes/[id]/opengraph-image.tsx app/dishes/[id]/page.tsx
git commit -m "feat(og): dish share card + dish page open-graph metadata"
```

---

### Task 5: Profile OG card + profile page metadata

**Files:**
- Create: `app/u/[handle]/opengraph-image.tsx`
- Modify: `app/u/[handle]/page.tsx` (`metadata` → `generateMetadata`)

**Interfaces:**
- Consumes: `ProfileCard`, `FallbackCard`, `renderCardJpeg`, `fetchAsJpegDataUrl`, `profileOgText`, `sql`.
- Produces: the profile `og:image` route + `og:*`/`twitter:*` tags on the profile page.

- [ ] **Step 1: Create the profile OG image route**

`app/u/[handle]/opengraph-image.tsx`:
```tsx
import { sql } from "@/lib/db";
import { ProfileCard, FallbackCard } from "@/app/_og/card";
import { renderCardJpeg } from "@/lib/og/render";
import { fetchAsJpegDataUrl } from "@/lib/og/image";
import { profileOgText } from "@/lib/og/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Recipes on Dinner Spinner";
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = await params;
  const handle = decodeURIComponent(raw).toLowerCase();

  const users = await sql`SELECT id, handle, name, image, bio FROM users WHERE handle = ${handle} LIMIT 1`;
  if (users.length === 0) return renderCardJpeg(<FallbackCard />);
  const u = users[0];

  const countRows = await sql`SELECT COUNT(*)::int AS n FROM dishes WHERE user_id = ${u.id} AND public = true`;
  const publicCount = (countRows[0]?.n as number) ?? 0;

  const { description } = profileOgText(
    { name: (u.name as string | null) ?? null, handle: u.handle as string, bio: (u.bio as string | null) ?? null },
    publicCount,
  );

  // Representative photo: the avatar, else a favourite/recent public dish photo.
  let photoUrl = (u.image as string | null) ?? null;
  if (!photoUrl) {
    const dishPhoto = await sql`
      SELECT image_url FROM dishes
       WHERE user_id = ${u.id} AND public = true AND image_url IS NOT NULL
       ORDER BY favorite DESC, id DESC LIMIT 1
    `;
    photoUrl = (dishPhoto[0]?.image_url as string | null) ?? null;
  }
  const photo = photoUrl ? await fetchAsJpegDataUrl(photoUrl) : null;

  const nameTrimmed = (u.name as string | null)?.trim();
  const displayName = nameTrimmed || `@${u.handle as string}`;
  return renderCardJpeg(
    <ProfileCard photo={photo} name={displayName} handle={nameTrimmed ? (u.handle as string) : null} line={description} />,
  );
}
```

- [ ] **Step 2: Convert the profile page to `generateMetadata`**

In `app/u/[handle]/page.tsx`, **delete** the existing `export const metadata: Metadata = { ... }` block and add this import + function (the file already imports `Metadata`, `sql`):
```ts
import { profileOgText } from "@/lib/og/meta";

export async function generateMetadata(
  props: PageProps<"/u/[handle]">,
): Promise<Metadata> {
  const base: Metadata = { robots: { index: false, follow: false } };
  const { handle: raw } = await props.params;
  const handle = decodeURIComponent(raw).toLowerCase();

  const rows = await sql`SELECT id, handle, name, bio FROM users WHERE handle = ${handle} LIMIT 1`;
  if (rows.length === 0) return base;
  const u = rows[0];

  const countRows = await sql`SELECT COUNT(*)::int AS n FROM dishes WHERE user_id = ${u.id} AND public = true`;
  const publicCount = (countRows[0]?.n as number) ?? 0;

  const { title, description } = profileOgText(
    { name: (u.name as string | null) ?? null, handle: u.handle as string, bio: (u.bio as string | null) ?? null },
    publicCount,
  );
  return {
    ...base,
    title,
    description,
    openGraph: { type: "profile", title, description, url: `/u/${u.handle as string}` },
    twitter: { card: "summary_large_image", title, description },
  };
}
```

- [ ] **Step 3: Type-check**

Run: `npx next typegen && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/u/[handle]/opengraph-image.tsx app/u/[handle]/page.tsx
git commit -m "feat(og): profile share card + profile page open-graph metadata"
```

---

### Task 6: Integration smoke + deploy verification

**Files:** none (verification only).

- [ ] **Step 1: Local smoke (if a working local env with `DATABASE_URL` is available)**

```bash
npm run dev   # leave running in another shell; needs the app's .env (DATABASE_URL, AUTH_URL)
# Pick a public dish id and a handle you own, then:
ID=<public-dish-id>; H=<your-handle>
curl -sS -D - -o /tmp/og-dish.jpg   "http://localhost:3000/dishes/$ID/opengraph-image" | grep -i '^content-type'
curl -sS -D - -o /tmp/og-prof.jpg   "http://localhost:3000/u/$H/opengraph-image"        | grep -i '^content-type'
curl -sS -D - -o /tmp/og-home.jpg   "http://localhost:3000/opengraph-image"             | grep -i '^content-type'
file /tmp/og-*.jpg                  # each: "JPEG image data, ... 1200x630"
# Meta tags present + absolute URLs:
curl -sS "http://localhost:3000/dishes/$ID" | grep -ioE '<meta (property|name)="(og|twitter):[^"]+" content="[^"]*"' | sort -u
```
Expected: three `image/jpeg` responses sized 1200×630; the dish page shows `og:title`, `og:description`, `og:image` (absolute `https://…/dishes/$ID/opengraph-image…`), `og:type=article`, `twitter:card=summary_large_image`.
(If no local DB, skip to Step 3 and verify against production.)

- [ ] **Step 2: Push the branch and open a PR**

```bash
git push -u origin link-previews
gh pr create --fill --base main
```

- [ ] **Step 3: Post-deploy verification (after the Vercel preview/prod deploy is live)**

```bash
BASE=https://dinner-spinner-lake.vercel.app
TOKEN="<API_TOKEN>"
ID=$(curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/api/dishes" | jq -r '[.[] | select(.public)][0].id')

# Dish page meta (absolute og:image, twitter card):
curl -sS "$BASE/dishes/$ID" | grep -ioE '<meta (property|name)="(og|twitter):[^"]+" content="[^"]*"' | sort -u
# OG image is a small JPEG:
curl -sSI "$BASE/dishes/$ID/opengraph-image" | grep -iE '^(content-type|content-length)'   # image/jpeg, well under 600 KB
# Home + a profile:
curl -sSI "$BASE/opengraph-image" | grep -i '^content-type'
curl -sS "$BASE/u/<your-handle>" | grep -ioE '<meta property="og:[^"]+" content="[^"]*"' | sort -u
```
Expected: `content-type: image/jpeg`, `content-length` ~150–250 KB, absolute `og:image` URL, `og:title`/`og:description` from the dish.

- [ ] **Step 4: Validate the unfurl + share into WhatsApp**

- Paste `$BASE/dishes/$ID` into a link-preview debugger (e.g. opengraph.xyz or the Facebook Sharing Debugger) → confirm the banner renders.
- Send the same link into a WhatsApp chat → confirm the big card (photo + name) appears.
- Note: WhatsApp caches previews; a link shared **before** this deploy keeps its old blank preview. Test with a fresh link, or append `?v=2`.

- [ ] **Step 5: Finalize**

Use the `superpowers:finishing-a-development-branch` skill (or merge the PR) once verification passes.

---

## Self-Review

**Spec coverage:**
- Dish / profile / home rich previews → Tasks 4 / 5 / 3. ✓
- Non-WebP, small, absolute, declared-dims image → `renderCardJpeg` (Task 2) + `metadataBase` (Task 3) + `size`/`contentType` exports (Tasks 3–5). ✓
- No backfill / pipeline change → cards are request-time routes. ✓
- Private/no-photo/unknown-handle fallback, no leak → `FallbackCard` branches + `public = true` queries (Tasks 4–5). ✓
- `robots: noindex` stays → preserved in both `generateMetadata` `base` objects. ✓
- Proxy reachable by anon crawlers → Task 3 Step 4 (`/u/` already covered). ✓
- WhatsApp-cache caveat, debugger, WhatsApp share → Task 6. ✓
- Unit tests for pure helpers + public-only query intent → Tasks 1–2 tests. ✓
- Read Next 16 docs first → Global Constraints. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; `<API_TOKEN>`, `<public-dish-id>`, `<your-handle>` are runtime values the operator supplies, not code gaps. ✓

**Type consistency:** `OgText`, `dishOgText`, `profileOgText`, `fetchAsJpegDataUrl`, `loadOgFonts`, `renderCardJpeg`, `OG_SIZE`, and the `FallbackCard`/`DishCard`/`ProfileCard` prop shapes are used identically across tasks. Photo field is `image_url` (column) → `imageUrl` (type) consistently; profile avatar is `users.image`. ✓
