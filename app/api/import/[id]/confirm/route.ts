import { after } from "next/server";
import { resolveUserId } from "@/lib/auth-helpers";
import { sql } from "@/lib/db";
import { kickBackgroundAdvance } from "@/lib/import/background";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

function err(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

// Confirm the "Found X recipes — Import all" step: detected → parsing. The
// browser's poll loop then drives the per-chunk parse/create/image advance.
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/import/[id]/confirm">,
): Promise<Response> {
  const userId = await resolveUserId(req);
  if (!userId) return err("unauthorized", "Unauthorized", 401);

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return err("not_found", "Not found", 404);

  const upd = await sql`
    UPDATE import_jobs SET status = 'parsing', updated_at = now()
     WHERE id = ${id} AND user_id = ${userId} AND status = 'detected'
     RETURNING status
  `;
  if (upd.length) {
    // Drive parse→image to completion server-side so the import finishes even
    // if the user closes the tab (browser polling still drives the live UI).
    after(() => kickBackgroundAdvance(id));
    return Response.json({ ok: true, status: "parsing" });
  }

  // Not in 'detected' — already confirmed, or doesn't exist.
  const cur = await sql`SELECT status FROM import_jobs WHERE id = ${id} AND user_id = ${userId}`;
  if (cur.length === 0) return err("not_found", "Not found", 404);
  return Response.json({ ok: true, status: cur[0].status as string });
}
