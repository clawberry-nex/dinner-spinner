import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("manifest registers a GET share_target pointing at /add", () => {
  const raw = fs.readFileSync(new URL("../app/manifest.webmanifest", import.meta.url), "utf8");
  const m = JSON.parse(raw);
  assert.ok(m.share_target, "share_target missing");
  assert.equal(m.share_target.action, "/add");
  assert.equal(m.share_target.method, "GET");
  assert.deepEqual(m.share_target.params, { title: "title", text: "text", url: "url" });
});
