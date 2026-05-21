import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`
    SELECT DISTINCT ing->>'name' AS name
    FROM dishes, jsonb_array_elements(ingredients) AS ing
    WHERE dishes.user_id = ${userId} AND ing->>'name' IS NOT NULL
    ORDER BY 1
  `;
  return Response.json(rows.map((r) => r.name as string));
}
