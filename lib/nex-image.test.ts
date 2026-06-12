import { test } from "node:test";
import assert from "node:assert/strict";
import { generateImageViaNex, NexImageError } from "./nex-image.ts";

interface Call { url: string; init: RequestInit }

function fakeFetch(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.body,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("generateImageViaNex POSTs to <base>/images with the bearer token and decodes base64", async () => {
  const b64 = Buffer.from("PNGDATA").toString("base64");
  const { impl, calls } = fakeFetch([{ body: { image: b64, mime: "image/png", model: "gemini-3.1-flash-image" } }]);
  const out = await generateImageViaNex({
    prompt: "a pie", model: "nano-banana-2", token: "tok", baseUrl: "https://nex.example:10000", fetcher: impl,
  });
  assert.ok(out.bytes instanceof Uint8Array);
  assert.equal(Buffer.from(out.bytes).toString(), "PNGDATA");
  assert.equal(out.mime, "image/png");
  // Funnel base already maps to /api/v1, so the path is bare /images (no /api/v1 prefix).
  assert.equal(calls[0].url, "https://nex.example:10000/images");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer tok");
  const sent = JSON.parse(calls[0].init.body as string);
  assert.equal(sent.prompt, "a pie");
  assert.equal(sent.model, "nano-banana-2");
});

test("generateImageViaNex forwards aspect_ratio and size when given", async () => {
  const b64 = Buffer.from("x").toString("base64");
  const { impl, calls } = fakeFetch([{ body: { image: b64, mime: "image/jpeg" } }]);
  await generateImageViaNex({ prompt: "p", model: "nano-banana-pro", aspectRatio: "1:1", size: "2K", token: "t", baseUrl: "https://b", fetcher: impl });
  const sent = JSON.parse(calls[0].init.body as string);
  assert.equal(sent.aspect_ratio, "1:1");
  assert.equal(sent.size, "2K");
});

test("generateImageViaNex throws NexImageError carrying the API error code on non-2xx", async () => {
  const { impl } = fakeFetch([{ ok: false, status: 403, body: { error: { code: "scope_missing", message: "token lacks scope 'images:generate'" } } }]);
  await assert.rejects(
    () => generateImageViaNex({ prompt: "p", model: "nano-banana-2", token: "t", baseUrl: "https://b", fetcher: impl }),
    (err: unknown) => err instanceof NexImageError && err.code === "scope_missing" && err.status === 403,
  );
});

test("generateImageViaNex throws when the response has no image", async () => {
  const { impl } = fakeFetch([{ body: { mime: "image/png" } }]);
  await assert.rejects(
    () => generateImageViaNex({ prompt: "p", model: "nano-banana-2", token: "t", baseUrl: "https://b", fetcher: impl }),
    /no image/i,
  );
});
