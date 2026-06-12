// Client for claude-agent's image generation API (the "Nex" /api/v1/images
// endpoints). dinner-spinner no longer talks to Gemini directly — it sends a
// fully-styled prompt to Nex, which owns the Gemini call, model selection,
// batching and cost. We keep prompt-building (lib/image-prompt) and Blob storage
// (lib/image-storage) here.
//
// Base URL is the public Tailscale Funnel (`…:10000`), which strips the
// `/api/v1` prefix — so paths here are bare `/images`, `/images/batch`.

const DEFAULT_BASE = process.env.CLAUDE_AGENT_URL ?? "https://nex.tail7f6b96.ts.net:10000";

export interface NexImageConfig {
  /** Bearer token with the `images:generate` scope (NEX_API_TOKEN). */
  token: string;
  /** Override the Funnel base; defaults to CLAUDE_AGENT_URL / the public Funnel. */
  baseUrl?: string;
  fetcher?: typeof fetch;
}

export class NexImageError extends Error {
  code: string;
  status: number | null;
  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.name = "NexImageError";
    this.code = code;
    this.status = status;
  }
}

export interface SourceImage {
  data: string; // base64
  media_type: string;
}

async function errorFrom(res: Response): Promise<NexImageError> {
  let code = "http_error";
  let message = `Nex returned ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch {
    /* keep defaults */
  }
  return new NexImageError(code, message, res.status);
}

/** Synchronous single-image generation: POST /images → inline base64. */
export async function generateImageViaNex(
  args: {
    prompt: string;
    model: string;
    aspectRatio?: string;
    size?: string;
    sourceImages?: SourceImage[];
  } & NexImageConfig,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const fetcher = args.fetcher ?? fetch;
  const base = args.baseUrl ?? DEFAULT_BASE;
  const res = await fetcher(`${base}/images`, {
    method: "POST",
    headers: { authorization: `Bearer ${args.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      prompt: args.prompt,
      model: args.model,
      ...(args.aspectRatio ? { aspect_ratio: args.aspectRatio } : {}),
      ...(args.size ? { size: args.size } : {}),
      ...(args.sourceImages ? { input_images: args.sourceImages } : {}),
    }),
  });
  if (!res.ok) throw await errorFrom(res);
  const json = (await res.json()) as { image?: string; mime?: string };
  if (!json.image) throw new NexImageError("bad_response", "Nex /images returned no image");
  return { bytes: new Uint8Array(Buffer.from(json.image, "base64")), mime: json.mime ?? "image/png" };
}

// ---- Batch ----

export interface NexBatchRequest {
  key: string;
  prompt: string;
  sourceImages?: SourceImage[];
}

export interface NexBatchCounts {
  total: number;
  pending: number;
  succeeded: number;
  failed: number;
}

export interface NexBatchStatus {
  status: "pending" | "running" | "staging" | "done" | "failed" | "canceled";
  counts: NexBatchCounts | null;
  /** Present when status === 'done': per-key outcome (no bytes — fetch those separately). */
  results?: Array<{ key: string; mime?: string; error?: string }>;
}

/** POST /images/batch → job id. */
export async function submitImageBatchViaNex(
  args: {
    requests: NexBatchRequest[];
    model: string;
    aspectRatio?: string;
    size?: string;
  } & NexImageConfig,
): Promise<{ jobId: string; requestCount: number }> {
  const fetcher = args.fetcher ?? fetch;
  const base = args.baseUrl ?? DEFAULT_BASE;
  const res = await fetcher(`${base}/images/batch`, {
    method: "POST",
    headers: { authorization: `Bearer ${args.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      requests: args.requests.map((r) => ({
        key: r.key,
        prompt: r.prompt,
        ...(r.sourceImages ? { input_images: r.sourceImages } : {}),
      })),
      model: args.model,
      ...(args.aspectRatio ? { aspect_ratio: args.aspectRatio } : {}),
      ...(args.size ? { size: args.size } : {}),
    }),
  });
  if (!res.ok) throw await errorFrom(res);
  const json = (await res.json()) as { job_id?: string; request_count?: number };
  if (!json.job_id) throw new NexImageError("bad_response", "Nex /images/batch returned no job_id");
  return { jobId: json.job_id, requestCount: json.request_count ?? args.requests.length };
}

/** GET /images/batch/:id → status + per-key outcomes (when done). */
export async function pollImageBatchViaNex(
  args: { jobId: string } & NexImageConfig,
): Promise<NexBatchStatus> {
  const fetcher = args.fetcher ?? fetch;
  const base = args.baseUrl ?? DEFAULT_BASE;
  const res = await fetcher(`${base}/images/batch/${encodeURIComponent(args.jobId)}`, {
    headers: { authorization: `Bearer ${args.token}` },
  });
  if (!res.ok) throw await errorFrom(res);
  const json = (await res.json()) as NexBatchStatus;
  return json;
}

/** GET /images/batch/:id/:key → raw bytes for one staged image. */
export async function fetchBatchImageViaNex(
  args: { jobId: string; key: string } & NexImageConfig,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const fetcher = args.fetcher ?? fetch;
  const base = args.baseUrl ?? DEFAULT_BASE;
  const res = await fetcher(`${base}/images/batch/${encodeURIComponent(args.jobId)}/${encodeURIComponent(args.key)}`, {
    headers: { authorization: `Bearer ${args.token}` },
  });
  if (!res.ok) throw await errorFrom(res);
  const mime = res.headers.get("content-type")?.split(";")[0].trim() ?? "image/png";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, mime };
}

/** DELETE /images/batch/:id — best-effort cancel. Never throws. */
export async function cancelImageBatchViaNex(args: { jobId: string } & NexImageConfig): Promise<void> {
  const fetcher = args.fetcher ?? fetch;
  const base = args.baseUrl ?? DEFAULT_BASE;
  try {
    await fetcher(`${base}/images/batch/${encodeURIComponent(args.jobId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${args.token}` },
    });
  } catch {
    /* best-effort */
  }
}
