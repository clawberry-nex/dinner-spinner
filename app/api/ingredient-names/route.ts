import { sql } from "@/lib/db";

export async function GET() {
  const rows = await sql`
    SELECT DISTINCT ing->>'name' AS name
    FROM dishes, jsonb_array_elements(ingredients) AS ing
    WHERE ing->>'name' IS NOT NULL
    ORDER BY 1
  `;
  return Response.json(rows.map((r) => r.name as string));
}
