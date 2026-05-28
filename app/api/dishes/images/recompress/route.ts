import type { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";
import { uploadDishImage } from "@/lib/image-storage";

// 60s Vercel function budget — fetch + sharp + Blob upload is ~1–2s per
// dish, so ~24 fits comfortably. Beyond ~40 dishes you'd want to
// paginate; for the current user count sequential is fine and gives a
// clean error trail on failure.
export const maxDuration = 60;

/**
 * POST /api/dishes/images/recompress
 *
 * One-shot backfill: downloads every dish image the caller owns, runs it
 * through the same sharp pipeline new uploads use (1024px max, WebP q=80),
 * and writes the result back as a fresh blob. Idempotent — re-running
 * after the first pass is a near-no-op (re-encoding an already-small
 * WebP yields ~the same bytes).
 */
export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const rows = (await sql`
    SELECT id, image_url FROM dishes
     WHERE user_id = ${userId} AND image_url IS NOT NULL
     ORDER BY id
  `) as Array<{ id: number; image_url: string }>;

  const failures: Array<{ id: number; error: string }> = [];
  let touched = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  for (const row of rows) {
    try {
      const res = await fetch(row.image_url);
      if (!res.ok) {
        failures.push({ id: row.id, error: `fetch ${res.status}` });
        continue;
      }
      const buf = await res.arrayBuffer();
      bytesBefore += buf.byteLength;
      const sourceMime =
        res.headers.get("content-type")?.split(";")[0].trim() ?? "image/jpeg";

      // uploadDishImage runs sharp + writes a fresh blob (new nanoid path),
      // so the old blob is orphaned but inaccessible — Vercel Blob doesn't
      // bill old paths once they're unreferenced from your code. (If we
      // ever care to clean those up, @vercel/blob has a `del()` helper.)
      const newUrl = await uploadDishImage(
        row.id,
        new Uint8Array(buf),
        sourceMime,
      );
      const fresh = await fetch(newUrl);
      bytesAfter += (await fresh.arrayBuffer()).byteLength;

      await sql`
        UPDATE dishes
           SET image_url = ${newUrl}, updated_at = now()
         WHERE id = ${row.id} AND user_id = ${userId}
      `;
      touched++;
    } catch (err) {
      failures.push({
        id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return Response.json({
    total: rows.length,
    touched,
    failures,
    bytes: {
      before: bytesBefore,
      after: bytesAfter,
      reductionPct:
        bytesBefore > 0
          ? Math.round((1 - bytesAfter / bytesBefore) * 100)
          : null,
    },
  });
}
