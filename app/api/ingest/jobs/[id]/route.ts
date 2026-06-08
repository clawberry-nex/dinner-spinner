import { resolveUserId } from "@/lib/auth-helpers";
import { DishInputSchema } from "@/lib/types";
import { coerceMethodRefs } from "@/lib/ingest/sanitize";
import {
  pollClaudeAgentJob,
  ClaudeAgentError,
} from "@/lib/ingest/claude-agent";

// Just a poll proxy. Should respond in <1s in practice.
export const maxDuration = 15;

const CLAUDE_AGENT_BASE_URL =
  process.env.CLAUDE_AGENT_URL ?? "https://nex.tail7f6b96.ts.net:10000";

function errorEnvelope(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

export async function GET(
  req: Request,
  ctx: RouteContext<"/api/ingest/jobs/[id]">,
): Promise<Response> {
  const userId = await resolveUserId(req);
  if (!userId) return errorEnvelope("unauthorized", "Unauthorized", 401);

  const token = process.env.NEX_API_TOKEN;
  if (!token) {
    return errorEnvelope(
      "ingest_disabled",
      "Recipe ingestion is not configured.",
      503,
    );
  }

  const { id } = await ctx.params;
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return errorEnvelope("validation", "invalid job id", 400);
  }

  try {
    const result = await pollClaudeAgentJob(id, {
      token,
      baseUrl: CLAUDE_AGENT_BASE_URL,
    });

    if (result.status === "done") {
      // methodRefs resilience: claude-agent's structured output can hand back
      // methodRefs as a JSON string, a non-array, or an array with individually-
      // malformed entries (e.g. an over-length phrase). Coerce/drop them rather
      // than failing the whole dish — cook mode falls back to string-matching for
      // any that are absent. (See lib/ingest/sanitize.ts.)
      coerceMethodRefs(result.structured);

      // Re-validate the structured payload against our canonical Zod schema.
      // claude-agent enforces JSON Schema structurally but not all our
      // semantic constraints.
      const validated = DishInputSchema.safeParse(result.structured);
      if (!validated.success) {
        console.error("[ingest poll] Zod re-validate failed", {
          jobId: id,
          issues: validated.error.issues,
        });
        return Response.json({
          status: "failed",
          error: {
            code: "bad_response",
            message: "Parsed dish failed validation",
          },
        });
      }
      console.log("[ingest poll] ok", {
        jobId: id,
        costUsd: result.costUsd,
        title: validated.data.title,
      });
      return Response.json({ status: "done", dish: validated.data });
    }

    if (result.status === "failed") {
      return Response.json({
        status: "failed",
        error: { code: result.errorCode, message: result.errorMessage },
      });
    }

    // pending | running — let the client keep polling. Forward the agent's
    // narration of what step it's on so the UI can show real progress
    // instead of a generic spinner.
    return Response.json({
      status: result.status,
      currentStep: result.currentStep,
    });
  } catch (err) {
    if (err instanceof ClaudeAgentError) {
      const status =
        err.code === "not_found"
          ? 404
          : err.code === "timeout"
            ? 504
            : err.code === "network_error" || err.code === "disabled"
              ? 503
              : 502;
      return errorEnvelope(err.code, err.message, status);
    }
    console.error("[ingest poll] unexpected failure", err);
    return errorEnvelope("agent_error", "Unexpected poll failure", 500);
  }
}
