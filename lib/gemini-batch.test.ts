import { test } from "node:test";
import assert from "node:assert/strict";
import { submitImageBatch, pollBatch } from "./gemini-batch.ts";

// gemini-batch is now a thin adapter over the Nex batch API. It keeps the old
// Gemini-shaped return types (state strings, results[].bytes) so the backfill +
// import consumers don't change, but auth is a Nex token and the transport is Nex.

function router(handlers: Record<string, { status?: number; json?: unknown; bytes?: string; ct?: string }>) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: init?.body as string | undefined });
    // Match by suffix (longest-first so /:id/:key wins over /:id).
    const key = Object.keys(handlers).sort((a, b) => b.length - a.length).find((k) => url.includes(k));
    const h = key ? handlers[key] : { status: 404, json: { error: { code: "not_found", message: "nope" } } };
    return {
      ok: (h.status ?? 200) < 400,
      status: h.status ?? 200,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? h.ct ?? "application/json" : null) },
      json: async () => h.json,
      text: async () => JSON.stringify(h.json),
      arrayBuffer: async () => Buffer.from(h.bytes ?? "", "utf8"),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("submitImageBatch returns the Nex job id as `name`", async () => {
  const { impl, calls } = router({ "/images/batch": { json: { job_id: "job_abc", status: "running", request_count: 2 } } });
  const out = await submitImageBatch("tok", "nano-banana-pro", "display", [{ key: "dish_1", prompt: "a" }, { key: "dish_2", prompt: "b" }], { baseUrl: "https://b", fetcher: impl });
  assert.equal(out.name, "job_abc");
  const sent = JSON.parse(calls[0].body as string);
  assert.equal(sent.model, "nano-banana-pro");
  assert.equal(sent.requests.length, 2);
});

test("pollBatch maps running → BATCH_STATE_RUNNING with counts, no results", async () => {
  const { impl } = router({ "/images/batch/job_abc": { json: { status: "running", counts: { total: 2, pending: 1, succeeded: 1, failed: 0 } } } });
  const out = await pollBatch("tok", "job_abc", { baseUrl: "https://b", fetcher: impl });
  assert.equal(out.state, "BATCH_STATE_RUNNING");
  assert.deepEqual(out.counts, { total: 2, pending: 1, succeeded: 1, failed: 0 });
  assert.equal(out.results, undefined);
});

test("pollBatch on done maps to BATCH_STATE_SUCCEEDED and fetches per-key bytes", async () => {
  const { impl } = router({
    "/images/batch/job_abc/dish_1": { ct: "image/png", bytes: "PNGBYTES" },
    "/images/batch/job_abc": {
      json: {
        status: "done",
        counts: { total: 2, pending: 0, succeeded: 1, failed: 1 },
        results: [
          { key: "dish_1", mime: "image/png" },
          { key: "dish_2", error: "safety block" },
        ],
      },
    },
  });
  const out = await pollBatch("tok", "job_abc", { baseUrl: "https://b", fetcher: impl });
  assert.equal(out.state, "BATCH_STATE_SUCCEEDED");
  const ok = out.results!.find((r) => r.key === "dish_1")!;
  assert.equal(ok.mime, "image/png");
  assert.equal(Buffer.from(ok.bytes!).toString(), "PNGBYTES");
  const fail = out.results!.find((r) => r.key === "dish_2")!;
  assert.equal(fail.error, "safety block");
  assert.equal(fail.bytes, undefined);
});

test("pollBatch maps failed/canceled → BATCH_STATE_FAILED", async () => {
  const { impl } = router({ "/images/batch/j": { json: { status: "failed", counts: { total: 1, pending: 0, succeeded: 0, failed: 1 } } } });
  const out = await pollBatch("tok", "j", { baseUrl: "https://b", fetcher: impl });
  assert.equal(out.state, "BATCH_STATE_FAILED");
});
