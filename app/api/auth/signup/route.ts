import { sql } from "@/lib/db";
import {
  hashPassword,
  isEmailAllowed,
  parseAllowlist,
  slugFromEmail,
  assignAvailableHandle,
} from "@/lib/auth-helpers";

export async function POST(req: Request) {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const name = body.name ? String(body.name).trim() : null;

  if (!email || !password) {
    return Response.json({ error: "missing_fields" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "password_too_short" }, { status: 400 });
  }
  if (!isEmailAllowed(email, parseAllowlist(process.env.ALLOWED_EMAILS))) {
    return Response.json({ error: "email_not_allowed" }, { status: 403 });
  }

  const existing = await sql`SELECT 1 FROM users WHERE email = ${email} LIMIT 1`;
  if (existing.length > 0) {
    return Response.json({ error: "already_registered" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const handle = await assignAvailableHandle(
    slugFromEmail(email),
    async (h) => {
      const r = await sql`SELECT 1 FROM users WHERE handle = ${h} LIMIT 1`;
      return r.length > 0;
    },
  );
  await sql`
    INSERT INTO users (email, name, password_hash, handle)
    VALUES (${email}, ${name}, ${passwordHash}, ${handle})
  `;
  return Response.json({ ok: true });
}
