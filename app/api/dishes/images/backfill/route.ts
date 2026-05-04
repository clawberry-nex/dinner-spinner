import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";
import { buildImagePrompt } from "@/lib/image-prompt";
import { getProvider } from "@/lib/image-provider";
import { uploadDishImage } from "@/lib/image-storage";

const CONCURRENCY = 4;

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

type BulkBody = { overwrite?: boolean };

async function generateForDishId(dishId: number): Promise<void> {
  const rows = await sql`SELECT * FROM dishes WHERE id = ${dishId}`;
  if (rows.length === 0) throw new Error("dish not found");
  const dish = rowToDish(rows[0]);
  const prompt = buildImagePrompt({ title: dish.title, subtitle: dish.subtitle });
  const { bytes, mime } = await getProvider().generate(prompt);
  const imageUrl = await uploadDishImage(dishId, bytes, mime);
  await sql`
    UPDATE dishes
       SET image_url = ${imageUrl},
           updated_at = now()
     WHERE id = ${dishId}
  `;
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

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: BulkBody = {};
  try {
    body = (await request.json()) as BulkBody;
  } catch {
    // empty body is fine — defaults apply
  }
  const overwrite = body.overwrite === true;

  const idRows = overwrite
    ? await sql`SELECT id FROM dishes ORDER BY id`
    : await sql`SELECT id FROM dishes WHERE image_url IS NULL ORDER BY id`;
  const ids = idRows.map((r) => Number(r.id));

  const settled = await runWithConcurrency(ids, CONCURRENCY, generateForDishId);
  const failed: Array<{ dishId: number; error: string }> = [];
  let ok = 0;
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      ok++;
    } else {
      const reason = s.reason;
      failed.push({
        dishId: ids[i],
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  });
  return Response.json({ ok, failed, total: ids.length });
}
