import { z } from "zod";
import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";

const BodySchema = z.object({
  name: z.string().trim().min(1).max(128),
});

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`
    SELECT name FROM pantry_names WHERE user_id = ${userId} ORDER BY name
  `;
  return Response.json(rows.map((r) => r.name as string));
}

export async function POST(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const normalized = parsed.data.name.toLowerCase().trim();
  // Requires the (user_id, name) composite PK from db/lockdown.sql. Before
  // lockdown runs, this conflict target won't match and the insert will
  // error — that's deliberate: the route is shipped against the post-
  // lockdown shape.
  await sql`
    INSERT INTO pantry_names (user_id, name) VALUES (${userId}, ${normalized})
    ON CONFLICT (user_id, name) DO NOTHING
  `;
  return Response.json({ ok: true, name: normalized }, { status: 201 });
}

export async function DELETE(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const name = url.searchParams.get("name")?.toLowerCase().trim();
  if (!name) {
    return Response.json({ error: "Missing name" }, { status: 400 });
  }

  const rows = await sql`
    DELETE FROM pantry_names
    WHERE user_id = ${userId} AND name = ${name}
    RETURNING name
  `;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
