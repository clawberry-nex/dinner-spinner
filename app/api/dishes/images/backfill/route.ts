import type { NextRequest } from "next/server";
import { after } from "next/server";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import { resolveUserId } from "@/lib/auth-helpers";
import {
  startDishImageJob,
  type DishImageJobState,
} from "@/lib/dish-image-job";
import { kickDishImageAdvance } from "@/lib/dish-image-background";

const CONCURRENCY = 4;

type BulkBody = { overwrite?: boolean };

async function generateForDishId(
  dishId: number,
  userId: string,
): Promise<DishImageJobState> {
  const rows = await sql`
    SELECT * FROM dishes WHERE id = ${dishId} AND user_id = ${userId}
  `;
  if (rows.length === 0) throw new Error("dish not found");
  const dish = rowToDish(rows[0]);
  const job = await startDishImageJob(dish, userId);
  if (job.status === "failed") {
    throw new Error(job.error ?? "image submission failed");
  }
  return job;
}

// Tiny concurrency-limited runner. No new dependency just for this.
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  async function pump() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        const value = await worker(items[i]);
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}

export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: BulkBody = {};
  try {
    body = (await req.json()) as BulkBody;
  } catch {
    // empty body is fine — defaults apply
  }
  const overwrite = body.overwrite === true;

  const idRows = overwrite
    ? await sql`SELECT id FROM dishes WHERE user_id = ${userId} ORDER BY id`
    : await sql`SELECT id FROM dishes WHERE user_id = ${userId} AND image_url IS NULL ORDER BY id`;
  const ids = idRows.map((r) => Number(r.id));

  const settled = await runWithConcurrency(ids, CONCURRENCY, (dishId) =>
    generateForDishId(dishId, userId),
  );
  const failed: Array<{ dishId: number; error: string }> = [];
  const jobs: Array<{ dishId: number; jobId: string }> = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      jobs.push({ dishId: ids[i], jobId: s.value.id });
      after(() => kickDishImageAdvance(s.value.id));
    } else {
      const reason = s.reason;
      failed.push({
        dishId: ids[i],
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  });
  return Response.json({ queued: jobs.length, jobs, failed, total: ids.length });
}
