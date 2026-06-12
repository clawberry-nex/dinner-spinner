# Android Share Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users share a recipe link/text into Dinner Spinner from Android's share sheet; it opens `/add` with the ingest textarea prefilled.

**Architecture:** Web Share Target API — a `GET` `share_target` in the PWA manifest points at `/add`; on mount, `IngestInput` reads the shared `title/text/url` from `window.location.search` and prefills the textarea (only when not resuming an in-flight ingest). The user taps the existing **Ingest recipe** button; the whole ingest → save → image flow is unchanged. No backend, no service-worker changes.

**Tech Stack:** Next.js 16 (App Router), TypeScript, PWA manifest (`app/manifest.webmanifest`), `node:test` via `npx tsx --test`.

Spec: `docs/superpowers/specs/2026-06-12-android-share-target-design.md`. Work on branch `feat/android-share-target`.

---

### Task 1: Pure share-prefill helper

**Files:**
- Create: `lib/share-prefill.ts`
- Test: `lib/share-prefill.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/share-prefill.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSharePrefillFromSearch } from "./share-prefill.ts";

test("returns the url when only url is shared", () => {
  assert.equal(buildSharePrefillFromSearch("?url=https://x.com/r"), "https://x.com/r");
});

test("joins distinct title, text, url with newlines", () => {
  assert.equal(
    buildSharePrefillFromSearch("?title=Soup&text=yum&url=https://x.com/r"),
    "Soup\nyum\nhttps://x.com/r",
  );
});

test("de-dupes when a value repeats (text === url)", () => {
  assert.equal(
    buildSharePrefillFromSearch("?text=https://x.com/r&url=https://x.com/r"),
    "https://x.com/r",
  );
});

test("ignores empty / whitespace-only params", () => {
  assert.equal(buildSharePrefillFromSearch("?title=&text=%20%20&url="), "");
});

test("returns empty string when there are no params", () => {
  assert.equal(buildSharePrefillFromSearch(""), "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/share-prefill.test.ts`
Expected: FAIL — cannot find module `./share-prefill.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/share-prefill.ts
// Combine an Android Web Share Target's title/text/url query params (any subset)
// into a single ingest-input string: trim, drop empties, de-dupe, newline-join.
export function buildSharePrefillFromSearch(search: string): string {
  const p = new URLSearchParams(search);
  const parts = [p.get("title"), p.get("text"), p.get("url")]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  const deduped = parts.filter((s, i) => parts.indexOf(s) === i);
  return deduped.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/share-prefill.test.ts`
Expected: PASS — `# pass 5  # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/share-prefill.ts lib/share-prefill.test.ts
git commit -m "feat(share): pure helper to combine shared title/text/url"
```

---

### Task 2: Register the share_target in the manifest

**Files:**
- Modify: `app/manifest.webmanifest` (add a top-level `share_target` member)
- Test: `lib/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/manifest.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("manifest registers a GET share_target pointing at /add", () => {
  const raw = fs.readFileSync(new URL("../app/manifest.webmanifest", import.meta.url), "utf8");
  const m = JSON.parse(raw);
  assert.ok(m.share_target, "share_target missing");
  assert.equal(m.share_target.action, "/add");
  assert.equal(m.share_target.method, "GET");
  assert.deepEqual(m.share_target.params, { title: "title", text: "text", url: "url" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/manifest.test.ts`
Expected: FAIL — `share_target missing`.

- [ ] **Step 3: Add the share_target member**

In `app/manifest.webmanifest`, add a comma after the closing `]` of the `"shortcuts"` array and insert this member before the final closing `}`:

```json
  "share_target": {
    "action": "/add",
    "method": "GET",
    "params": { "title": "title", "text": "text", "url": "url" }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/manifest.test.ts`
Expected: PASS — `# pass 1  # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add app/manifest.webmanifest lib/manifest.test.ts
git commit -m "feat(share): register Android share_target in the PWA manifest"
```

---

### Task 3: Prefill IngestInput from the shared params

No unit test — this is React mount-effect glue (the combine logic is already tested in Task 1). Verified by typecheck, the existing suite staying green, and a manual `/add?...` check.

**Files:**
- Modify: `app/add/ingest-input.tsx` (import the helper; extend the existing mount `useEffect`)

- [ ] **Step 1: Add the import**

At the top of `app/add/ingest-input.tsx`, alongside the other imports, add:

```ts
import { buildSharePrefillFromSearch } from "@/lib/share-prefill";
```

- [ ] **Step 2: Extend the resume `useEffect` to prefill when not resuming**

Replace the existing mount effect (the one that calls `readStash()` then `resumeFromStash`):

```ts
  useEffect(() => {
    const pending = readStash();
    if (!pending) return;
    setLoading(true);
    setStartedAt(pending.startedAt);
    setElapsedSec(Math.floor((Date.now() - pending.startedAt) / 1000));
    void resumeFromStash(pending);
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

with:

```ts
  useEffect(() => {
    const pending = readStash();
    if (!pending) {
      // No in-flight ingest to resume — if we arrived via the Android share
      // target (/add?title=…&text=…&url=…), prefill the textarea. The user
      // still taps "Ingest recipe" to run it.
      const prefill = buildSharePrefillFromSearch(window.location.search);
      if (prefill) setInput(prefill);
      return;
    }
    setLoading(true);
    setStartedAt(pending.startedAt);
    setElapsedSec(Math.floor((Date.now() - pending.startedAt) / 1000));
    void resumeFromStash(pending);
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 3: Typecheck, lint, and run the full suite**

Run: `npx next typegen && npx tsc --noEmit`
Expected: exit 0, no errors.

Run: `npx eslint lib/share-prefill.ts lib/share-prefill.test.ts lib/manifest.test.ts app/add/ingest-input.tsx`
Expected: exit 0.

Run: `npx tsx --test $(find lib app -name '*.test.ts' | sort)`
Expected: the new tests pass; total failures unchanged from baseline (only the 6 pre-existing browser-storage tests: `install-prompt`, `last-servings`, `meal-plan`, `readThemeSetting`×2, `writeThemeSetting`).

- [ ] **Step 4: Manual verification (dev server)**

Run: `npm run dev`, then in a browser (logged in):
- Visit `/add?text=Quick%20tomato%20pasta&url=https://example.com/pasta` → the textarea is prefilled with `Quick tomato pasta` on one line and the URL on the next; nothing auto-submits.
- Visit `/add` with no params → textarea is empty (no regression).
- Start an ingest, reload mid-flight → the resume overlay shows (a share prefill must NOT replace a resuming ingest).

- [ ] **Step 5: Commit**

```bash
git add app/add/ingest-input.tsx
git commit -m "feat(share): prefill /add ingest input from the Android share target"
```

---

## Notes (no task needed)

- **Auth:** `/add` requires a session; `proxy.ts` already redirects a lapsed session to `/auth/signin?callbackUrl=<pathname+search>`, preserving the shared params. No change.
- **Deploy:** ships via the normal Vercel deploy from `main` after the branch merges. An already-installed PWA may need a reopen/reinstall to pick up `share_target`.
- **Out of scope:** image/file sharing (needs a `POST` share_target + `public/sw.js` handler) — separate future plan.
