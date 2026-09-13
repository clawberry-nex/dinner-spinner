// Live, read-only recipe evaluation. Does not create dishes or generate photos.
// NEX_API_TOKEN and API_TOKEN must belong to this app's production environment.
// npx tsx scripts/eval-recipe-ingest.ts [--photo path.jpg | --detect]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { buildIngestPrompt } from "../lib/ingest/prompt.ts";
import { DISH_INPUT_JSON_SCHEMA } from "../lib/ingest/schema.ts";
import { buildDetectPrompt, DETECT_JSON_SCHEMA } from "../lib/import/detect.ts";
import { RECIPE_MODELS, startNexAgentJob, pollNexAgentJob } from "../lib/ingest/nex-agent.ts";
import { normalizeEscapedWhitespace } from "../lib/ingest/sanitize.ts";
import { DishInputSchema } from "../lib/types.ts";
import { chiliFidelityErrors } from "../lib/ingest/fixtures/chili-expectations.ts";

async function main() {
  const token = process.env.NEX_API_TOKEN;
  const apiToken = process.env.API_TOKEN;
  if (!token || !apiToken) throw new Error("NEX_API_TOKEN and API_TOKEN required");
  const baseUrl = process.env.CLAUDE_AGENT_URL ?? "https://nex.tail7f6b96.ts.net:10000";
  const source = readFileSync("lib/ingest/fixtures/chili-con-carne.txt", "utf8");
  const photoIndex = process.argv.indexOf("--photo");
  const photo = photoIndex >= 0 ? process.argv[photoIndex + 1] : null;
  const detect = process.argv.includes("--detect");
  const mode = detect ? "detect" : photo ? "photo" : "text";
  const pantryResponse = await fetch("https://dinner-spinner.van-willigenburg.nl/api/pantry-defaults", {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  if (!pantryResponse.ok) throw new Error(`Pantry API: ${pantryResponse.status}`);
  const pantryList = await pantryResponse.json() as string[];
  const secondRecipe = "Boiled egg\n1 egg\n1. Boil the egg for 5 minutes.";
  const model = photo ? RECIPE_MODELS.photo : RECIPE_MODELS.text;
  const started = Date.now();
  const job = await startNexAgentJob({
    token, baseUrl, model,
    prompt: detect ? buildDetectPrompt(`${source}\n\n${secondRecipe}`)
      : buildIngestPrompt({ userInput: photo ? null : source, pantryList }),
    responseSchema: detect ? DETECT_JSON_SCHEMA : DISH_INPUT_JSON_SCHEMA,
    ...(photo ? { image: { data: readFileSync(photo).toString("base64"), mediaType: "image/jpeg" } } : {}),
  });
  console.log(JSON.stringify({ mode, model, jobId: job.jobId }));
  while (Date.now() - started < 180_000) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const result = await pollNexAgentJob(job.jobId, { token, baseUrl });
    if (result.status === "failed") throw new Error(`${result.errorCode}: ${result.errorMessage}`);
    if (result.status !== "done") continue;
    normalizeEscapedWhitespace(result.structured);
    mkdirSync("verify/openai-migration", { recursive: true });
    writeFileSync(`verify/openai-migration/${mode}-result.json`, JSON.stringify(result.structured, null, 2) + "\n");
    if (detect) {
      const output = result.structured as { recipes: { title: string; text: string }[] };
      assert.equal(output.recipes.length, 2);
      assert.equal(output.recipes[0].text.trim(), source.trim());
      assert.equal(output.recipes[1].text.trim(), secondRecipe);
    } else {
      const dish = DishInputSchema.parse(result.structured);
      assert.deepEqual(chiliFidelityErrors(dish), []);
    }
    console.log(JSON.stringify({ mode, model, elapsedSeconds: (Date.now() - started) / 1000, fidelity: "passed" }));
    return;
  }
  throw new Error("Ingest exceeded the browser's 180-second polling window");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
