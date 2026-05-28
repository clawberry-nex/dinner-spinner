// One-shot: assign a public profile handle to every user that doesn't
// have one yet. Idempotent — skips users where handle is already set.
//
// Usage:
//   DATABASE_URL=postgres://... npx tsx scripts/backfill-handles.ts
//
// After this script reports success, run:
//   psql "$DATABASE_URL" -c 'ALTER TABLE users ALTER COLUMN handle SET NOT NULL;'
// to lock the column down.

import { neon } from "@neondatabase/serverless";
import { slugFromEmail, assignAvailableHandle } from "../lib/auth-helpers";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(databaseUrl);

async function handleExists(handle: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM users WHERE handle = ${handle} LIMIT 1`;
  return rows.length > 0;
}

async function main() {
  const rows = (await sql`
    SELECT id, email FROM users WHERE handle IS NULL ORDER BY created_at
  `) as Array<{ id: string; email: string }>;

  if (rows.length === 0) {
    console.log("No users without a handle. Done.");
    return;
  }
  console.log(`Backfilling ${rows.length} user(s)…`);

  for (const row of rows) {
    const base = slugFromEmail(row.email);
    const handle = await assignAvailableHandle(base, handleExists);
    await sql`UPDATE users SET handle = ${handle} WHERE id = ${row.id}`;
    console.log(`  ${row.email} → @${handle}`);
  }

  console.log("Done. Next: ALTER TABLE users ALTER COLUMN handle SET NOT NULL;");
}

main().catch((err) => {
  console.error(err);
  process.exit(99);
});
