# AI dish-photo generation — design

**Status:** approved 2026-05-04 · **Owner:** Mirko · **Implementation:** scaffolded, provider URL plugged in later

## Goal

Replace the emoji+gradient placeholder on dishes with AI-generated photos that share a single, strict visual identity — overhead framing, consistent lighting, plates, cutlery, surface, palette. Generate via an external image model that's fast and cheap. Provider isn't picked yet; this work scaffolds everything else so swapping in the real provider is "fill in two env vars and (if needed) tweak one request shape."

## Non-goals

- Multi-image gallery / re-roll history per dish (overwrites in place)
- In-app image editing / cropping
- Per-dish prompt overrides — the strict house style is the point
- Background queue / job system — sync is enough for ~20 dishes
- Cost tracking dashboard
- Public unauthenticated generation

## User-facing surface

Two trigger points, both admin-only:

1. **Single dish — admin form** (`/admin`, dish editor): a "Generate" button next to the existing `imageUrl` input. Click → blocks for a few seconds → fills the input with the resulting Vercel Blob URL → user saves the dish as normal.
2. **Bulk backfill — admin list**: a "Generate missing images" button on the dish list. Runs through every dish where `image_url IS NULL`, posts to a bulk endpoint, shows a toast like "Generated 17 — 3 failed (see console)".

`(b)` per-dish-page button and `(d)` auto-on-create are explicitly skipped — generation is always an explicit click so credits never burn silently.

## Module layout

Three new pure modules + one extended route.

### `lib/image-prompt.ts`

```ts
export function buildImagePrompt(dish: Pick<Dish, "title" | "subtitle">): string;
```

Concatenates the hardcoded house-style preamble (overhead 45° angle, soft daylight, matte ceramic plate, dark linen, no garnish-spam, no text in image, photorealistic, etc.) with the dish-specific tail. Subtitle is appended when present, otherwise just title. Pure — unit-testable without a network or DB.

### `lib/image-provider.ts`

```ts
export interface ImageProvider {
  generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }>;
}

export function getProvider(): ImageProvider;
```

`getProvider()` reads env:

- If `IMAGE_GEN_URL` and `IMAGE_GEN_TOKEN` are both set → returns `HttpProvider`.
- Else → returns `StubProvider` whose `generate()` throws a clear `"image generation not configured: set IMAGE_GEN_URL and IMAGE_GEN_TOKEN in env"`.

`HttpProvider` performs a `POST` to the configured URL with `Authorization: Bearer ${token}` and a JSON body `{ prompt }`. It handles both common provider response shapes:

- `Content-Type: image/*` → use the response body bytes directly.
- `Content-Type: application/json` with a `{ url: string }` field → fetch that URL, return its bytes.

If the provider needs additional request fields (model name, dimensions, seed) when one's picked, that's a small edit confined to `HttpProvider` — interface and callers don't change.

### `lib/image-storage.ts`

```ts
export async function uploadDishImage(
  dishId: number,
  bytes: Uint8Array,
  mime: string,
): Promise<string>; // public CDN URL
```

Wraps `@vercel/blob`'s `put()` with path `dishes/{dishId}/{nanoid()}.{ext}`. nanoid suffix avoids cache collisions when the same dish is regenerated. Returns the permanent CDN URL written into `dishes.image_url`.

### `app/api/dishes/[id]/image/route.ts`

`POST` handler. Auth: admin cookie OR `Authorization: Bearer ${API_TOKEN}`. Flow:

```
read dish row
→ buildImagePrompt(dish)
→ getProvider().generate(prompt)
→ uploadDishImage(id, bytes, mime)
→ UPDATE dishes SET image_url = $1, updated_at = now() WHERE id = $2
→ 200 { imageUrl }
```

Errors: any failure in the prompt → provider → storage chain → 502 with the underlying error message verbatim (so the admin UI toast surfaces a clear cause). Auth fail → 401, missing dish → 404, non-numeric id → 400.

### `app/api/dishes/images/backfill/route.ts`

