import { test } from "node:test";
import assert from "node:assert/strict";
import { callClaudeAgent, ClaudeAgentError } from "./claude-agent.ts";

const SCHEMA = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("returns parsed `structured` on a 200", async () => {
  const fetcher = async () =>
    jsonResponse({
      session_id: "abc",
      response: "",
      structured: { title: "Pasta" },
      cost_usd: 0.005,
      turn_count: 1,
    });
  const out = await callClaudeAgent(
    {
      prompt: "p",
      responseSchema: SCHEMA,
      token: "nxk_test",
      baseUrl: "http://mock.test",
    },
    { fetcher },
  );
  assert.deepEqual(out.structured, { title: "Pasta" });
});

test("sends the expected request body", async () => {
  let captured: { url?: string; body?: unknown; auth?: string | null } = {};
  const fetcher: typeof fetch = async (input, init) => {
    captured.url = String(input);
    captured.body = JSON.parse(String(init?.body ?? "{}"));
    const headers = new Headers(init?.headers);
    captured.auth = headers.get("authorization");
    return jsonResponse({
      session_id: "x",
      response: "",
      structured: { title: "x" },
      cost_usd: 0,
      turn_count: 1,
    });
  };
  await callClaudeAgent(
    {
      prompt: "hello",
      responseSchema: SCHEMA,
      image: { data: "AAAA", mediaType: "image/jpeg" },
      token: "nxk_test",
      baseUrl: "http://mock.test",
    },
    { fetcher },
  );
  assert.equal(captured.url, "http://mock.test/chat");
  assert.equal(captured.auth, "Bearer nxk_test");
  assert.deepEqual(captured.body, {
    prompt: "hello",
    response_schema: SCHEMA,
    images: [{ data: "AAAA", media_type: "image/jpeg" }],
  });
});

test("throws ClaudeAgentError with `schema_not_satisfied` on 502", async () => {
  const fetcher = async () =>
    jsonResponse(
      { error: { code: "schema_not_satisfied", message: "agent did not call tool" } },
      502,
    );
  await assert.rejects(
    () =>
      callClaudeAgent(
        { prompt: "x", responseSchema: SCHEMA, token: "t", baseUrl: "http://x" },
        { fetcher },
      ),
    (err: unknown) => {
      assert.ok(err instanceof ClaudeAgentError);
      assert.equal(err.code, "schema_not_satisfied");
      assert.equal(err.status, 502);
      return true;
    },
  );
});

test("throws ClaudeAgentError with `rate_limited` on 429", async () => {
  const fetcher = async () =>
    new Response(
      JSON.stringify({ error: { code: "rate_limited", message: "cap reached" } }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": "12345" } },
    );
  await assert.rejects(
    () =>
      callClaudeAgent(
        { prompt: "x", responseSchema: SCHEMA, token: "t", baseUrl: "http://x" },
        { fetcher },
      ),
    (err: unknown) => {
      assert.ok(err instanceof ClaudeAgentError);
      assert.equal(err.code, "rate_limited");
      assert.equal(err.retryAfter, 12345);
      return true;
    },
  );
});

test("throws ClaudeAgentError with `bad_response` when structured is missing", async () => {
  const fetcher = async () =>
    jsonResponse({ session_id: "x", response: "no schema used", cost_usd: 0, turn_count: 1 });
  await assert.rejects(
    () =>
      callClaudeAgent(
        { prompt: "x", responseSchema: SCHEMA, token: "t", baseUrl: "http://x" },
        { fetcher },
      ),
    (err: unknown) => {
      assert.ok(err instanceof ClaudeAgentError);
      assert.equal(err.code, "bad_response");
      return true;
    },
  );
});
