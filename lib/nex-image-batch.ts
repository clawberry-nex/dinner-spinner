/**
 * Thin adapter over claude-agent's provider-neutral Nex image batch API.
 *
 * Nex's poll returns per-key outcomes without bytes; this adapter fetches the
 * bytes for each succeeded key so consumers can apply completed images.
 */

import {
  submitImageBatchViaNex,
  pollImageBatchViaNex,
  fetchBatchImageViaNex,
  cancelImageBatchViaNex,
  type NexBatchStatus,
} from "./nex-image.ts";
import type { DISH_IMAGE_MODEL } from "./image-model";

export interface BatchRequest {
  /** Echoed back per-result so the caller can correlate. Use e.g. `dish_42`. */
  key: string;
  prompt: string;
}

export interface BatchSubmitResult {
  /** Nex job id — pass back to pollBatch / cancelBatch. */
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

export interface BatchOpts {
  /** Override the Nex Funnel base; defaults to CLAUDE_AGENT_URL / the public Funnel. */
  baseUrl?: string;
  /** Injectable for tests. */
  fetcher?: typeof fetch;
}

function mapState(status: NexBatchStatus["status"]): string {
  if (status === "done") return "BATCH_STATE_SUCCEEDED";
  if (status === "failed" || status === "canceled") return "BATCH_STATE_FAILED";
  return "BATCH_STATE_RUNNING";
}

/**
 * Submit a batch with an explicit Nex-supported model id.
 * `displayName` is accepted for call-site compatibility but Nex names the job.
 */
export async function submitImageBatch(
  token: string,
  model: typeof DISH_IMAGE_MODEL,
  _displayName: string,
  requests: BatchRequest[],
  opts: BatchOpts = {},
): Promise<BatchSubmitResult> {
  const { jobId } = await submitImageBatchViaNex({
    requests: requests.map((r) => ({ key: r.key, prompt: r.prompt })),
    model,
    token,
    baseUrl: opts.baseUrl,
    fetcher: opts.fetcher,
  });
  return { name: jobId, state: "BATCH_STATE_PENDING" };
}

export async function pollBatch(token: string, name: string, opts: BatchOpts = {}): Promise<BatchPollResult> {
  const s = await pollImageBatchViaNex({ jobId: name, token, baseUrl: opts.baseUrl, fetcher: opts.fetcher });
  const counts = s.counts ?? { total: 0, pending: 0, succeeded: 0, failed: 0 };
  const out: BatchPollResult = { name, state: mapState(s.status), counts };
  if (s.status !== "done" || !s.results) return out;

  // Fetch the bytes for each succeeded key so the consumer contract (inline
  // bytes) is preserved.
  const results: BatchInlinedResponse[] = [];
  for (const r of s.results) {
    if (r.error || !r.mime) {
      results.push({ key: r.key, error: r.error ?? "no image" });
      continue;
    }
    try {
      const img = await fetchBatchImageViaNex({ jobId: name, key: r.key, token, baseUrl: opts.baseUrl, fetcher: opts.fetcher });
      results.push({ key: r.key, bytes: img.bytes, mime: img.mime });
    } catch (e) {
      results.push({ key: r.key, error: e instanceof Error ? e.message : "fetch failed" });
    }
  }
  out.results = results;
  return out;
}

/** Best-effort cancel so Nex stops (and cancels) the batch. Never throws. */
export async function cancelBatch(token: string, name: string, opts: BatchOpts = {}): Promise<void> {
  await cancelImageBatchViaNex({ jobId: name, token, baseUrl: opts.baseUrl, fetcher: opts.fetcher });
}
