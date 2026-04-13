import { cookies } from "next/headers";
import { z } from "zod";
import { sql } from "@/lib/db";
import {
  ADMIN_COOKIE_NAME,
  checkApiToken,
  verifySessionCookieValue,
} from "@/lib/auth";

async function isAuthorized(request: Request): Promise<boolean> {
  if (checkApiToken(request.headers.get("authorization"))) return true;
  const jar = await cookies();
  return verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
}

const BodySchema = z.object({
  name: z.string().trim().min(1).max(128),
});

export async function GET() {
  const rows = await sql`SELECT name FROM pantry_names ORDER BY name`;
  return Response.json(rows.map((r) => r.name as string));
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
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
  await sql`
    INSERT INTO pantry_names (name) VALUES (${normalized})
    ON CONFLICT (name) DO NOTHING
  `;
  return Response.json({ ok: true, name: normalized }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!(await isAuthorized(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const name = url.searchParams.get("name")?.toLowerCase().trim();
  if (!name) {
    return Response.json({ error: "Missing name" }, { status: 400 });
  }

  const rows = await sql`DELETE FROM pantry_names WHERE name = ${name} RETURNING name`;
  if (rows.length === 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
