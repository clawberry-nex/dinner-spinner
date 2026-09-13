export type NexAgentErrorCode =
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

export class NexAgentError extends Error {
  code: NexAgentErrorCode;
  status: number | null;
  retryAfter: number | null;
  rawResponse: string | null;

  constructor(opts: {
    code: NexAgentErrorCode;
    message: string;
    status?: number | null;
    retryAfter?: number | null;
    rawResponse?: string | null;
  }) {
    super(opts.message);
    this.name = "NexAgentError";
    this.code = opts.code;
    this.status = opts.status ?? null;
    this.retryAfter = opts.retryAfter ?? null;
    this.rawResponse = opts.rawResponse ?? null;
  }
}

// Every recipe workload explicitly selects OpenAI through Nex's Codex provider.
// The prefix overrides Nex's global default; never fall back to another provider.
export const RECIPE_MODELS = {
  text: "codex:gpt-5.6-sol",
  photo: "codex:gpt-6-astra",
} as const;

export type RecipeModel =
  (typeof RECIPE_MODELS)[keyof typeof RECIPE_MODELS];

function assertRecipeModel(model: RecipeModel): void {
  if (!Object.values(RECIPE_MODELS).includes(model)) {
    throw new NexAgentError({
      code: "validation",
      message: "Recipe jobs require an explicit supported OpenAI model",
    });
  }
}

export interface CallArgs {
  prompt: string;
  responseSchema: object;
  image?: { data: string; mediaType: string };
  token: string;
  baseUrl: string;
  /** ms; default 60000. */
  timeoutMs?: number;
  /** Required OpenAI selection; recipe jobs must never inherit Nex defaults. */
  model: RecipeModel;
}

export interface CallResult {
  structured: unknown;
  costUsd: number | null;
  rawResponse: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export async function callNexAgent(
  args: CallArgs,
  opts: { fetcher?: typeof fetch } = {},
): Promise<CallResult> {
  assertRecipeModel(args.model);
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
        model: args.model,
        ...(args.image
          ? { images: [{ data: args.image.data, media_type: args.image.mediaType }] }
          : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new NexAgentError({
        code: "timeout",
        message: `claude-agent did not respond within ${args.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
      });
    }
    throw new NexAgentError({
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  clearTimeout(timeout);

  const body = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string }; structured?: unknown; response?: string; cost_usd?: number | null }
    | null;

  if (!res.ok) {
    const code = (body?.error?.code as NexAgentErrorCode) ?? "agent_error";
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;
    throw new NexAgentError({
      code,
      message: body?.error?.message ?? `claude-agent ${res.status}`,
      status: res.status,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
      rawResponse: body?.response ?? null,
    });
  }

  if (!body || body.structured === undefined || body.structured === null) {
    throw new NexAgentError({
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
  model: RecipeModel;
  /** ms; default 15000. Just the POST to claude-agent, not the job itself. */
  timeoutMs?: number;
}

export interface JobHandle {
  jobId: string;
  pollUrl: string;
}

export async function startNexAgentJob(
  args: StartJobArgs,
  opts: { fetcher?: typeof fetch } = {},
): Promise<JobHandle> {
  assertRecipeModel(args.model);
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
        model: args.model,
        ...(args.image
          ? { images: [{ data: args.image.data, media_type: args.image.mediaType }] }
          : {}),
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new NexAgentError({
        code: "timeout",
        message: `claude-agent did not respond within ${args.timeoutMs ?? 15_000}ms`,
      });
    }
    throw new NexAgentError({
      code: "network_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  clearTimeout(timeout);

  const body = (await res.json().catch(() => null)) as
    | { job_id?: string; poll_url?: string; error?: { code?: string; message?: string } }
    | null;

  if (!res.ok || !body?.job_id) {
    const code = (body?.error?.code as NexAgentErrorCode) ?? "agent_error";
    throw new NexAgentError({
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

export async function pollNexAgentJob(
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
      throw new NexAgentError({
        code: "timeout",
        message: `claude-agent poll did not respond within ${args.timeoutMs ?? 10_000}ms`,
      });
    }
    throw new NexAgentError({
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
    const code = (body?.error?.code as NexAgentErrorCode) ?? "agent_error";
    throw new NexAgentError({
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
  throw new NexAgentError({
    code: "agent_error",
    message: `unexpected job status: ${body?.status ?? "?"}`,
    rawResponse: JSON.stringify(body),
  });
}
