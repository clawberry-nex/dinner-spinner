import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { fetchAsJpegDataUrl } from "./image.ts";

function stubFetch(body: { ok: boolean; bytes?: Buffer }): typeof fetch {
  return (async () => ({
    ok: body.ok,
    arrayBuffer: async () => {
      const b = body.bytes ?? Buffer.alloc(0);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  })) as unknown as typeof fetch;
}

test("fetchAsJpegDataUrl converts a fetched image to a jpeg data url", async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .png().toBuffer();
  const url = await fetchAsJpegDataUrl("https://blob/x.webp", { fetcher: stubFetch({ ok: true, bytes: png }) });
  assert.ok(url && url.startsWith("data:image/jpeg;base64,"));
});

test("fetchAsJpegDataUrl returns null on a non-ok response", async () => {
  assert.equal(await fetchAsJpegDataUrl("https://blob/missing", { fetcher: stubFetch({ ok: false }) }), null);
});

test("fetchAsJpegDataUrl returns null when the bytes are not an image", async () => {
  assert.equal(
    await fetchAsJpegDataUrl("https://blob/junk", { fetcher: stubFetch({ ok: true, bytes: Buffer.from("not an image") }) }),
    null,
  );
});
