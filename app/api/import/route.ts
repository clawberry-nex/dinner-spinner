import { resolveUserId } from "@/lib/auth-helpers";
import { sql } from "@/lib/db";
import { startClaudeAgentJob, ClaudeAgentError } from "@/lib/ingest/claude-agent";
import { buildDetectPrompt, DETECT_JSON_SCHEMA } from "@/lib/import/detect";
import { parseImportRow, rowToImportProgress } from "@/lib/import/types";

// Just the detect-job kickoff (claude-agent runs the split off-Vercel); fast.
export const maxDuration = 30;

const CLAUDE_AGENT_BASE_URL =
  process.env.CLAUDE_AGENT_URL ?? "https://nex.tail7f6b96.ts.net:10000";

// Generous v1 input guard (not a recipe cap — that's deliberately unbounded).
// ~200k chars holds a large cookbook excerpt; bigger docs should be split.
const MAX_TEXT_CHARS = 200_000;

function err(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

// Discover the caller's most recent in-flight import so the client can resume
// it on load (after a reload, or after navigating away before it finished).
// Read-only — advancing happens on GET /api/import/jobs/[id].
export async function GET(req: Request): Promise<Response> {
  const userId = await resolveUserId(req);
  if (!userId) return err("unauthorized", "Unauthorized", 401);
  const rows = await sql`
    SELECT * FROM import_jobs
     WHERE user_id = ${userId} AND status NOT IN ('done', 'failed')
     ORDER BY created_at DESC LIMIT 1
  `;
  if (rows.length === 0) return Response.json({ active: null });
  const row = parseImportRow(rows[0]);
  return Response.json({ active: { importId: row.id, progress: rowToImportProgress(row) } });
}

export async function POST(req: Request): Promise<Response> {
  const userId = await resolveUserId(req);
  if (!userId) return err("unauthorized", "Unauthorized", 401);

  const token = process.env.NEX_API_TOKEN;
  if (!token) {
    return err("import_disabled", "Batch import is not configured (NEX_API_TOKEN missing).", 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("validation", "Invalid JSON", 400);
  }
  const obj = (body ?? {}) as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  const fileName = typeof obj.fileName === "string" ? obj.fileName.slice(0, 200) : null;
  if (!text) return err("validation", "No text provided", 400);
  if (text.length > MAX_TEXT_CHARS) {
    return err(
      "too_large",
      `Document is too large (${text.length.toLocaleString()} characters; max ${MAX_TEXT_CHARS.toLocaleString()}). Split it into smaller files.`,
      413,
    );
  }

  // Opportunistic prune — keep import_jobs small without a cron.
  await sql`DELETE FROM import_jobs WHERE created_at < now() - interval '1 day'`.catch(() => {});

  // Kick off the detect job (claude-agent splits the doc into recipe chunks).
  let detectJobId: string;
  try {
    const job = await startClaudeAgentJob({
      prompt: buildDetectPrompt(text),
      responseSchema: DETECT_JSON_SCHEMA,
      token,
      baseUrl: CLAUDE_AGENT_BASE_URL,
      model: "sonnet",
    });
    detectJobId = job.jobId;
  } catch (e) {
    if (e instanceof ClaudeAgentError) {
      const status =
        e.code === "queue_full" || e.code === "rate_limited"
          ? 429
          : e.code === "timeout"
            ? 504
            : e.code === "network_error" || e.code === "disabled"
              ? 503
              : 502;
      return err(e.code, e.message, status);
    }
    return err("agent_error", "Failed to start detection", 500);
  }

  const rows = await sql`
    INSERT INTO import_jobs (user_id, status, detect_job_id, file_name)
    VALUES (${userId}, 'detecting', ${detectJobId}, ${fileName})
    RETURNING id
  `;
  return Response.json({ importId: rows[0].id as string }, { status: 202 });
}
