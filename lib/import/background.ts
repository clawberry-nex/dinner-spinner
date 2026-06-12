import "server-only";

// Server-side, browser-independent completion for a batch import.
//
// The import state machine only advances when something polls it. The browser
// poll (GET /api/import/jobs/[id]) does that while the tab is open — but a large
// non-premium import generates images one slice per step, so if the user closes
// the tab mid-import it freezes in `imaging` forever (the stress-test bug).
//
// kickBackgroundAdvance() fires a server-to-server request to the protected
// /api/import/advance-bg route, which drives the import to completion (and
// re-triggers itself across function-time budgets) with NO browser involved.
// It's a no-op when CRON_SECRET (or a base URL) isn't configured, so the
// feature is off until you set those — behaviour then degrades gracefully to
// the old browser-driven flow.

/** Import statuses the background chain should keep advancing through. `detected`
 *  (awaiting the user's confirm) and `done`/`failed` are terminal for the chain. */
export const CONTINUE_STATUSES = ["detecting", "parsing", "imaging"] as const;

export function isContinueStatus(s: string): boolean {
  return (CONTINUE_STATUSES as readonly string[]).includes(s);
}

/** Bound the self-trigger chain so a persistent backend error can't spin
 *  invocations forever. Each hop does ~45s of work, so 60 hops ≈ 45 min —
 *  far beyond any real import; a stalled one is then left for the daily cron
 *  sweep or a browser revisit to resume. */
export const MAX_HOPS = 60;

function selfBaseUrl(): string | null {
  const authUrl = process.env.AUTH_URL;
  if (authUrl) return authUrl.replace(/\/+$/, "");
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return null;
}

/**
 * Trigger (or continue) the background advance chain for one import. Awaiting
 * this resolves quickly: /api/import/advance-bg ACKs with 202 and does the work
 * in its own after(). Call this inside after() from a route handler.
 */
export async function kickBackgroundAdvance(importId: string, hops = 0): Promise<void> {
  const secret = process.env.CRON_SECRET;
  const base = selfBaseUrl();
  if (!secret || !base) return; // feature off — browser polling drives the import
  if (hops > MAX_HOPS) return;
  try {
    await fetch(`${base}/api/import/advance-bg`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ importId, hops }),
    });
  } catch {
    /* best-effort — browser polling / the daily cron sweep will resume it */
  }
}
