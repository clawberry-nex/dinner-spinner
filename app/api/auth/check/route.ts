import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth";

export async function GET() {
  const jar = await cookies();
  const ok = verifySessionCookieValue(jar.get(ADMIN_COOKIE_NAME)?.value);
  return Response.json({ authenticated: ok });
}
