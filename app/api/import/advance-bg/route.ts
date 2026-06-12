import { after } from "next/server";
import { sql } from "@/lib/db";
import { advanceImport } from "@/lib/import/advance";
import { parseImportRow } from "@/lib/import/types";
import { isContinueStatus, kickBackgroundAdvance, MAX_HOPS } from "@/lib/import/background";

// Protected, browser-independent driver for the batch-import state machine.
// POST {importId, hops} — drive that import as far as this invocation's time
// budget allows, then hand off to a fresh invocation (the self-trigger chain),
// so an import completes even after the user closes the tab.
// GET — sweep stale non-terminal imports (Vercel Cron safety net; daily on Hobby).
// Auth: Authorization: Bearer ${CRON_SECRET}. Disabled (401) when unset.
export const maxDuration = 60;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function err(code: string, status: number): Response {
  return Response.json({ error: { code } }, { status });
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Acquire the advance lock for one import that's still in a continuable state.
async function lockOne(importId: string) {
  return sql`
    UPDATE import_jobs SET locked_until = now() + interval '75 seconds'
     WHERE id = ${importId} AND status IN ('detecting', 'parsing', 'imaging')
       AND (locked_until IS NULL OR locked_until < now())
     RETURNING *
  `;
}

/**
 * Drive one import to completion as far as the time budget allows; if work
 * remains, hand off to a fresh invocation. Runs inside after() so the route
 * responds immediately. Stops on any terminal/awaiting status (detected, done,
 * failed), so the chain can't spin forever.
 */
async function driveImport(importId: string, hops: number): Promise<void> {
  const deadline = Date.now() + 45_000; // headroom under maxDuration (60s)
  while (Date.now() < deadline) {
    let locked;
    try {
      locked = await lockOne(importId);
    } catch {
      return; // DB hiccup — let a browser poll / the daily sweep resume it
    }
    if (locked.length !== 1) {
      // Contended (a browser poll holds the lock) or already terminal.
      let cur;
      try {
        cur = await sql`SELECT status FROM import_jobs WHERE id = ${importId}`;
      } catch {
        return;
      }
      if (cur.length === 0 || !isContinueStatus(cur[0].status as string)) return; // terminal → stop
      await sleep(3000); // the browser is driving (or transient) — back off and retry
      continue;
    }
    const row = parseImportRow(locked[0]);
    let advanced;
    try {
      advanced = await advanceImport(row);
    } catch {
      await sql`UPDATE import_jobs SET locked_until = NULL WHERE id = ${importId}`.catch(() => {});
      await sleep(2000);
      continue;
    }
    if (!isContinueStatus(advanced.status)) return; // detected / done / failed → stop the chain
  }
  // Budget exhausted but still running → continue in a fresh invocation.
  if (hops < MAX_HOPS) await kickBackgroundAdvance(importId, hops + 1);
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) return err("unauthorized", 401);
  let importId: string | null = null;
  let hops = 0;
  try {
    const b = (await req.json()) as { importId?: unknown; hops?: unknown };
    if (typeof b?.importId === "string") importId = b.importId;
    if (typeof b?.hops === "number" && Number.isFinite(b.hops)) hops = b.hops;
  } catch {
    /* no/invalid body */
  }
  if (!importId) return err("validation", 400);
  const id = importId;
  after(() => driveImport(id, hops));
  return Response.json({ ok: true }, { status: 202 });
}

// Vercel Cron triggers a GET (with the CRON_SECRET bearer). Nudge any import
// that's stuck in a non-terminal state and isn't currently being advanced.
export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) return err("unauthorized", 401);
  let stale;
  try {
    stale = await sql`
      SELECT id FROM import_jobs
       WHERE status IN ('detecting', 'parsing', 'imaging')
         AND (locked_until IS NULL OR locked_until < now())
         AND updated_at < now() - interval '2 minutes'
       ORDER BY updated_at
       LIMIT 5
    `;
  } catch {
    return err("agent_error", 500);
  }
  for (const r of stale) {
    const id = String(r.id);
    after(() => driveImport(id, 0));
  }
  return Response.json({ ok: true, swept: stale.length });
}
