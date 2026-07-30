import "server-only";
import { sql } from "./db";
import { buildImagePrompt } from "./image-prompt";
import { DISH_IMAGE_MODEL } from "./image-model";
import { uploadDishImage } from "./image-storage";
import {
  cancelBatch,
  pollBatch,
  submitImageBatch,
  type BatchPollResult,
} from "./nex-image-batch";

const JOB_TIMEOUT_MINUTES = 20;

export interface DishImageInput {
  id: number;
  title: string;
  subtitle: string | null;
  imageDescription: string | null;
}

export interface DishImageJobState {
  id: string;
  dishId: number;
  userId: string;
  status: "pending" | "done" | "failed";
  imageUrl: string | null;
  error: string | null;
  upstreamJobId: string | null;
}

function token(): string {
  const value = process.env.NEX_API_TOKEN;
  if (!value) throw new Error("NEX_API_TOKEN not configured");
  return value;
}

function keyForDish(dishId: number): string {
  return `dish_${dishId}`;
}

function rowToState(row: Record<string, unknown>): DishImageJobState {
  const rawStatus = String(row.status);
  return {
    id: String(row.id),
    dishId: Number(row.dish_id),
    userId: String(row.user_id),
    status:
      rawStatus === "done"
        ? "done"
        : rawStatus === "failed"
          ? "failed"
          : "pending",
    imageUrl: (row.image_url as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    upstreamJobId: (row.upstream_job_id as string | null) ?? null,
  };
}

async function readJobById(jobId: string): Promise<DishImageJobState | null> {
  const rows = await sql`SELECT * FROM image_jobs WHERE id = ${jobId}`;
  return rows.length === 1
    ? rowToState(rows[0] as Record<string, unknown>)
    : null;
}

export async function readDishImageJob(
  jobId: string,
  dishId: number,
  userId: string,
): Promise<DishImageJobState | null> {
  const rows = await sql`
    SELECT * FROM image_jobs
     WHERE id = ${jobId} AND dish_id = ${dishId} AND user_id = ${userId}
  `;
  return rows.length === 1
    ? rowToState(rows[0] as Record<string, unknown>)
    : null;
}

export async function findPendingDishImageJob(
  dishId: number,
  userId: string,
): Promise<DishImageJobState | null> {
  const rows = await sql`
    SELECT * FROM image_jobs
     WHERE dish_id = ${dishId} AND user_id = ${userId} AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1
  `;
  return rows.length === 1
    ? rowToState(rows[0] as Record<string, unknown>)
    : null;
}

/**
 * Submit one durable GPT Image 2 generation through claude-agent's provider-
 * neutral batch contract. A one-item batch gives Dinner the same quick-submit,
 * independently pollable lifecycle used by large imports, so Vercel never has
 * to hold a request open for the Codex generation itself.
 */
export async function startDishImageJob(
  dish: DishImageInput,
  userId: string,
): Promise<DishImageJobState> {
  // A newer reroll owns the dish. An older queued job may still finish in Nex
  // Image Generator, but it can no longer overwrite this dish.
  const superseded = await sql`
    UPDATE image_jobs
       SET status = 'failed',
           error = 'superseded by a newer image generation',
           locked_until = NULL,
           updated_at = now()
     WHERE dish_id = ${dish.id} AND user_id = ${userId} AND status = 'pending'
     RETURNING upstream_job_id
  `;

  const inserted = await sql`
    INSERT INTO image_jobs (dish_id, user_id, status)
    VALUES (${dish.id}, ${userId}, 'pending')
    RETURNING *
  `;
  const job = rowToState(inserted[0] as Record<string, unknown>);

  try {
    const nexToken = token();
    for (const previous of superseded) {
      const upstreamJobId = previous.upstream_job_id as string | null;
      if (upstreamJobId) {
        await cancelBatch(nexToken, upstreamJobId);
      }
    }
    const prompt = buildImagePrompt({
      title: dish.title,
      subtitle: dish.subtitle,
      imageDescription: dish.imageDescription,
    });
    const submitted = await submitImageBatch(
      nexToken,
      DISH_IMAGE_MODEL,
      `dinner-spinner-dish-${dish.id}`,
      [{ key: keyForDish(dish.id), prompt }],
    );
    const rows = await sql`
      UPDATE image_jobs
         SET upstream_job_id = ${submitted.name}, updated_at = now()
       WHERE id = ${job.id} AND status = 'pending'
       RETURNING *
    `;
    return rows.length === 1
      ? rowToState(rows[0] as Record<string, unknown>)
      : (await readJobById(job.id)) ?? job;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "could not submit image generation";
    const rows = await sql`
      UPDATE image_jobs
         SET status = 'failed',
             error = ${message},
             locked_until = NULL,
             updated_at = now()
       WHERE id = ${job.id}
       RETURNING *
    `;
    return rows.length === 1
      ? rowToState(rows[0] as Record<string, unknown>)
      : { ...job, status: "failed", error: message };
  }
}

function resultForDish(polled: BatchPollResult, dishId: number) {
  return polled.results?.find((result) => result.key === keyForDish(dishId));
}

async function markFailed(
  jobId: string,
  message: string,
): Promise<DishImageJobState | null> {
  const rows = await sql`
    UPDATE image_jobs
       SET status = 'failed',
           error = ${message},
           locked_until = NULL,
           updated_at = now()
     WHERE id = ${jobId} AND status = 'pending'
     RETURNING *
  `;
  return rows.length === 1
    ? rowToState(rows[0] as Record<string, unknown>)
    : readJobById(jobId);
}

async function releaseLock(jobId: string): Promise<void> {
  await sql`
    UPDATE image_jobs
       SET locked_until = NULL, updated_at = now()
     WHERE id = ${jobId} AND status = 'pending'
  `;
}

/**
 * Advance a job by one bounded poll/apply step. The short database lease lets
 * browser polling and the background chain cooperate without double uploads.
 */
export async function advanceDishImageJob(
  jobId: string,
  scope?: { dishId: number; userId: string },
): Promise<DishImageJobState | null> {
  const locked = scope
    ? await sql`
        UPDATE image_jobs
           SET locked_until = now() + interval '30 seconds',
               attempts = attempts + 1,
               updated_at = now()
         WHERE id = ${jobId}
           AND dish_id = ${scope.dishId}
           AND user_id = ${scope.userId}
           AND status = 'pending'
           AND (locked_until IS NULL OR locked_until < now())
         RETURNING *
      `
    : await sql`
        UPDATE image_jobs
           SET locked_until = now() + interval '30 seconds',
               attempts = attempts + 1,
               updated_at = now()
         WHERE id = ${jobId}
           AND status = 'pending'
           AND (locked_until IS NULL OR locked_until < now())
         RETURNING *
      `;

  if (locked.length !== 1) {
    return scope
      ? readDishImageJob(jobId, scope.dishId, scope.userId)
      : readJobById(jobId);
  }

  const job = rowToState(locked[0] as Record<string, unknown>);
  const createdAt = new Date(String(locked[0].created_at)).getTime();
  if (
    Number.isFinite(createdAt) &&
    Date.now() - createdAt > JOB_TIMEOUT_MINUTES * 60_000
  ) {
    return markFailed(job.id, "GPT Image 2 generation timed out");
  }
  if (!job.upstreamJobId) {
    return markFailed(job.id, "upstream image job was not submitted");
  }

  let polled: BatchPollResult;
  try {
    polled = await pollBatch(token(), job.upstreamJobId);
  } catch {
    await releaseLock(job.id);
    return readJobById(job.id);
  }

  if (polled.state === "BATCH_STATE_FAILED") {
    return markFailed(job.id, "GPT Image 2 generation failed");
  }
  if (polled.state !== "BATCH_STATE_SUCCEEDED" || !polled.results) {
    await releaseLock(job.id);
    return readJobById(job.id);
  }

  const result = resultForDish(polled, job.dishId);
  if (!result || result.error || !result.bytes || !result.mime) {
    return markFailed(
      job.id,
      result?.error ?? "GPT Image 2 returned no image",
    );
  }

  try {
    const imageUrl = await uploadDishImage(
      job.dishId,
      result.bytes,
      result.mime,
    );
    const updatedDish = await sql`
      UPDATE dishes
         SET image_url = ${imageUrl}, updated_at = now()
       WHERE id = ${job.dishId}
         AND user_id = ${job.userId}
         AND EXISTS (
           SELECT 1 FROM image_jobs
            WHERE id = ${job.id} AND status = 'pending'
         )
       RETURNING id
    `;
    if (updatedDish.length !== 1) {
      return (await readJobById(job.id)) ??
        { ...job, status: "failed", error: "dish no longer available" };
    }
    const rows = await sql`
      UPDATE image_jobs
         SET status = 'done',
             image_url = ${imageUrl},
             error = NULL,
             locked_until = NULL,
             updated_at = now()
       WHERE id = ${job.id} AND status = 'pending'
       RETURNING *
    `;
    return rows.length === 1
      ? rowToState(rows[0] as Record<string, unknown>)
      : readJobById(job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "could not store image";
    return markFailed(job.id, message);
  }
}
