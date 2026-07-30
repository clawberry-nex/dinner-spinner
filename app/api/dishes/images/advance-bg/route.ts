import { after } from "next/server";
import { sql } from "@/lib/db";
import { driveDishImageJob } from "@/lib/dish-image-background";

export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  let jobId: string | null = null;
  let hops = 0;
  try {
    const body = (await req.json()) as { jobId?: unknown; hops?: unknown };
    if (typeof body.jobId === "string") jobId = body.jobId;
    if (typeof body.hops === "number" && Number.isFinite(body.hops)) {
      hops = body.hops;
    }
  } catch {
    // Validation below returns the stable error envelope.
  }
  if (!jobId) {
    return Response.json({ error: { code: "validation" } }, { status: 400 });
  }
  const id = jobId;
  after(() => driveDishImageJob(id, hops));
  return Response.json({ ok: true }, { status: 202 });
}

// Daily safety net for a failed self-handoff. Real-time completion comes from
// the POST chain and browser polling.
export async function GET(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const stale = await sql`
    SELECT id FROM image_jobs
     WHERE status = 'pending'
       AND created_at > now() - interval '1 day'
       AND (locked_until IS NULL OR locked_until < now())
       AND updated_at < now() - interval '2 minutes'
     ORDER BY updated_at
     LIMIT 10
  `;
  for (const row of stale) {
    const id = String(row.id);
    after(() => driveDishImageJob(id, 0));
  }
  return Response.json({ ok: true, swept: stale.length });
}
