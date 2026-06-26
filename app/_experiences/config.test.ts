import { test } from "node:test";
import assert from "node:assert/strict";
import { liveExperienceConfig, demoExperienceConfig } from "./config.ts";

test("live config is writable and same-origin", () => {
  assert.equal(liveExperienceConfig.readonly, false);
  assert.equal(liveExperienceConfig.hrefBase, "");
  assert.equal(liveExperienceConfig.planStorageKey, "mealPlan");
  assert.equal(liveExperienceConfig.spinnerFiltersKey, "spinnerFilters");
  assert.equal(typeof liveExperienceConfig.persistPlanRemote, "function");
});

test("demo config is read-only with isolated keys and NO server sync", () => {
  assert.equal(demoExperienceConfig.readonly, true);
  assert.equal(demoExperienceConfig.hrefBase, "/demo");
  assert.equal(demoExperienceConfig.planStorageKey, "demoMealPlan");
  assert.equal(demoExperienceConfig.spinnerFiltersKey, "demoSpinnerFilters");
  assert.equal(demoExperienceConfig.persistPlanRemote, undefined);
  assert.equal(demoExperienceConfig.loadPlanRemote, undefined);
});
