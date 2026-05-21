import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`
    SELECT todoist_token, todoist_project FROM users WHERE id = ${userId}
  `;
  const r = rows[0];
  return Response.json({
    // Mask the token: only report whether it's set.
    hasToken: !!(r?.todoist_token as string | null),
    projectName: (r?.todoist_project as string | null) ?? null,
  });
}

export async function PATCH(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { token?: string | null; projectName?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const token = body.token === null ? null : (body.token ?? "").trim() || null;
  const projectName =
    body.projectName === null ? null : (body.projectName ?? "").trim() || null;
  await sql`
    UPDATE users
       SET todoist_token   = ${token},
           todoist_project = ${projectName}
     WHERE id = ${userId}
  `;
  return Response.json({ ok: true });
}
