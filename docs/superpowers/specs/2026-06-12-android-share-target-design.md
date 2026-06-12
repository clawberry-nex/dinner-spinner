# Android Share Target — share recipes into Dinner Spinner

**Date:** 2026-06-12
**Status:** Approved design → pending spec review → implementation plan

## Summary

Let users share a recipe (a **link or text**) into Dinner Spinner from Android's
system share sheet. Implemented with the **Web Share Target API**: the installed
PWA registers as a share target; shared content lands on `/add` with the
Magic-ingest textarea **prefilled**, and the user taps **Ingest recipe** to run
the existing ingest pipeline. No backend changes; one small client change plus a
manifest addition.

## Goals

- Dinner Spinner appears in Android's share sheet for **links and text**.
- Sharing opens `/add` with the shared content prefilled in the ingest textarea.
- The user reviews/edits, then taps Ingest — reusing the existing
  ingest → save → image flow **unchanged**.
- Minimal surface: a manifest member + a small mount-time prefill in one component.

## Non-goals (this iteration — deliberate)

- **Images / files** via share (recipe screenshots/photos). That needs a `POST`
  share-target with `enctype: multipart/form-data` **and** a `public/sw.js`
  handler to catch the upload. Deferred to a fast-follow per the "links & text
  first" decision.
- **Auto-ingest / auto-save** on share. Chosen behavior is prefill-only; the user
  taps Ingest.
- **iOS** share sheet — Web Share Target is Chromium/Android-PWA only; iOS does
  not support it. (Existing paste/URL/photo entry on `/add` still works there.)
- **Batch / multi-recipe.** A share is treated as a single recipe via the
  existing single-ingest path (`/api/ingest`), not the batch importer.

## Design

### 1. Manifest — `app/manifest.webmanifest`

Add a `share_target` member:

```json
"share_target": {
  "action": "/add",
  "method": "GET",
  "params": { "title": "title", "text": "text", "url": "url" }
}
```

- `GET` (default enctype `application/x-www-form-urlencoded`) → **no service
  worker required**.
- `action: "/add"` is within the existing `scope: "/"`.
- The OS appends whatever the source app provides as query params:
  `/add?title=…&text=…&url=…` (any subset may be present/absent).

### 2. Prefill — `app/add/ingest-input.tsx`

On mount (client `useEffect`), read the share params from
`window.location.search` (chosen over `useSearchParams` to avoid its
Suspense-boundary requirement in this client component):

- Build the prefill from `[title, text, url]`: drop empty values, de-duplicate
  (common case: `text === url`), join the remainder with newlines.
- If the result is non-empty, `setInput(prefill)`.
- **Do not auto-submit.** The existing "Ingest recipe" button runs the existing
  flow exactly as today.
- **Resume-stash precedence:** the existing `pending-ingest` localStorage resume
  (an in-flight ingest being recovered on mount) takes priority. Only apply a
  share prefill when there is no pending ingest being resumed, so a share can't
  clobber a recovering job.

### 3. Auth / lapsed session — no change

`/add` requires a session (`proxy.ts`). The installed PWA is logged in, so the
share opens straight onto `/add`. If the session has lapsed, `proxy.ts` already
redirects to `/auth/signin?callbackUrl=<pathname+search>`, **preserving the
shared params**; after sign-in the user returns to `/add` prefilled. Nothing to
change here.

### 4. Data flow

```
Android share sheet
  → (PWA installed) Dinner Spinner
  → OS opens /add?title=…&text=…&url=…
  → IngestInput mounts → reads params → prefills textarea
  → user taps "Ingest recipe"
  → existing POST /api/ingest → poll job → POST /api/dishes → image → /dishes/[id]
```

### 5. Error / edge handling

- **No params / empty** → `/add` opens normally with an empty input. Harmless.
- **URL in `text` vs `url`** (varies by source app) → combining `[title,text,url]`
  covers all cases; the ingest accepts a URL or free text either way.
- **Bare URL** relies on the existing ingest's URL handling (claude-agent
  fetches/parses the page) — unchanged behavior, not introduced by this feature.
- **PWA not installed** → Dinner Spinner won't appear in the share sheet
  (expected; Android only lists installed PWAs).

### 6. Testing

- Manifest JSON validates and includes `share_target`.
- Local: visiting `/add?text=<recipe%20text>&url=<link>` prefills the textarea
  with the combined value; **no** auto-submit.
- Local: `/add` with no params behaves exactly as today (no regression).
- Local: a resuming `pending-ingest` is not overwritten by a share prefill.
- Android (manual, post-deploy): install the PWA (Chrome → Add to Home screen);
  share a recipe URL from Chrome → Dinner Spinner appears in the sheet → `/add`
  opens prefilled → Ingest works end-to-end.

## Deployment notes

- The manifest change ships via the normal Vercel deploy from `main`.
- An **already-installed** PWA may need to be re-opened (manifest refresh) or
  reinstalled to pick up the new `share_target`.

## Files touched

- `app/manifest.webmanifest` — add the `share_target` member.
- `app/add/ingest-input.tsx` — mount-time prefill from share params, guarded
  against the resume path.
