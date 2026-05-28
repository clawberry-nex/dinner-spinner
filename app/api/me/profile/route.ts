import { sql } from "@/lib/db";
import { HANDLE_REGEX, resolveUserId } from "@/lib/auth-helpers";

const BIO_MAX = 160;

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`
    SELECT handle, bio, handle_changed_at FROM users WHERE id = ${userId} LIMIT 1
  `;
  const r = rows[0];
  if (!r) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({
    handle: r.handle as string,
    bio: (r.bio as string | null) ?? null,
    handleLocked: r.handle_changed_at != null,
  });
}

export async function PATCH(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { handle?: string | null; bio?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  // Bio: normalize empty string → null; trim; enforce max length.
  let bioSet: { value: string | null } | null = null;
  if (Object.prototype.hasOwnProperty.call(body, "bio")) {
    const raw = body.bio;
    if (raw === null) {
      bioSet = { value: null };
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.length > BIO_MAX) {
        return Response.json(
          { error: "bio_too_long" },
          { status: 400 },
        );
      }
      bioSet = { value: trimmed === "" ? null : trimmed };
    } else {
      return Response.json({ error: "invalid_bio" }, { status: 400 });
    }
  }

  // Handle: lowercase, regex-validate, refuse if already changed once, refuse on collision.
  let handleSet: string | null = null;
  if (
    Object.prototype.hasOwnProperty.call(body, "handle") &&
    typeof body.handle === "string"
  ) {
    const next = body.handle.trim().toLowerCase();
    if (!HANDLE_REGEX.test(next)) {
      return Response.json({ error: "handle_invalid" }, { status: 400 });
    }
    const current = await sql`
      SELECT handle, handle_changed_at FROM users WHERE id = ${userId} LIMIT 1
    `;
    const row = current[0];
    if (!row) return Response.json({ error: "not_found" }, { status: 404 });
    if ((row.handle as string) !== next) {
      if (row.handle_changed_at != null) {
        return Response.json(
          { error: "handle_already_changed" },
          { status: 400 },
        );
      }
      const taken = await sql`
        SELECT 1 FROM users WHERE handle = ${next} AND id <> ${userId} LIMIT 1
      `;
      if (taken.length > 0) {
        return Response.json({ error: "handle_taken" }, { status: 400 });
      }
      handleSet = next;
    }
  }

  if (handleSet === null && bioSet === null) {
    return Response.json({ ok: true, changed: false });
  }

  // Two narrow UPDATEs keep the SQL straightforward; only one row, so cost is irrelevant.
  if (handleSet !== null) {
    await sql`
      UPDATE users
         SET handle = ${handleSet},
             handle_changed_at = now()
       WHERE id = ${userId}
    `;
  }
  if (bioSet !== null) {
    await sql`UPDATE users SET bio = ${bioSet.value} WHERE id = ${userId}`;
  }
  return Response.json({ ok: true, changed: true });
}
