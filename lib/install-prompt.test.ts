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

function installDocumentShim() {
  let cookieJar = "";
  (globalThis as unknown as { document: Document }).document = {
    get cookie() {
      return cookieJar;
    },
    set cookie(value: string) {
      // Mimic just enough: split first ;, store name=value; ignore expiry/etc.
      const [pair] = value.split(";");
      const [name, val] = pair.split("=");
      const trimmedName = name.trim();
      const parts = cookieJar ? cookieJar.split("; ").filter(Boolean) : [];
      const filtered = parts.filter((p) => !p.startsWith(`${trimmedName}=`));
      filtered.push(`${trimmedName}=${val}`);
      cookieJar = filtered.join("; ");
    },
  } as unknown as Document;
  return {
    clear: () => {
      cookieJar = "";
    },
  };
}

const store = installLocalStorageShim();
const cookies = installDocumentShim();

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

test("readDismissed returns false when nothing is stored", () => {
  store.clear();
  cookies.clear();
  assert.equal(readDismissed(), false);
});

test("writeDismissed sets the flag in localStorage and a cookie backup", () => {
  store.clear();
  cookies.clear();
  writeDismissed();
  assert.equal(readDismissed(), true);
  assert.match(document.cookie, /installPromptDismissed=1/);
});

test("shouldShowPrompt hides when already installed", () => {
  store.clear();
  cookies.clear();
  assert.equal(shouldShowPrompt({ installed: true }), false);
});

test("shouldShowPrompt shows when not installed and never dismissed", () => {
  store.clear();
  cookies.clear();
  assert.equal(shouldShowPrompt({ installed: false }), true);
});

test("shouldShowPrompt stays hidden once dismissed", () => {
  store.clear();
  cookies.clear();
  writeDismissed();
  assert.equal(shouldShowPrompt({ installed: false }), false);
});

test("shouldShowPrompt falls back to the cookie when localStorage is wiped", () => {
  store.clear();
  cookies.clear();
  writeDismissed();
  // Simulate localStorage being cleared (Safari ITP, "clear on close", etc.)
  // — cookie should still suppress the prompt.
  store.clear();
  assert.equal(readDismissed(), false);
  assert.equal(shouldShowPrompt({ installed: false }), false);
});
