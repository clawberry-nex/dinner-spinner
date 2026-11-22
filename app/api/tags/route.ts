import { DishTypeSchema } from "@/lib/types";
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const type = DishTypeSchema.nullable().safeParse(new URL(req.url).searchParams.get("dishType"));
  if (!type.success) return Response.json({ error: "Invalid dish type" }, { status: 400 });
  const rows = await sql`
    SELECT DISTINCT unnest(tags) AS tag
    FROM dishes
    WHERE user_id = ${userId} AND (${type.data}::text IS NULL OR dish_type = ${type.data})
    ORDER BY tag
  `;
  return Response.json(rows.map((r) => r.tag as string));
}
