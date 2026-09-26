import { test } from "node:test";
import assert from "node:assert/strict";
import { postBackgroundAdvance } from "./background-request.ts";

const production = {
  VERCEL_ENV: "production",
  VERCEL_URL: "dinner-deployment.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "dinner.example.com",
  CRON_SECRET: "test-cron-secret",
};

function transport(status = 202) {
  const calls: Request[] = [];
  const warnings: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push(new Request(input, init));
    return new Response(null, { status });
  };
  return { calls, warnings, fetcher, warn: (message: string) => warnings.push(message) };
}

test("dish-image and import handoffs use the public production domain", async () => {
  for (const [path, body] of [
    ["/api/dishes/images/advance-bg", { jobId: "image-job", hops: 1 }],
    ["/api/import/advance-bg", { importId: "import-job", hops: 2 }],
  ] as const) {
    const t = transport();
    await postBackgroundAdvance(path, body, { env: production, ...t });
    assert.equal(t.calls.length, 1);
    const request = t.calls[0];
    assert.equal(request.url, `https://dinner.example.com${path}`);
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("authorization"), "Bearer test-cron-secret");
    assert.equal(request.headers.get("content-type"), "application/json");
    assert.equal(request.headers.get("x-vercel-protection-bypass"), null);
    assert.equal(request.redirect, "manual");
    assert.deepEqual(await request.json(), body);
    assert.deepEqual(t.warnings, []);
  }
});

test("preview handoffs stay on the preview and include the configured protection bypass", async () => {
  const t = transport();
  await postBackgroundAdvance("/api/import/advance-bg", { importId: "i", hops: 0 }, {
    env: {
      ...production,
      VERCEL_ENV: "preview",
      AUTH_URL: "https://dinner.example.com",
      VERCEL_AUTOMATION_BYPASS_SECRET: "test-bypass-secret",
    },
    ...t,
  });
  assert.equal(t.calls[0].url, "https://dinner-deployment.vercel.app/api/import/advance-bg");
  assert.equal(t.calls[0].headers.get("x-vercel-protection-bypass"), "test-bypass-secret");
  assert.equal(t.calls[0].headers.get("authorization"), "Bearer test-cron-secret");
  assert.deepEqual(t.warnings, []);
});

test("production can use the deployment URL with protection bypass when no production domain is provided", async () => {
  const t = transport();
  await postBackgroundAdvance("/api/import/advance-bg", { importId: "i", hops: 0 }, {
    env: {
      ...production,
      VERCEL_PROJECT_PRODUCTION_URL: undefined,
      VERCEL_AUTOMATION_BYPASS_SECRET: "test-bypass-secret",
    },
    ...t,
  });
  assert.equal(t.calls[0].url, "https://dinner-deployment.vercel.app/api/import/advance-bg");
  assert.equal(t.calls[0].headers.get("x-vercel-protection-bypass"), "test-bypass-secret");
});

test("local development uses AUTH_URL with trailing slashes removed", async () => {
  const t = transport();
  await postBackgroundAdvance("/api/import/advance-bg", { importId: "i", hops: 0 }, {
    env: { AUTH_URL: "http://localhost:3000///", CRON_SECRET: "test-cron-secret" },
    ...t,
  });
  assert.equal(t.calls[0].url, "http://localhost:3000/api/import/advance-bg");
});

test("missing configuration leaves background completion disabled", async () => {
  for (const env of [
    {},
    { ...production, CRON_SECRET: undefined },
    { CRON_SECRET: "test-cron-secret" },
    { VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "dinner.example.com", AUTH_URL: "https://dinner.example.com", CRON_SECRET: "test-cron-secret" },
  ]) {
    const t = transport();
    await postBackgroundAdvance("/api/import/advance-bg", { importId: "i", hops: 0 }, { env, ...t });
    assert.deepEqual(t.calls, []);
    assert.deepEqual(t.warnings, []);
  }
});

test("rejected, redirected, and unexpected responses produce a warning without leaking secrets", async () => {
  for (const status of [401, 500, 302, 200]) {
    const t = transport(status);
    await postBackgroundAdvance("/api/dishes/images/advance-bg", { jobId: "j", hops: 0 }, {
      env: { ...production, VERCEL_AUTOMATION_BYPASS_SECRET: "test-bypass-secret" },
      ...t,
    });
    assert.deepEqual(t.warnings, [
      `[background] /api/dishes/images/advance-bg handoff rejected (HTTP ${status})`,
    ]);
  }
});

test("transport failures are reported without exposing arbitrary error details", async () => {
  const t = transport();
  await postBackgroundAdvance("/api/import/advance-bg", { importId: "i", hops: 0 }, {
    env: production,
    warn: t.warn,
    fetcher: async () => { throw new Error("private request details"); },
  });
  assert.deepEqual(t.warnings, ["[background] /api/import/advance-bg handoff failed or timed out"]);
});
