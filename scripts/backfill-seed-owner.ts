// One-shot: assign every pre-multi-user row to the seed owner.
//
// Usage:
//   DATABASE_URL=postgres://... SEED_OWNER_EMAIL=you@example.com \
//     npx tsx scripts/backfill-seed-owner.ts
//
// Idempotency: if ANY dish already has a non-null user_id, the script
// refuses to run (exits with code 3). Re-run after a partial failure is
// safe because every UPDATE filters on `user_id IS NULL`.
//
// The seed owner must have signed in via Google at least once so their
// users row exists. If not, the script exits with code 2.

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
const seedEmail = (process.env.SEED_OWNER_EMAIL ?? "").trim().toLowerCase();

if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
if (!seedEmail) {
  console.error("SEED_OWNER_EMAIL is not set");
  process.exit(1);
}

const sql = neon(databaseUrl);

async function main() {
  const userRows = await sql`SELECT id FROM users WHERE email = ${seedEmail} LIMIT 1`;
  if (userRows.length === 0) {
    console.error(
      `No user with email ${seedEmail}. Sign in with Google first, then re-run.`,
    );
    process.exit(2);
  }
  const userId = userRows[0].id as string;

  const assigned = await sql`SELECT COUNT(*)::int AS c FROM dishes WHERE user_id IS NOT NULL`;
  if ((assigned[0].c as number) > 0) {
    console.error(
      "dishes already has rows with user_id set. Refusing to run (would be ambiguous).",
    );
    process.exit(3);
  }

  console.log(`Seed owner user_id = ${userId}`);

  console.log("Updating dishes...");
  const d = await sql`
    UPDATE dishes SET user_id = ${userId} WHERE user_id IS NULL RETURNING id
  `;
  console.log(`  ${d.length} dishes updated`);

  console.log("Updating pantry_names...");
  const p = await sql`
    UPDATE pantry_names SET user_id = ${userId} WHERE user_id IS NULL RETURNING name
  `;
  console.log(`  ${p.length} pantry names updated`);

  console.log("Updating cook_log...");
  const c = await sql`
    UPDATE cook_log SET user_id = ${userId} WHERE user_id IS NULL RETURNING id
  `;
  console.log(`  ${c.length} cook-log rows updated`);

  console.log("Updating legacy meal_plan row...");
  const m = await sql`
    UPDATE meal_plan SET user_id = ${userId} WHERE user_id IS NULL RETURNING entries
  `;
  console.log(`  ${m.length} meal_plan row(s) updated`);

  console.log("Done. Next step: apply db/lockdown.sql to flip user_id columns NOT NULL.");
}

main().catch((err) => {
  console.error(err);
  process.exit(99);
});
