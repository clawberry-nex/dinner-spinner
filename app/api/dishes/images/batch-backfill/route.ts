import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import { buildImagePrompt } from "@/lib/image-prompt";
import { uploadDishImage } from "@/lib/image-storage";
import {
  submitImageBatch,
  pollBatch,
  type BatchRequest,
  type BatchPollResult,
} from "@/lib/gemini-batch";

const BATCH_MODEL = "nano-banana-pro";

// Hard cap. The Gemini inline-batch payload limit is 20 MB; at ~1.5 KB per
// prompt that's ~13k requests, but applying N results synchronously on
// poll has its own ceiling (each Blob upload ~100ms). 200 leaves room for
// retries + DB round-trips inside Vercel's 60s function budget.
const MAX_BATCH_SIZE = 200;

const KEY_PREFIX = "dish_";

function dishIdFromKey(key: string): number | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const n = Number(key.slice(KEY_PREFIX.length));
  return Number.isFinite(n) ? n : null;
}

/**
 * POST /api/dishes/images/batch-backfill
 *
 * Submits a Gemini batch job that regenerates images for all of the
 * caller's dishes (or only those missing an image, by default). Returns
 * the job name immediately; poll with GET ?job=<name> until state flips
 * to BATCH_STATE_SUCCEEDED, at which point the same GET applies the
 * results.
 *
 * Body (optional): `{ overwrite?: boolean }`
 *   - overwrite=false (default): only dishes where image_url IS NULL
 *   - overwrite=true: every dish, replacing existing images
 */
export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const token = process.env.NEX_API_TOKEN;
  if (!token) {
    return Response.json(
      { error: "NEX_API_TOKEN not configured" },
      { status: 503 },
    );
  }

  let body: { overwrite?: boolean } = {};
  try {
    body = (await req.json()) as { overwrite?: boolean };
  } catch {
    // empty body is fine
  }
  const overwrite = body.overwrite === true;

  const rows = overwrite
    ? await sql`SELECT * FROM dishes WHERE user_id = ${userId} ORDER BY id`
    : await sql`SELECT * FROM dishes WHERE user_id = ${userId} AND image_url IS NULL ORDER BY id`;

  if (rows.length === 0) {
    return Response.json({ message: "no dishes need regeneration", dishCount: 0 });
  }
  if (rows.length > MAX_BATCH_SIZE) {
    return Response.json(
      {
        error: `too many dishes (${rows.length}); split into batches of ${MAX_BATCH_SIZE}`,
      },
      { status: 413 },
    );
  }

  const requests: BatchRequest[] = rows.map((r) => {
    const dish = rowToDish(r);
    return {
      key: `${KEY_PREFIX}${dish.id}`,
      prompt: buildImagePrompt({
        title: dish.title,
        subtitle: dish.subtitle,
        imageDescription: dish.imageDescription,
      }),
    };
  });

  const submitted = await submitImageBatch(
    token,
    BATCH_MODEL,
    `dinner-spinner-${userId.slice(0, 8)}-${Date.now()}`,
    requests,
  );

  return Response.json({
    jobName: submitted.name,
    state: submitted.state,
    dishCount: requests.length,
    pollUrl: `/api/dishes/images/batch-backfill?job=${encodeURIComponent(submitted.name)}`,
  });
}

/**
 * GET /api/dishes/images/batch-backfill?job=<name>
 *
 * Polls Gemini for batch state. While pending/running, returns the
 * current state and counts. When BATCH_STATE_SUCCEEDED, iterates the
 * inlined responses, uploads each image to Blob, and updates the
 * matching dish row.
 *
 * Idempotent in spirit: re-calling after success re-uploads and overwrites
 * the dish images. Cheap enough not to track per-batch "applied" state.
 */
export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const token = process.env.NEX_API_TOKEN;
  if (!token) {
    return Response.json(
      { error: "NEX_API_TOKEN not configured" },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const jobName = url.searchParams.get("job");
  // Nex batch job ids are opaque nanoids (no "batches/" prefix like Gemini used).
  if (!jobName) {
    return Response.json(
      { error: "missing ?job=<id>" },
      { status: 400 },
    );
  }

  let polled: BatchPollResult;
  try {
    polled = await pollBatch(token, jobName);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "poll failed" },
      { status: 502 },
    );
  }

  if (polled.state !== "BATCH_STATE_SUCCEEDED" || !polled.results) {
    return Response.json({
      state: polled.state,
      counts: polled.counts,
      done: false,
    });
  }

  // Apply results. We re-resolve the user_id on each UPDATE so a caller
  // can't ride this endpoint to patch another user's dish.
  const applied: Array<{ dishId: number; imageUrl: string }> = [];
  const failed: Array<{ dishId: number | null; key: string; error: string }> = [];

  for (const r of polled.results) {
    const dishId = dishIdFromKey(r.key);
    if (dishId === null) {
      failed.push({ dishId: null, key: r.key, error: "unrecognized key" });
      continue;
    }
    if (r.error || !r.bytes || !r.mime) {
      failed.push({ dishId, key: r.key, error: r.error ?? "no image" });
      continue;
    }
    try {
      const imageUrl = await uploadDishImage(dishId, r.bytes, r.mime);
      const update = await sql`
        UPDATE dishes
           SET image_url = ${imageUrl}, updated_at = now()
         WHERE id = ${dishId} AND user_id = ${userId}
         RETURNING id
      `;
      if (update.length === 0) {
        failed.push({ dishId, key: r.key, error: "dish not found / not owned" });
      } else {
        applied.push({ dishId, imageUrl });
      }
    } catch (err) {
      failed.push({
        dishId,
        key: r.key,
        error: err instanceof Error ? err.message : "apply failed",
      });
    }
  }

  return Response.json({
    state: polled.state,
    counts: polled.counts,
    done: true,
    applied: applied.length,
    failed,
  });
}
