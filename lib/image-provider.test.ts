import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Image generation now goes through the Nex API (claude-agent /api/v1/images),
// not direct Gemini/Replicate. getProvider builds a NexProvider from env and
// maps premium → nano-banana-pro, non-premium → nano-banana-2.

beforeEach(() => {
  delete process.env.NEX_API_TOKEN;
  delete process.env.CLAUDE_AGENT_URL;
});

test("getProvider returns the stub when NEX_API_TOKEN is missing", async () => {
  const { getProvider } = await import(`./image-provider.ts?cb=${Date.now()}`);
  const p = getProvider();
  await assert.rejects(() => p.generate("anything"), /not configured/i);
});

test("premium maps to nano-banana-pro at 2K", async () => {
  process.env.NEX_API_TOKEN = "nxk_test";
  const { getProvider, NexProvider } = await import(`./image-provider.ts?cb=${Date.now() + 1}`);
  const p = getProvider({ premium: true });
  assert.ok(p instanceof NexProvider, "should be a NexProvider");
  assert.equal(p.model, "nano-banana-pro");
  assert.equal(p.size, "2K");
});

test("non-premium maps to nano-banana-2 at 1K", async () => {
  process.env.NEX_API_TOKEN = "nxk_test";
  const { getProvider, NexProvider } = await import(`./image-provider.ts?cb=${Date.now() + 2}`);
  const p = getProvider({ premium: false });
  assert.ok(p instanceof NexProvider, "should be a NexProvider");
  assert.equal(p.model, "nano-banana-2");
  assert.equal(p.size, "1K");
});

test("default caller (no opts) is premium", async () => {
  process.env.NEX_API_TOKEN = "nxk_test";
  const { getProvider, NexProvider } = await import(`./image-provider.ts?cb=${Date.now() + 3}`);
  const p = getProvider();
  assert.ok(p instanceof NexProvider);
  assert.equal((p as InstanceType<typeof NexProvider>).model, "nano-banana-pro");
});
