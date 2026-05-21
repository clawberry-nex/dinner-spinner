import { sql } from "@/lib/db";
import {
  resolveUserId,
  verifyPassword,
  hashPassword,
} from "@/lib/auth-helpers";

export async function PATCH(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { current?: string; next?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const current = String(body.current ?? "");
  const next = String(body.next ?? "");
  if (next.length < 8) {
    return Response.json({ error: "password_too_short" }, { status: 400 });
  }

  const rows = await sql`SELECT password_hash FROM users WHERE id = ${userId} LIMIT 1`;
  const hash = (rows[0]?.password_hash as string | null) ?? null;
  if (!hash) {
    // Google-only account: no existing password to verify.
    return Response.json({ error: "no_password_set" }, { status: 400 });
  }
  if (!(await verifyPassword(current, hash))) {
    return Response.json({ error: "wrong_current_password" }, { status: 403 });
  }
  const nextHash = await hashPassword(next);
  await sql`UPDATE users SET password_hash = ${nextHash} WHERE id = ${userId}`;
  return Response.json({ ok: true });
}
