import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`
    SELECT DISTINCT unnest(tags) AS tag
    FROM dishes
    WHERE user_id = ${userId}
    ORDER BY tag
  `;
  return Response.json(rows.map((r) => r.tag as string));
}
