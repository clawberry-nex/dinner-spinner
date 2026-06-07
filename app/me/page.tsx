import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";

export const metadata = {
  title: "You — Dinner Spinner",
};

/**
 * /me is the owner's entry point to their kitchen — a thin server redirect to
 * their canonical `/u/<handle>` page, which renders the full owner experience
 * (identity, kitchen stats, every dish, edit/share/settings/sign-out). Anon
 * visitors get bounced to sign-in with a callback back here.
 */
export default async function MePage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    redirect("/auth/signin?callbackUrl=%2Fme");
  }
  const rows = await sql`
    SELECT handle FROM users WHERE id = ${userId} LIMIT 1
  `;
  const handle = rows[0]?.handle as string | undefined;
  if (!handle) {
    // Shouldn't happen — session points to a user row that doesn't exist.
    redirect("/auth/signin?callbackUrl=%2Fme");
  }
  redirect(`/u/${handle}`);
}