`POST` handler. Auth same as above. Body: `{ overwrite?: boolean }` (default `false`).

```
SELECT id FROM dishes WHERE $overwrite OR image_url IS NULL
→ run generations with concurrency cap of 4 (Promise.allSettled with a small batcher)
→ return { ok: number, failed: Array<{ dishId: number; error: string }> }
```

The 4-way concurrency cap keeps us under typical provider rate limits and inside Vercel's function timeout (60s on Hobby, 300s on Pro). With a 3s/image provider, 20 dishes finish in ~15s wall clock.

## Data flow (single-dish generate)

```
admin form clicks Generate
  POST /api/dishes/[id]/image
    → buildImagePrompt(dish)
    → provider.generate(prompt)         ← HttpProvider POSTs IMAGE_GEN_URL
    → uploadDishImage(id, bytes, mime)  ← @vercel/blob.put()
    → UPDATE dishes SET image_url = ...
    → 200 { imageUrl }
  admin form: setDraft({ ...draft, imageUrl })
```

## Schema impact

None. `dishes.image_url` already exists. The DishArt component already prefers `imageUrl` when set, falling back to emoji+accent. So once a generated URL lands in that column, the front-end already renders it correctly.

## Env

New, all production-only:

| Var | Purpose |
|---|---|
| `IMAGE_GEN_URL` | Provider POST endpoint |
| `IMAGE_GEN_TOKEN` | Bearer token for the provider |
| `BLOB_READ_WRITE_TOKEN` | Auto-injected when the Vercel Blob store is added to the project — no manual setting needed |

`.env.example` gets the first two with placeholder values and a comment explaining `BLOB_READ_WRITE_TOKEN` is automatic.

## Dependencies

- `@vercel/blob` — single new dependency, used only by `lib/image-storage.ts`.

## Testing

| Layer | What's tested | Where |
|---|---|---|
| `buildImagePrompt` | preamble present, title/subtitle interpolated, missing subtitle handled, no double-spaces or stray punctuation | `lib/image-prompt.test.ts` |
| `getProvider` factory | returns `StubProvider` when env unset; returns `HttpProvider` when both vars set | `lib/image-provider.test.ts` |
| `StubProvider.generate` | throws with the configured message | `lib/image-provider.test.ts` |
| `HttpProvider`, `uploadDishImage`, route handlers | No automated tests — verified by hand against the deployed site once a real provider is wired in. The pure layers above carry the load. | — |

## Edge cases

- **Provider returns non-200**: `HttpProvider` throws `Error("provider returned ${status}: ${body.slice(0,200)}")` so the admin sees a useful toast instead of a generic 500.
- **Provider returns a JSON `{url}` whose URL itself 404s**: same handling as the above — the secondary fetch's status is included in the error.
- **Blob upload fails**: bubbles up; we don't update `image_url`, so the dish is unchanged. Admin can retry.
- **Bulk run, half succeed half fail**: response includes the per-dish failure list; the successes are committed (each generation is its own transaction-ish write).
- **Same dish regenerated**: new nanoid path, old blob is left in place. Cleanup is a future concern (cheap enough at 20 dishes).
- **Stub provider clicked by admin before configuration**: clear toast text directs the user to set the two env vars.

## Implementation order (rough)

1. `lib/image-prompt.ts` + tests — pure, no infra. Iterate the house-style copy here.
2. `lib/image-provider.ts` + tests — interface, stub, factory.
3. `lib/image-storage.ts` — Blob wrapper. (Add the dep, click "Add Blob" in Vercel dashboard.)
4. `app/api/dishes/[id]/image/route.ts` — single-dish endpoint.
5. Admin form: "Generate" button next to imageUrl input.
6. `app/api/dishes/images/backfill/route.ts` — bulk endpoint.
7. Admin list: "Generate missing images" button.
8. Plug in real provider URL/token, regenerate the 20 existing dishes via the bulk endpoint.

Steps 1–7 are fully testable with the stub. Step 8 unblocks the actual photos.
