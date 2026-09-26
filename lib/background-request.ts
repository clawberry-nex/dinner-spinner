// Shared transport for server-side background chains. Only trusted deployment
// configuration chooses the destination; never forward CRON_SECRET to a Host
// header supplied by an incoming request.
interface BackgroundEnvironment {
  [key: string]: string | undefined;
  AUTH_URL?: string;
  CRON_SECRET?: string;
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_AUTOMATION_BYPASS_SECRET?: string;
}

type BackgroundPath =
  | "/api/dishes/images/advance-bg"
  | "/api/import/advance-bg";

function selfBaseUrl(env: BackgroundEnvironment): string | null {
  // Generated deployment URLs can require Vercel authentication even in
  // production. The production domain remains reachable under Standard
  // Protection. Never use it for previews: they must call their own code/env.
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "development") return null;
  return env.AUTH_URL?.replace(/\/+$/, "") || null;
}

/** Best-effort handoff; browser polling and the daily sweep remain fallbacks. */
export async function postBackgroundAdvance(
  path: BackgroundPath,
  body: { jobId: string; hops: number } | { importId: string; hops: number },
  opts: {
    env?: BackgroundEnvironment;
    fetcher?: typeof fetch;
    warn?: (message: string) => void;
  } = {},
): Promise<void> {
  const env = opts.env ?? process.env;
  const base = selfBaseUrl(env);
  if (!env.CRON_SECRET || !base) return;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${env.CRON_SECRET}`,
  };
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }

  const warn = opts.warn ?? console.warn;
  try {
    const response = await (opts.fetcher ?? fetch)(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // A redirect/login page must not look like a successful handoff. Keep
      // the request bounded so it fits after a 45-second background work loop.
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 202) {
      warn(`[background] ${path} handoff rejected (HTTP ${response.status})`);
    }
  } catch {
    // Do not log request headers, response bodies, or arbitrary error messages:
    // these requests carry both app and optional deployment-protection secrets.
    warn(`[background] ${path} handoff failed or timed out`);
  }
}
