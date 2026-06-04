import { sql } from "@/lib/db";
import { resolveUserId } from "@/lib/auth-helpers";
import { isSupportedLanguage } from "@/lib/languages";

export async function GET(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rows = await sql`SELECT default_language FROM users WHERE id = ${userId}`;
  return Response.json({
    language: (rows[0]?.default_language as string | null) ?? null,
  });
}

export async function PATCH(req: Request) {
  const userId = await resolveUserId(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { language?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  // null clears (= default English). Otherwise must be a known code.
  const language =
    body.language == null ? null : body.language.trim().toLowerCase();
  if (!isSupportedLanguage(language)) {
    return Response.json({ error: "unsupported_language" }, { status: 400 });
  }
  await sql`UPDATE users SET default_language = ${language} WHERE id = ${userId}`;
  return Response.json({ ok: true });
}
