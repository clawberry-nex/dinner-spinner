import { test } from "node:test";
import assert from "node:assert/strict";

function installLocalStorageShim() {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
  return store;
}

const store = installLocalStorageShim();

const { isIOS, isStandalone, readDismissed, writeDismissed, shouldShowPrompt } =
  await import("./install-prompt.ts");

test("isIOS matches iPhone, iPad, iPod user agents", () => {
  assert.equal(
    isIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15"),
    true,
  );
  assert.equal(isIOS("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)"), true);
  assert.equal(isIOS("Mozilla/5.0 (iPod touch; CPU iPhone OS 17_5)"), true);
});

test("isIOS rejects Android and desktop browsers", () => {
  assert.equal(isIOS("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), false);
  assert.equal(isIOS("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), false);
  assert.equal(isIOS("Mozilla/5.0 (X11; Linux x86_64)"), false);
});

test("isIOS detects iPadOS masquerading as Mac via Mac-with-touch heuristic", () => {
  // iPadOS 13+ reports as Macintosh; distinguishing requires maxTouchPoints.
  // The function accepts an optional maxTouchPoints arg for this case.
  assert.equal(
    isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5),
    true,
  );
  // Regular Mac (no touch) stays false.
  assert.equal(
    isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 0),
    false,
  );
});

test("isStandalone returns true for standalone display-mode matches", () => {
  assert.equal(isStandalone({ matches: true }, false), true);
  assert.equal(isStandalone({ matches: false }, true), true); // iOS navigator.standalone
  assert.equal(isStandalone({ matches: false }, false), false);
  assert.equal(isStandalone(null, undefined), false);
});

test("readDismissed returns null when nothing is stored", () => {
  store.clear();
  assert.equal(readDismissed(), null);
});

test("writeDismissed round-trips a timestamp", () => {
  store.clear();
  const now = 1_700_000_000_000;
  writeDismissed(now);
  assert.equal(readDismissed(), now);
});

test("readDismissed tolerates corrupt values", () => {
  store.clear();
  store.set("installPromptDismissedAt", "not a number");
  assert.equal(readDismissed(), null);
  store.set("installPromptDismissedAt", JSON.stringify({ oops: true }));
  assert.equal(readDismissed(), null);
});

test("shouldShowPrompt hides when already installed", () => {
  store.clear();
  assert.equal(shouldShowPrompt({ installed: true, now: 0 }), false);
});

test("shouldShowPrompt shows when not installed and never dismissed", () => {
  store.clear();
  assert.equal(shouldShowPrompt({ installed: false, now: 100 }), true);
});

test("shouldShowPrompt hides within 30 days of dismissal, re-shows after", () => {
  store.clear();
  const day = 24 * 60 * 60 * 1000;
  writeDismissed(0);
  assert.equal(shouldShowPrompt({ installed: false, now: 29 * day }), false);
  assert.equal(shouldShowPrompt({ installed: false, now: 31 * day }), true);
});
