/**
 * Thin client for Gemini's batch image-generation endpoint. Used for the
 * bulk-regenerate flow at /api/dishes/images/batch-backfill. Inline-batch
 * submission only (the request payload stays well under 20 MB for the
 * sizes we generate — each prompt is ~1.5 KB).
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface BatchRequest {
  /** Echoed back per-result so the caller can correlate. Use e.g. `dish_42`. */
  key: string;
  prompt: string;
}

export interface BatchSubmitResult {
  /** Full name like `batches/abc...`. Pass back to pollBatch / fetchBatch. */
  name: string;
  state: string;
}

export interface BatchInlinedResponse {
  key: string;
  bytes?: Uint8Array;
  mime?: string;
  error?: string;
}

export interface BatchPollResult {
  name: string;
  state: string;
  counts: { total: number; pending: number; succeeded: number; failed: number };
  /** Present only when state === BATCH_STATE_SUCCEEDED. */
  results?: BatchInlinedResponse[];
}

/**
 * Best-effort cancel of a batch so Gemini stops processing (and retrying) its
 * pending requests. A submitted batch keeps being worked by Gemini regardless
 * of whether we poll it — if we abandon one (sync took over, or we gave up) and
 * the image model is busy, Gemini retries its pending requests indefinitely,
 * which shows up as a 503 storm. Always cancel a batch we're done with.
 */
export async function cancelBatch(apiKey: string, name: string): Promise<void> {
  try {
    await fetch(`${BASE}/${name}:cancel`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
      body: "{}",
    });
  } catch {
    /* best-effort — nothing to do if it fails */
  }
}

export async function submitImageBatch(
  apiKey: string,
  model: string,
  displayName: string,
  requests: BatchRequest[],
): Promise<BatchSubmitResult> {
  const inlinedRequests = requests.map((r) => ({
    request: {
      contents: [{ parts: [{ text: r.prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
      },
    },
    metadata: { key: r.key },
  }));
  const res = await fetch(`${BASE}/models/${model}:batchGenerateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      batch: {
        display_name: displayName,
        input_config: { requests: { requests: inlinedRequests } },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini batch submit ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    name?: string;
    metadata?: { state?: string };
  };
  if (!json.name) {
    throw new Error(`Gemini batch submit returned no name: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return { name: json.name, state: json.metadata?.state ?? "BATCH_STATE_PENDING" };
}

type RawInlineData = { mimeType?: string; mime_type?: string; data?: string };
type RawPart = {
  text?: string;
  inlineData?: RawInlineData;
  inline_data?: RawInlineData;
};
type RawInlineResp = {
  metadata?: { key?: string };
  response?: { candidates?: Array<{ content?: { parts?: RawPart[] } }> };
  error?: { code?: number; message?: string };
};
type RawBatch = {
  name?: string;
  metadata?: {
    state?: string;
    batchStats?: {
      requestCount?: string | number;
      pendingRequestCount?: string | number;
      successfulRequestCount?: string | number;
      failedRequestCount?: string | number;
    };
    output?: { inlinedResponses?: { inlinedResponses?: RawInlineResp[] } };
  };
};

function numFromStats(v: string | number | undefined): number {
  if (v === undefined) return 0;
  return typeof v === "number" ? v : Number(v) || 0;
}

export async function pollBatch(
  apiKey: string,
  name: string,
): Promise<BatchPollResult> {
  const res = await fetch(`${BASE}/${name}`, {
    headers: { "x-goog-api-key": apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini batch poll ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as RawBatch;
  const md = json.metadata ?? {};
  const state = md.state ?? "BATCH_STATE_UNKNOWN";
  const stats = md.batchStats ?? {};
  const counts = {
    total: numFromStats(stats.requestCount),
    pending: numFromStats(stats.pendingRequestCount),
    succeeded: numFromStats(stats.successfulRequestCount),
    failed: numFromStats(stats.failedRequestCount),
  };
  const out: BatchPollResult = { name: json.name ?? name, state, counts };
  if (state !== "BATCH_STATE_SUCCEEDED") return out;

  const inlined = md.output?.inlinedResponses?.inlinedResponses ?? [];
  const results: BatchInlinedResponse[] = inlined.map((r) => {
    const key = r.metadata?.key ?? "";
    if (r.error) {
      return { key, error: r.error.message ?? `code ${r.error.code}` };
    }
    const parts = r.response?.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const inline = p.inlineData ?? p.inline_data;
      if (inline?.data) {
        const mime = (inline.mimeType ?? inline.mime_type ?? "image/jpeg").split(";")[0].trim();
        return {
          key,
          bytes: new Uint8Array(Buffer.from(inline.data, "base64")),
          mime,
        };
      }
    }
    const text = parts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 300);
    return { key, error: text ? `no image: ${text}` : "no image in response" };
  });
  out.results = results;
  return out;
}
