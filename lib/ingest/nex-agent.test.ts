import { test } from "node:test";
import assert from "node:assert/strict";
import {
  callNexAgent,
  RECIPE_MODELS,
  NexAgentError,
  startNexAgentJob,
  type RecipeModel,
} from "./nex-agent.ts";

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
  const out = await callNexAgent(
    {
      prompt: "p",
      responseSchema: SCHEMA,
      token: "nxk_test",
      baseUrl: "http://mock.test",
      model: RECIPE_MODELS.text,
    },
    { fetcher },
  );
  assert.deepEqual(out.structured, { title: "Pasta" });
});

test("sends the expected request body", async () => {
  const captured: { url?: string; body?: unknown; auth?: string | null } = {};
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
  await callNexAgent(
    {
      prompt: "hello",
      responseSchema: SCHEMA,
      image: { data: "AAAA", mediaType: "image/jpeg" },
      token: "nxk_test",
      baseUrl: "http://mock.test",
      model: RECIPE_MODELS.photo,
    },
    { fetcher },
  );
  assert.equal(captured.url, "http://mock.test/chat");
  assert.equal(captured.auth, "Bearer nxk_test");
  assert.deepEqual(captured.body, {
    prompt: "hello",
    response_schema: SCHEMA,
    images: [{ data: "AAAA", media_type: "image/jpeg" }],
    model: "codex:gpt-6-astra",
  });
});

test("async text jobs explicitly select GPT-5.6 Sol through Codex", async () => {
  let capturedBody: unknown;
  const fetcher: typeof fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return jsonResponse({
      job_id: "job-1",
      poll_url: "/api/v1/jobs/job-1",
      status: "pending",
    }, 202);
  };

  await startNexAgentJob(
    {
      prompt: "hello",
      responseSchema: SCHEMA,
      token: "nxk_test",
      baseUrl: "http://mock.test",
      model: RECIPE_MODELS.text,
    },
    { fetcher },
  );

  assert.deepEqual(capturedBody, {
    prompt: "hello",
    response_schema: SCHEMA,
    model: "codex:gpt-5.6-sol",
  });
});

test("throws NexAgentError with `schema_not_satisfied` on 502", async () => {
  const fetcher = async () =>
    jsonResponse(
      { error: { code: "schema_not_satisfied", message: "agent did not call tool" } },
      502,
    );
  await assert.rejects(
    () =>
      callNexAgent(
        { prompt: "x", responseSchema: SCHEMA, token: "t", baseUrl: "http://x", model: RECIPE_MODELS.text },
        { fetcher },
      ),
    (err: unknown) => {
      assert.ok(err instanceof NexAgentError);
      assert.equal(err.code, "schema_not_satisfied");
      assert.equal(err.status, 502);
      return true;
    },
  );
});

test("throws NexAgentError with `rate_limited` on 429", async () => {
  const fetcher = async () =>
    new Response(
      JSON.stringify({ error: { code: "rate_limited", message: "cap reached" } }),
      { status: 429, headers: { "content-type": "application/json", "retry-after": "12345" } },
    );
  await assert.rejects(
    () =>
      callNexAgent(
        { prompt: "x", responseSchema: SCHEMA, token: "t", baseUrl: "http://x", model: RECIPE_MODELS.text },
        { fetcher },
      ),
    (err: unknown) => {
      assert.ok(err instanceof NexAgentError);
      assert.equal(err.code, "rate_limited");
      assert.equal(err.retryAfter, 12345);
      return true;
    },
  );
});

test("throws NexAgentError with `bad_response` when structured is missing", async () => {
  const fetcher = async () =>
    jsonResponse({ session_id: "x", response: "no schema used", cost_usd: 0, turn_count: 1 });
  await assert.rejects(
    () =>
      callNexAgent(
        { prompt: "x", responseSchema: SCHEMA, token: "t", baseUrl: "http://x", model: RECIPE_MODELS.text },
        { fetcher },
      ),
    (err: unknown) => {
      assert.ok(err instanceof NexAgentError);
      assert.equal(err.code, "bad_response");
      return true;
    },
  );
});

test("async photo jobs carry the image and explicitly select GPT-6 Astra", async () => {
  let body: unknown;
  await startNexAgentJob({
    prompt: "read recipe", responseSchema: SCHEMA, token: "t", baseUrl: "http://x",
    model: RECIPE_MODELS.photo, image: { data: "AAAA", mediaType: "image/jpeg" },
  }, { fetcher: async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return jsonResponse({ job_id: "photo-job" }, 202);
  } });
  assert.deepEqual(body, {
    prompt: "read recipe", response_schema: SCHEMA, model: "codex:gpt-6-astra",
    images: [{ data: "AAAA", media_type: "image/jpeg" }],
  });
});

test("missing or non-OpenAI model selections fail before contacting Nex", async () => {
  for (const model of [undefined, "claude:haiku", "haiku", "default"]) {
    for (const call of [callNexAgent, startNexAgentJob]) {
      await assert.rejects(() => call({
        prompt: "x", responseSchema: SCHEMA, token: "t", baseUrl: "http://x",
        model: model as RecipeModel,
      }, { fetcher: async () => { assert.fail("must not send an unpinned job"); } }),
      (err: unknown) => err instanceof NexAgentError && err.code === "validation");
    }
  }
});
