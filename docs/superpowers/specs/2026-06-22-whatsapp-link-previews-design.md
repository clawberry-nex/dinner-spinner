# WhatsApp-rich link previews — design

**Status:** Approved 2026-06-22
**Scope:** Make shared Dinner Spinner links unfurl into a rich preview (title + description + image) in WhatsApp (and other Open Graph consumers). Cover three share targets — public dish pages, public profile pages, and the app home URL — each with a composed **1200×630 branded card** plus Open Graph / Twitter Card meta tags.

---

## Goals

- Sharing a public dish link (`/dishes/[id]`) in WhatsApp shows a big banner card: the dish photo, the dish name, and the Dinner Spinner wordmark — plus the dish name/subtitle as WhatsApp's own preview text.
- Sharing a profile link (`/u/[handle]`) shows a card with the person's name/handle, bio, and a representative photo.
- Sharing the bare app URL (`/`) shows a default branded card.
- Previews render reliably in WhatsApp specifically — meaning a **non-WebP** image, **under WhatsApp's size limit**, at an **absolute HTTPS URL**, with declared dimensions.
- No backfill and no change to the image-generation pipeline. Cards are generated on demand and always reflect the current title/photo.
- Private dishes and missing rows never leak data into a preview.

## Non-goals

- **No SEO / indexing.** `robots: noindex` stays on dishes and profiles; social crawlers unfurl regardless. We are not trying to rank in search.
- **No per-platform card variants.** One card design serves WhatsApp, iMessage, Telegram, Slack, Facebook, etc. (all OG/Twitter consumers).
- **No cache-busting infrastructure.** WhatsApp caches previews hard; we accept that already-shared links stay stale and document the `?v=` manual workaround.
- **No new stored asset / blob per dish.** Cards are computed at request time, not persisted.
- **No non-Latin script support** in baked card text beyond what the bundled Latin-extended fonts cover (CJK/Arabic/etc. titles will tofu in the *image*; WhatsApp's own text still shows them correctly).

---

## Background: why the existing image URL won't work

Dish photos are stored as **WebP**, max 1024px, square (1:1), on Vercel Blob (`lib/image-storage.ts`). Two problems for a naive `og:image` pointing at that URL:

1. **WhatsApp's link-preview crawler does not reliably render WebP** `og:image`. It expects JPEG or PNG.
2. Even as PNG, a 1200×630 card containing a photo is ~800 KB+; **WhatsApp silently drops images over its (~600 KB-ish) size limit**. JPEG keeps it ~150–250 KB.

So the preview image must be produced as a small **JPEG**, composed at a **1.91:1 (1200×630)** aspect ratio (the shape WhatsApp renders as a full-width banner rather than a small side thumbnail).

Today none of the shareable pages emit any Open Graph tags — the dish page only sets `robots: noindex` and inherits the root layout's generic title/description, so WhatsApp falls back to "Dinner Spinner / Pick a dinner…" with no image.

---

## Architecture

### Rendering pipeline (per card)

Each card is produced by a **dynamic `opengraph-image` route** (Next.js file convention) running on the **Node.js runtime** (sharp requires Node, not Edge):

1. **Authorize as anonymous.** Query the row with the public predicate only (`public = true` for dishes; any existing user for profiles). A private/missing dish or unknown handle → render the **generic fallback card** (wordmark only). The route never trusts a session.
2. **Inline the photo.** Fetch the dish/profile photo (WebP) from Blob and convert it with `sharp` to a JPEG **data URL**. Satori (the engine behind `ImageResponse`) cannot decode WebP and remote-image fetching is unreliable, so the photo is embedded as a base64 data URL.
3. **Compose with Satori.** `new ImageResponse(<Card .../>, { width: 1200, height: 630, fonts: [...] })` lays out the card from JSX/flexbox using **bundled font buffers** (Spectral + Schibsted Grotesk). Output is PNG. Flexbox handles title wrapping and line-clamping.
4. **Shrink to JPEG.** Re-encode the PNG → **JPEG quality 80** with `sharp` and return it as the route's `Response` (`contentType = "image/jpeg"`). This is the WhatsApp-friendly, ~150–250 KB final image.

Using Satori for layout (explicit font buffers — no serverless `fontconfig` dependency) and sharp only for the photo decode + final JPEG encode gets the best of both: reliable text rendering and a small, correctly-typed image.

### Files

**New — card generators (file convention):**

- **`app/dishes/[id]/opengraph-image.tsx`** — dish card. Exports `runtime = "nodejs"`, `size = { width: 1200, height: 630 }`, `contentType = "image/jpeg"`, `alt`, and a default `async function Image({ params })`. Queries the dish with `WHERE id = $1 AND public = true`. Layout: photo (left ~630px, cover-cropped) + warm panel (right) with wordmark, dish title (Spectral), and a meta line (subtitle, else `tags · serves N`). No photo / not public → fallback card.
- **`app/u/[handle]/opengraph-image.tsx`** — profile card. Same exports. Looks up the user by handle; picks a representative photo (favorite or first public dish image, if any). Layout: avatar/photo + name + `@handle` + "N public recipes". Unknown handle → fallback card.
- **`app/opengraph-image.tsx`** — home card. Rendered via `ImageResponse` reusing the **shared branded/fallback card component** (wordmark + tagline, no photo) — the home card and the dish/profile fallback card are visually the same thing, so there's no separate static asset to commit or keep in sync.

**New — shared helpers:**

- **`app/_og/card.tsx`** — the shared Satori card components (dish / profile / branded-fallback) and the `1200×630` frame, so the three routes share one visual language. Pure presentational JSX given resolved props. (Presentational TSX lives under `app/_og/`; non-JSX helpers below live under `lib/og/`.)
- **`lib/og/image.ts`** — `fetchAsJpegDataUrl(url)`: fetch a Blob image, `sharp` → JPEG → `data:image/jpeg;base64,…`. Guarded for null/oversize/non-image.
- **`lib/og/meta.ts`** — pure functions `dishOgText(dish)` and `profileOgText(profile, counts)` returning `{ title, description }`. **Unit-tested.**
- **`lib/og/fonts.ts`** — loads the bundled font files as `ArrayBuffer`s for `ImageResponse`. Font files committed under `app/_og/fonts/` (Spectral + Schibsted subsets, ~100–200 KB total).

**Edited — metadata:**

- **`app/dishes/[id]/page.tsx`** — add `generateMetadata({ params })`: resolve the dish (public-readable, same predicate as the page), set `openGraph` (`title`, `description`, `type: "article"`, `url`) and `twitter: { card: "summary_large_image" }`. Keep `robots: noindex`. The `og:image`/`twitter:image` tags are auto-injected by the `opengraph-image` route (add a `twitter-image` re-export if Next 16 doesn't emit `twitter:image` from `opengraph-image`).
- **`app/u/[handle]/page.tsx`** — analogous `generateMetadata`.
- **`app/layout.tsx`** — add **`metadataBase: new URL(process.env.AUTH_URL ?? "http://localhost:3000")`** and an `openGraph` block (site name, default title/description, `type: "website"`). This makes relative `og:image` URLs resolve absolute.

**Edited — routing:**

- **`proxy.ts`** — extend the public-path exemptions so anonymous crawlers can reach the card routes: `/dishes/[id]/opengraph-image`, `/u/[handle]/opengraph-image`, `/opengraph-image` (and any `twitter-image` equivalents). Today only the dish/profile **pages** and `GET /api/dishes/[id]` are exempt; the new sub-paths must be added or they'll redirect to sign-in and the crawler gets HTML instead of an image.

### Card text defaults

| Surface | `og:title` | `og:description` | Baked into card |
|---|---|---|---|
| Dish | dish name | subtitle, else `tags joined · serves N`, else "A recipe on Dinner Spinner" | wordmark + name + meta line |
| Profile | `{Name}'s recipes` (or `@handle`) | bio, else `N recipes on Dinner Spinner` | avatar/photo + name + `@handle` + "N recipes" |
| Home | "Dinner Spinner" (existing) | existing tagline | logo + tagline |

---

## Edge cases

- **Private or missing dish** → fallback card; `generateMetadata` returns generic OG (the page itself already 404s to anon, so crawlers never see dish-specific meta).
- **Dish with no image** (`image` null — generation pending/failed) → fallback/wordmark-only card; no broken `<img>`.
- **Long titles** → Satori flexbox wraps; clamp to N lines with ellipsis.
- **Translated titles** (the app's translation feature) → Spectral/Schibsted cover Latin + European accents; non-Latin scripts tofu in the *image* only. Acceptable per non-goals.
- **WhatsApp preview cache** → links already shared keep their stale (blank) preview for days. New shares unfurl immediately. Manual bust: append `?v=2`. Documented, not engineered around.

## Testing & verification

- **Unit (`npx tsx --test`):** `dishOgText` / `profileOgText` (subtitle vs tags-vs-fallback branches), and the public-only query predicate logic. Card image output (Satori/sharp) is not unit-tested — verified manually.
- **Local:** `next dev`, load `/dishes/<id>/opengraph-image` → confirm a 1200×630 JPEG renders; view-source the dish page → confirm `og:*` + `twitter:*` tags with absolute URLs.
- **Post-deploy:**
  - `curl -sS <dish-url>` → grep the `og:`/`twitter:` meta.
  - `curl -sSI <og-image-url>` → confirm `200` + `content-type: image/jpeg` + a small `content-length`.
  - Validate on a link-preview debugger (e.g. opengraph.xyz / Facebook sharing debugger).
  - Share a fresh dish link into a WhatsApp chat and confirm the banner.

## Implementation notes / constraints

- **Read the Next 16 docs first** (`node_modules/next/dist/docs/`) for the `opengraph-image` / `twitter-image` file conventions and the Metadata API — per AGENTS.md this Next version diverges from training data. Confirm: default-export return types (a custom `Response` is allowed), the `size`/`contentType`/`runtime`/`alt` exports, dynamic `params` access in the route, and whether `opengraph-image` auto-emits `twitter:image`.
- `next/og`'s `ImageResponse` must run on the **Node runtime** here because the result is post-processed by sharp.
- Keep the `@vercel/blob` / `sharp` usage behind the existing `lib/` seam; the new card routes import helpers, not the SDKs directly (matches the `lib/image-storage.ts` convention).
