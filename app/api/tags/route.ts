import { sql } from "@/lib/db";

export async function GET() {
  const rows = await sql`
    SELECT DISTINCT unnest(tags) AS tag
    FROM dishes
    ORDER BY tag
  `;
  return Response.json(rows.map((r) => r.tag as string));
}
