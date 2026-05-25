import { z } from "zod";
import { resolveUserId } from "@/lib/auth-helpers";
import { getPantryDefaults } from "@/lib/pantry";
import { buildIngestPrompt } from "@/lib/ingest/prompt";
import { DISH_INPUT_JSON_SCHEMA } from "@/lib/ingest/schema";
import {
  startClaudeAgentJob,
  ClaudeAgentError,
} from "@/lib/ingest/claude-agent";

// Async pattern: this route only KICKS OFF the ingest job and returns a
// job_id in <1s. The browser polls /api/ingest/jobs/[id] for the result.
// Vercel function duration is no longer a bottleneck.
export const maxDuration = 30;

const CLAUDE_AGENT_BASE_URL =
  process.env.CLAUDE_AGENT_URL ?? "https://nex.tail7f6b96.ts.net:10000";

const IngestRequestSchema = z
  .object({
    input: z.string().trim().min(1).max(50_000).optional(),
    image: z
      .object({
        // ~4.4MB base64 cap. Vercel Hobby's serverless function body limit
        // is 4.5MB; the client compresses to <1MB so neither cap normally
        // fires.
        data: z.string().min(1).max(4_500_000),
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      })
      .optional(),
  })
  .refine((v) => v.input || v.image, {
    message: "Provide `input`, `image`, or both",
  });

function errorEnvelope(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error: { code, message, ...extra } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const userId = await resolveUserId(request);
  if (!userId) {
    return errorEnvelope("unauthorized", "Unauthorized", 401);
  }

  const token = process.env.NEX_API_TOKEN;
  if (!token) {
    return errorEnvelope(
      "ingest_disabled",
      "Recipe ingestion is not configured (NEX_API_TOKEN missing).",
      503,
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorEnvelope("validation", "Body must be JSON", 400);
  }
  const parsed = IngestRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorEnvelope("validation", parsed.error.message, 400);
  }
  const { input, image } = parsed.data;

  const pantrySet = await getPantryDefaults(userId);
  const pantryList = Array.from(pantrySet).sort();
  const prompt = buildIngestPrompt({
    userInput: input ?? null,
    pantryList,
  });

  try {
    const job = await startClaudeAgentJob({
      prompt,
      responseSchema: DISH_INPUT_JSON_SCHEMA,
      image,
      token,
      baseUrl: CLAUDE_AGENT_BASE_URL,
      // Sonnet — fast enough on the long structured prompt and reliable
      // (Haiku misses recipes; Opus is too slow). With the async pattern
      // the Vercel function duration no longer bounds this, but Sonnet
      // still keeps the poll loop short for users.
      model: "sonnet",
    });
    return Response.json({ jobId: job.jobId }, { status: 202 });
  } catch (err) {
    if (err instanceof ClaudeAgentError) {
      const status =
        err.code === "rate_limited" || err.code === "queue_full"
          ? 429
          : err.code === "timeout"
            ? 504
            : err.code === "network_error" || err.code === "disabled"
              ? 503
              : err.code === "unauthorized" || err.code === "scope_missing"
                ? 502
                : 502;
      console.error("[ingest] start-job failure", {
        code: err.code,
        status: err.status,
      });
      return errorEnvelope(err.code, err.message, status);
    }
    console.error("[ingest] unexpected start failure", err);
    return errorEnvelope("agent_error", "Unexpected ingest failure", 500);
  }
}
