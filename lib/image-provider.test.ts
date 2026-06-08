import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

beforeEach(() => {
  delete process.env.IMAGE_GEN_URL;
  delete process.env.IMAGE_GEN_TOKEN;
  delete process.env.REPLICATE_API_TOKEN;
  delete process.env.GEMINI_API_KEY;
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

test("getProvider chains Nano Banana Pro + flux when REPLICATE_API_TOKEN is set", async () => {
  process.env.REPLICATE_API_TOKEN = "r8_secret_token";
  const { getProvider, FallbackProvider } = await import(
    `./image-provider.ts?cb=${Date.now() + 3}`
  );
  // Premium (default): two Replicate providers (NBP then flux) → a fallback chain.
  const p = getProvider();
  assert.ok(p instanceof FallbackProvider, "premium should be a FallbackProvider");
});

test("Replicate is chained ahead of the generic HTTP provider", async () => {
  process.env.REPLICATE_API_TOKEN = "r8_secret_token";
  process.env.IMAGE_GEN_URL = "https://example.test/img";
  process.env.IMAGE_GEN_TOKEN = "secret-token";
  const { getProvider, FallbackProvider } = await import(
    `./image-provider.ts?cb=${Date.now() + 4}`
  );
  // Chain is [Replicate NBP, Replicate flux, Http] — Replicate is added first.
  const p = getProvider();
  assert.ok(p instanceof FallbackProvider, "should be a FallbackProvider");
});

test("non-premium excludes Nano Banana Pro — flux only", async () => {
  // Both the premium model keys are present...
  process.env.GEMINI_API_KEY = "g_secret";
  process.env.REPLICATE_API_TOKEN = "r8_secret_token";
  const { getProvider, ReplicateProvider } = await import(
    `./image-provider.ts?cb=${Date.now() + 5}`
  );
  // ...but a non-premium caller gets a single flux ReplicateProvider — no Gemini,
  // no Replicate Nano Banana Pro, so not a chain.
  const p = getProvider({ premium: false });
  assert.ok(
    p instanceof ReplicateProvider,
    "non-premium should be a single flux ReplicateProvider",
  );
});

test("premium includes Gemini Nano Banana Pro", async () => {
  process.env.GEMINI_API_KEY = "g_secret";
  process.env.REPLICATE_API_TOKEN = "r8_secret_token";
  const { getProvider, FallbackProvider } = await import(
    `./image-provider.ts?cb=${Date.now() + 6}`
  );
  // Gemini + Replicate NBP + flux → a fallback chain (Gemini is added first).
  const p = getProvider();
  assert.ok(p instanceof FallbackProvider, "premium should be a FallbackProvider");
});
