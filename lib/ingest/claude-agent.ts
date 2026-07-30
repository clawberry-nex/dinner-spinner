export type ClaudeAgentErrorCode =
  | "unauthorized"
  | "scope_missing"
  | "rate_limited"
  | "queue_full"
  | "disabled"
  | "not_found"
  | "validation"
  | "agent_error"
  | "schema_not_satisfied"
  | "bad_response"
  | "network_error"
  | "timeout";

export class ClaudeAgentError extends Error {
  code: ClaudeAgentErrorCode;
  status: number | null;
  retryAfter: number | null;
  rawResponse: string | null;

  constructor(opts: {
    code: ClaudeAgentErrorCode;
    message: string;
    status?: number | null;
    retryAfter?: number | null;
    rawResponse?: string | null;
  }) {
    super(opts.message);
    this.name = "ClaudeAgentError";
    this.code = opts.code;
    this.status = opts.status ?? null;
    this.retryAfter = opts.retryAfter ?? null;
    this.rawResponse = opts.rawResponse ?? null;
  }
}

// Recipe ingestion is deliberately tuned and costed against these Claude tiers.
// Prefixing the aliases keeps global Nex harness changes from silently rerouting
// structured recipe jobs through another provider.
export const CLAUDE_HARNESS_MODELS = {
  opus: "claude:opus",
  sonnet: "claude:sonnet",
  haiku: "claude:haiku",
} as const;

export type ClaudeHarnessModel =
  (typeof CLAUDE_HARNESS_MODELS)[keyof typeof CLAUDE_HARNESS_MODELS];

export interface CallArgs {
  prompt: string;
  responseSchema: object;
  image?: { data: string; mediaType: string };
  token: string;
  baseUrl: string;
  /** ms; default 60000. */
  timeoutMs?: number;
  /** Explicit Claude-harness model tier. Omit to use the Nex runtime default. */
  model?: ClaudeHarnessModel;
}

export interface CallResult {
  structured: unknown;
  costUsd: number | null;
  rawResponse: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function callClaudeAgent(
  args: CallArgs,
  opts: { fetcher?: typeof fetch } = {},
): Promise<CallResult> {
  const fetcher = opts.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await fetcher(`${args.baseUrl}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify({
        prompt: args.prompt,
        response_schema: args.responseSchema,
        ...(args.model ? { model: args.model } : {}),
        ...(args.image
          ? { images: [{ data: args.image.data, media_type: args.image.mediaType }] }
          : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new ClaudeAgentError({
        code: "timeout",
        message: `claude-agent did not respond within ${args.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
      });
    }
    throw new ClaudeAgentError({
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  clearTimeout(timeout);

  const body = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string }; structured?: unknown; response?: string; cost_usd?: number | null }
    | null;

  if (!res.ok) {
    const code = (body?.error?.code as ClaudeAgentErrorCode) ?? "agent_error";
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;
    throw new ClaudeAgentError({
      code,
      message: body?.error?.message ?? `claude-agent ${res.status}`,
      status: res.status,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
      rawResponse: body?.response ?? null,
    });
  }

  if (!body || body.structured === undefined || body.structured === null) {
    throw new ClaudeAgentError({
      code: "bad_response",
      message: "claude-agent returned no `structured` field",
      status: res.status,
      rawResponse: body?.response ?? null,
    });
  }

  return {
    structured: body.structured,
    costUsd: body.cost_usd ?? null,
    rawResponse: body.response ?? "",
  };
}

// =========================================================================
// Async (job-based) flow — POST /chat-async returns a job_id immediately;
// poll GET /jobs/:id until status flips to done|failed. Lets Vercel functions
// stay short (~1s) regardless of how long the agent takes to process.
// =========================================================================

export interface StartJobArgs {
  prompt: string;
  responseSchema: object;
  image?: { data: string; mediaType: string };
  token: string;
  baseUrl: string;
  model?: ClaudeHarnessModel;
  /** ms; default 15000. Just the POST to claude-agent, not the job itself. */
  timeoutMs?: number;
}

export interface JobHandle {
  jobId: string;
  pollUrl: string;
}

export async function startClaudeAgentJob(
  args: StartJobArgs,
  opts: { fetcher?: typeof fetch } = {},
): Promise<JobHandle> {
  const fetcher = opts.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 15_000);

  let res: Response;
  try {
    res = await fetcher(`${args.baseUrl}/chat-async`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.token}`,
      },
      body: JSON.stringify({
        prompt: args.prompt,
        response_schema: args.responseSchema,
        ...(args.model ? { model: args.model } : {}),
        ...(args.image
          ? { images: [{ data: args.image.data, media_type: args.image.mediaType }] }
          : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new ClaudeAgentError({
        code: "timeout",
        message: `claude-agent did not respond within ${args.timeoutMs ?? 15_000}ms`,
      });
    }
    throw new ClaudeAgentError({
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  clearTimeout(timeout);

  const body = (await res.json().catch(() => null)) as
    | { job_id?: string; poll_url?: string; error?: { code?: string; message?: string } }
    | null;

  if (!res.ok || !body?.job_id) {
    const code = (body?.error?.code as ClaudeAgentErrorCode) ?? "agent_error";
    throw new ClaudeAgentError({
      code,
      message: body?.error?.message ?? `claude-agent ${res.status}`,
      status: res.status,
    });
  }

  return { jobId: body.job_id, pollUrl: body.poll_url ?? `/api/v1/jobs/${body.job_id}` };
}

export type PollResult =
  | { status: "pending" | "running"; currentStep: string | null }
  | {
      status: "done";
      structured: unknown;
      response: string;
      costUsd: number | null;
      sessionId: string | null;
    }
  | { status: "failed"; errorCode: string; errorMessage: string };

export async function pollClaudeAgentJob(
  jobId: string,
  args: { token: string; baseUrl: string; timeoutMs?: number },
  opts: { fetcher?: typeof fetch } = {},
): Promise<PollResult> {
  const fetcher = opts.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 10_000);

  let res: Response;
  try {
    res = await fetcher(`${args.baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
      headers: { authorization: `Bearer ${args.token}` },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new ClaudeAgentError({
        code: "timeout",
        message: `claude-agent poll did not respond within ${args.timeoutMs ?? 10_000}ms`,
      });
    }
    throw new ClaudeAgentError({
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  clearTimeout(timeout);

  const body = (await res.json().catch(() => null)) as
    | {
        status?: string;
        current_step?: string | null;
        structured?: unknown;
        response?: string;
        cost_usd?: number | null;
        session_id?: string | null;
        error?: { code?: string; message?: string };
      }
    | null;

  if (!res.ok) {
    const code = (body?.error?.code as ClaudeAgentErrorCode) ?? "agent_error";
    throw new ClaudeAgentError({
      code,
      message: body?.error?.message ?? `claude-agent ${res.status}`,
      status: res.status,
    });
  }

  if (body?.status === "pending" || body?.status === "running") {
    return { status: body.status, currentStep: body.current_step ?? null };
  }
  if (body?.status === "done") {
    return {
      status: "done",
      structured: body.structured,
      response: body.response ?? "",
      costUsd: body.cost_usd ?? null,
      sessionId: body.session_id ?? null,
    };
  }
  if (body?.status === "failed") {
    return {
      status: "failed",
      errorCode: body.error?.code ?? "agent_error",
      errorMessage: body.error?.message ?? "job failed",
    };
  }
  throw new ClaudeAgentError({
    code: "agent_error",
    message: `unexpected job status: ${body?.status ?? "?"}`,
    rawResponse: JSON.stringify(body),
  });
}
