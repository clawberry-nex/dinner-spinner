import { z } from "zod";
import { resolveUserId } from "@/lib/auth-helpers";
import { DishInputSchema } from "@/lib/types";
import { getPantryDefaults } from "@/lib/pantry";
import { buildIngestPrompt } from "@/lib/ingest/prompt";
import { DISH_INPUT_JSON_SCHEMA } from "@/lib/ingest/schema";
import { callClaudeAgent, ClaudeAgentError } from "@/lib/ingest/claude-agent";

// claude-agent's first call is ~12s; allow comfortable headroom on top of
// Vercel Hobby's 10s default.
export const maxDuration = 60;

const CLAUDE_AGENT_BASE_URL =
  process.env.CLAUDE_AGENT_URL ?? "https://nex.tail7f6b96.ts.net:10000";

const IngestRequestSchema = z
  .object({
    input: z.string().trim().min(1).max(50_000).optional(),
    image: z
      .object({
        // ~4.4MB base64 cap. Vercel Hobby's serverless function body limit is
        // 4.5MB and fires first in practice; this Zod check is the
        // belt-and-suspenders for off-Vercel callers (curl, scripts).
        // Client compresses to <1MB so neither cap normally fires.
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

  const t0 = Date.now();
  let result;
  try {
    result = await callClaudeAgent({
      prompt,
      responseSchema: DISH_INPUT_JSON_SCHEMA,
      image,
      token,
      baseUrl: CLAUDE_AGENT_BASE_URL,
      // Vercel Hobby kills the function at 60s. Abort our call to
      // claude-agent at 55s so we return a clean error envelope to the
      // browser instead of getting hard-killed mid-flight.
      timeoutMs: 55_000,
    });
  } catch (err) {
    if (err instanceof ClaudeAgentError) {
      // Map claude-agent codes to upstream-facing statuses.
      const status =
        err.code === "rate_limited" || err.code === "queue_full"
          ? 429
          : err.code === "timeout"
            ? 504
            : err.code === "network_error" || err.code === "disabled"
              ? 503 // claude-agent unreachable or kill-switched — try again later
              : err.code === "unauthorized" || err.code === "scope_missing"
                ? 502 // misconfig from our side — surface as upstream issue
                : 502;
      console.error("[ingest] claude-agent failure", {
        code: err.code,
        status: err.status,
        rawResponse: err.rawResponse,
      });
      return errorEnvelope(err.code, err.message, status, {
        rawResponse: err.rawResponse,
        retryAfter: err.retryAfter,
      });
    }
    console.error("[ingest] unexpected failure", err);
    return errorEnvelope("agent_error", "Unexpected ingest failure", 500);
  }

  // Defense in depth: re-validate the structured payload against the
  // canonical Zod schema before handing it to the client. claude-agent
  // enforces JSON Schema structurally but not semantically (e.g. string
  // length, enum-like constraints).
  const validated = DishInputSchema.safeParse(result.structured);
  if (!validated.success) {
    console.error("[ingest] Zod re-validate failed", {
      issues: validated.error.issues,
      structured: result.structured,
    });
    return errorEnvelope(
      "bad_response",
      "Parsed dish failed validation",
      502,
      { issues: validated.error.issues, structured: result.structured },
    );
  }

  console.log("[ingest] ok", {
    latencyMs: Date.now() - t0,
    costUsd: result.costUsd,
    title: validated.data.title,
  });

  return Response.json({ dish: validated.data });
}
