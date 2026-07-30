import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DISH_IMAGE_MODEL } from "./image-model.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function runtimeTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return runtimeTypeScriptFiles(fullPath);
      if (
        !entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".tsx")
      ) {
        return [];
      }
      return entry.name.endsWith(".test.ts") ? [] : [fullPath];
    }),
  );
  return nested.flat();
}

test("all Dinner-generated images pin the explicit GPT Image 2 model", async () => {
  assert.equal(DISH_IMAGE_MODEL, "gpt-image-2");

  const files = (
    await Promise.all(
      ["app", "lib"].map((directory) =>
        runtimeTypeScriptFiles(path.join(projectRoot, directory)),
      ),
    )
  ).flat();
  const deprecatedModel =
    /["'](?:nano-banana(?:-pro|-2)?|flux(?:-schnell|-dev)?|gemini-[^"']*)["']/i;
  const offenders: string[] = [];
  for (const file of files) {
    if (deprecatedModel.test(await readFile(file, "utf8"))) {
      offenders.push(path.relative(projectRoot, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `deprecated image model id found in runtime source: ${offenders.join(", ")}`,
  );
});
