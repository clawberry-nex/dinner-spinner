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

export interface CallArgs {
  prompt: string;
  responseSchema: object;
  image?: { data: string; mediaType: string };
  token: string;
  baseUrl: string;
  /** ms; default 60000. */
  timeoutMs?: number;
  /** claude-agent model alias: opus | sonnet | haiku. Omit to use claude-agent's default. */
  model?: "opus" | "sonnet" | "haiku";
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
