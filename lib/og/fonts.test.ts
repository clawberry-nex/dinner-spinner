import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOgFonts } from "./fonts.ts";

test("loadOgFonts returns three non-empty fonts", async () => {
  const fonts = await loadOgFonts();
  assert.equal(fonts.length, 3);
  for (const f of fonts) {
    assert.ok(f.name.length > 0);
    assert.ok(f.data.length > 1000);
  }
});
