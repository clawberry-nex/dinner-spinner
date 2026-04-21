import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextSetting,
  readThemeSetting,
  resolveEffective,
  writeThemeSetting,
  type ThemeSetting,
} from "./theme.ts";

function makeStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    _dump: () => ({ ...store }),
  };
}

test("readThemeSetting: no keys at all → system", () => {
  const s = makeStorage();
  assert.equal(readThemeSetting(s), "system");
  assert.deepEqual(s._dump(), {});
});

test("readThemeSetting: ds_theme=system → system", () => {
  const s = makeStorage({ ds_theme: "system" });
  assert.equal(readThemeSetting(s), "system");
});

test("readThemeSetting: ds_theme=light → light", () => {
  const s = makeStorage({ ds_theme: "light" });
  assert.equal(readThemeSetting(s), "light");
});

test("readThemeSetting: ds_theme=dark → dark", () => {
  const s = makeStorage({ ds_theme: "dark" });
  assert.equal(readThemeSetting(s), "dark");
});

test("readThemeSetting: garbage ds_theme value → system", () => {
  const s = makeStorage({ ds_theme: "bogus" });
  assert.equal(readThemeSetting(s), "system");
});

test("readThemeSetting: legacy ds_dark=1 migrates to dark and removes old key", () => {
  const s = makeStorage({ ds_dark: "1" });
  assert.equal(readThemeSetting(s), "dark");
  assert.deepEqual(s._dump(), { ds_theme: "dark" });
});

test("readThemeSetting: legacy ds_dark=0 migrates to light and removes old key", () => {
  const s = makeStorage({ ds_dark: "0" });
  assert.equal(readThemeSetting(s), "light");
  assert.deepEqual(s._dump(), { ds_theme: "light" });
});

test("readThemeSetting: ds_theme present wins over legacy ds_dark", () => {
  const s = makeStorage({ ds_theme: "system", ds_dark: "1" });
  assert.equal(readThemeSetting(s), "system");
  // Legacy key is still cleared even when ds_theme was already authoritative.
  assert.deepEqual(s._dump(), { ds_theme: "system" });
});

test("writeThemeSetting: system removes the stored key", () => {
  const s = makeStorage({ ds_theme: "dark" });
  writeThemeSetting(s, "system");
  assert.equal("ds_theme" in s._dump(), false);
});

test("writeThemeSetting: light persists as 'light'", () => {
  const s = makeStorage();
  writeThemeSetting(s, "light");
  assert.equal(s.getItem("ds_theme"), "light");
});

test("writeThemeSetting: dark persists as 'dark'", () => {
  const s = makeStorage();
  writeThemeSetting(s, "dark");
  assert.equal(s.getItem("ds_theme"), "dark");
});

test("resolveEffective: system + prefersDark → dark", () => {
  assert.equal(resolveEffective("system", true), "dark");
});

test("resolveEffective: system + !prefersDark → light", () => {
  assert.equal(resolveEffective("system", false), "light");
});

test("resolveEffective: explicit light ignores system preference", () => {
  assert.equal(resolveEffective("light", true), "light");
  assert.equal(resolveEffective("light", false), "light");
});

test("resolveEffective: explicit dark ignores system preference", () => {
  assert.equal(resolveEffective("dark", true), "dark");
  assert.equal(resolveEffective("dark", false), "dark");
});

test("nextSetting: cycles system → light → dark → system", () => {
  const order: ThemeSetting[] = ["system", "light", "dark", "system"];
  for (let i = 0; i < order.length - 1; i++) {
    assert.equal(nextSetting(order[i]), order[i + 1]);
  }
});
