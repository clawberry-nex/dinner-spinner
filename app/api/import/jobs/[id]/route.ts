import { resolveUserId } from "@/lib/auth-helpers";
import { sql } from "@/lib/db";
import { advanceImport } from "@/lib/import/advance";
import { parseImportRow, rowToImportProgress } from "@/lib/import/types";

// One bounded advance step may poll a few claude-agent jobs and upload a slice
// of images; give it headroom (it's designed to finish in a few seconds).
export const maxDuration = 60;

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

function err(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function GET(
  req: Request,
  ctx: RouteContext<"/api/import/jobs/[id]">,
): Promise<Response> {
  const userId = await resolveUserId(req);
  if (!userId) return err("unauthorized", "Unauthorized", 401);
  const token = process.env.NEX_API_TOKEN;
  if (!token) return err("import_disabled", "Batch import is not configured.", 503);

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return err("not_found", "Not found", 404);

  // Acquire the advance lock. If we get the row, advance one step. Two tabs
  // polling at once can't both advance — the loser just reads state. The lock
  // outlasts maxDuration (60s) so a step killed at the cap can't be double-run;
  // a sync image step can take ~30-40s, well within it.
  const locked = await sql`
    UPDATE import_jobs SET locked_until = now() + interval '75 seconds'
     WHERE id = ${id} AND user_id = ${userId}
       AND (locked_until IS NULL OR locked_until < now())
     RETURNING *
  `;
  if (locked.length === 1) {
    const row = parseImportRow(locked[0]);
    try {
      const advanced = await advanceImport(row);
      return Response.json(rowToImportProgress(advanced));
    } catch (e) {
      await sql`UPDATE import_jobs SET locked_until = NULL WHERE id = ${id}`.catch(() => {});
      console.error("[import advance] step failed", {
        id,
        err: e instanceof Error ? e.message : String(e),
      });
      // fall through to return the current persisted state
    }
  }

  const cur = await sql`SELECT * FROM import_jobs WHERE id = ${id} AND user_id = ${userId}`;
  if (cur.length === 0) return err("not_found", "Not found", 404);
  return Response.json(rowToImportProgress(parseImportRow(cur[0])));
}
