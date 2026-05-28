import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";

/**
 * /me → /u/<your-handle>. Anon visitors get bounced to sign-in with a
 * callback that lands them back here after auth. Used by the tab bar's
 * "You" link so the tab href can stay stable regardless of who's signed in.
 */
export default async function MePage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    redirect("/auth/signin?callbackUrl=%2Fme");
  }
  const rows = await sql`SELECT handle FROM users WHERE id = ${userId} LIMIT 1`;
  const handle = rows[0]?.handle as string | undefined;
  if (!handle) {
    // Shouldn't happen post-backfill, but degrade gracefully.
    redirect("/settings");
  }
  redirect(`/u/${handle}`);
}
