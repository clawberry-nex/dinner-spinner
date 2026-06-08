import { z } from "zod";
import { resolveUserId } from "@/lib/auth-helpers";
import { getPantryDefaults } from "@/lib/pantry";
import { buildIngestPrompt } from "@/lib/ingest/prompt";
import { DISH_INPUT_JSON_SCHEMA } from "@/lib/ingest/schema";
import {
  startClaudeAgentJob,
  ClaudeAgentError,
} from "@/lib/ingest/claude-agent";
import { sql } from "@/lib/db";
import { languageName } from "@/lib/languages";

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
  const langRows = await sql`
    SELECT default_language FROM users WHERE id = ${userId}
  `;
  const targetLanguage = languageName(
    (langRows[0]?.default_language as string | null) ?? null,
  );
  const prompt = buildIngestPrompt({
    userInput: input ?? null,
    pantryList,
    targetLanguage,
  });

  try {
    const job = await startClaudeAgentJob({
      prompt,
      responseSchema: DISH_INPUT_JSON_SCHEMA,
      image,
      token,
      baseUrl: CLAUDE_AGENT_BASE_URL,
      // Photo ingests run on Opus (claude-opus-4-8) for its high-resolution
      // vision (up to a 2576px long edge — see lib/image-compress.ts): it reads
      // small printed quantities (½, 175g) far more accurately than Haiku, which
      // is what makes ingredient amounts come out right from a photo. Verified
      // 4/4 valid structured outputs within claude-agent's 8-turn budget (Sonnet
      // used to exhaust it). Text-only ingests have no OCR problem, so they stay
      // on Haiku — ~30× cheaper (~$0.005 vs ~$0.15/photo) and equally reliable
      // for the structured prompt. With the anyOf-free schema (lib/ingest/
      // schema.ts) both models reliably call submit_result with a valid payload.
      model: image ? "opus" : "haiku",
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
