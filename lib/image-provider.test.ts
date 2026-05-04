import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

beforeEach(() => {
  delete process.env.IMAGE_GEN_URL;
  delete process.env.IMAGE_GEN_TOKEN;
  delete process.env.REPLICATE_API_TOKEN;
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

test("getProvider returns the Replicate provider when REPLICATE_API_TOKEN is set", async () => {
  process.env.REPLICATE_API_TOKEN = "r8_secret_token";
  const { getProvider, ReplicateProvider } = await import(
    `./image-provider.ts?cb=${Date.now() + 3}`
  );
  const p = getProvider();
  assert.ok(p instanceof ReplicateProvider, "should be ReplicateProvider");
});

test("Replicate takes precedence over the generic HTTP env vars", async () => {
  process.env.REPLICATE_API_TOKEN = "r8_secret_token";
  process.env.IMAGE_GEN_URL = "https://example.test/img";
  process.env.IMAGE_GEN_TOKEN = "secret-token";
  const { getProvider, ReplicateProvider } = await import(
    `./image-provider.ts?cb=${Date.now() + 4}`
  );
  const p = getProvider();
  assert.ok(
    p instanceof ReplicateProvider,
    "Replicate should win over IMAGE_GEN_*",
  );
});
