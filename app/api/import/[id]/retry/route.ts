import { resolveUserId } from "@/lib/auth-helpers";
import { sql } from "@/lib/db";
import { parseImportRow, rowToImportProgress } from "@/lib/import/types";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

function err(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

// Re-attempt a single failed-to-parse recipe. Re-queues chunk[index] and puts
// the job back into 'parsing' so the advance loop picks it up. image_batches is
// reset so the (re-)created dish gets imaged — already-imaged dishes are skipped
// by the pending-photo filter, so this only (re)generates what's missing.
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/import/[id]/retry">,
): Promise<Response> {
  const userId = await resolveUserId(req);
  if (!userId) return err("unauthorized", "Unauthorized", 401);

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return err("not_found", "Not found", 404);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const index = Number((body as Record<string, unknown>)?.index);
  if (!Number.isInteger(index) || index < 0) return err("validation", "invalid index", 400);

  const rows = await sql`SELECT * FROM import_jobs WHERE id = ${id} AND user_id = ${userId}`;
  if (rows.length === 0) return err("not_found", "Not found", 404);
  const row = parseImportRow(rows[0]);
  const chunk = row.chunks[index];
  if (!chunk) return err("validation", "no such recipe", 400);

  if (chunk.status === "failed") {
    chunk.status = "queued";
    chunk.error = null;
    chunk.parseJobId = null;
    chunk.image = "pending";
  }
  if (row.status === "done" || row.status === "imaging") {
    row.status = "parsing";
    row.image_batches = [];
  }

  await sql`
    UPDATE import_jobs SET
      chunks = ${JSON.stringify(row.chunks)}::jsonb,
      image_batches = ${JSON.stringify(row.image_batches)}::jsonb,
      status = ${row.status},
      updated_at = now()
    WHERE id = ${id} AND user_id = ${userId}
  `;
  return Response.json(rowToImportProgress(row));
}
