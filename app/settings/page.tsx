import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import SettingsClient from "./settings-client";

export default async function SettingsPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    redirect("/auth/signin?callbackUrl=%2Fsettings");
  }

  const rows = await sql`
    SELECT email, name, image, password_hash IS NOT NULL AS has_password
    FROM users WHERE id = ${userId} LIMIT 1
  `;
  if (rows.length === 0) {
    redirect("/auth/signin?callbackUrl=%2Fsettings");
  }
  const u = rows[0];
  const seedEmail = (process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();
  const isSeedOwner = (u.email as string) === seedEmail;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24 lg:pb-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-5 pt-[var(--safe-top)] lg:px-10">
          <SettingsClient
            user={{
              email: u.email as string,
              name: (u.name as string | null) ?? null,
              image: (u.image as string | null) ?? null,
              hasPassword: (u.has_password as boolean) ?? false,
              isSeedOwner,
            }}
          />
        </div>
      </div>
    </div>
  );
}
