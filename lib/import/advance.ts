import "server-only";
import { sql } from "@/lib/db";
import {
  startClaudeAgentJob,
  pollClaudeAgentJob,
  ClaudeAgentError,
  type PollResult,
} from "@/lib/ingest/claude-agent";
import { buildIngestPrompt } from "@/lib/ingest/prompt";
import { DISH_INPUT_JSON_SCHEMA } from "@/lib/ingest/schema";
import { DishInputSchema } from "@/lib/types";
import { getPantryDefaults } from "@/lib/pantry";
import { languageName } from "@/lib/languages";
import { createDishForUser } from "@/lib/dish-create";
import { submitImageBatch, pollBatch, type BatchRequest } from "@/lib/gemini-batch";
import { buildImagePrompt } from "@/lib/image-prompt";
import { uploadDishImage } from "@/lib/image-storage";
import { type ImportRow, type ImageBatch } from "./types";

const CLAUDE_AGENT_BASE_URL =
  process.env.CLAUDE_AGENT_URL ?? "https://nex.tail7f6b96.ts.net:10000";
const GOOGLE_IMAGE_MODEL = "gemini-3-pro-image-preview";

// Bounds that keep one advance step well under Vercel's 60s function budget and
// keep claude-agent / Gemini load polite. No hard recipe cap (by design) — these
// just slice the work across polls.
const PARSE_CONCURRENCY = 3; // parse jobs in flight at once
const IMAGE_BATCH_MAX = 200; // Gemini inline-batch ceiling (Blob/DB cost, not a Gemini limit)
const IMAGE_APPLY_SLICE = 12; // image uploads applied per step (~each ≤300ms)

function token(): string {
  // Routes guard NEX_API_TOKEN presence before calling advance; assert here.
  return process.env.NEX_API_TOKEN ?? "";
}

function dishIdFromKey(key: string): number | null {
  if (!key.startsWith("dish_")) return null;
  const n = Number(key.slice("dish_".length));
  return Number.isFinite(n) ? n : null;
}

/** Persist all mutable fields of an advancing row and release the lock. */
async function saveRow(row: ImportRow): Promise<ImportRow> {
  await sql`
    UPDATE import_jobs SET
      status        = ${row.status},
      detect_job_id = ${row.detect_job_id},
      chunks        = ${JSON.stringify(row.chunks)}::jsonb,
      image_batches = ${JSON.stringify(row.image_batches)}::jsonb,
      error         = ${row.error},
      locked_until  = NULL,
      updated_at    = now()
    WHERE id = ${row.id}
  `;
  return row;
}

/**
 * Advance a LOCKED import row exactly one bounded step, persist it, release the
 * lock, and return the updated row. The caller must already hold the row's lock
 * (locked_until). Each phase does a slice of work; the browser's next poll
 * continues from the persisted state, so the import survives navigation.
 */
export async function advanceImport(row: ImportRow): Promise<ImportRow> {
  switch (row.status) {
    case "detecting":
      return advanceDetecting(row);
    case "parsing":
      return advanceParsing(row);
    case "imaging":
      return advanceImaging(row);
    default:
      // detected (awaiting confirm), done, failed → nothing to do; just unlock.
      await sql`UPDATE import_jobs SET locked_until = NULL WHERE id = ${row.id}`;
      return row;
  }
}

// ---------- detecting ----------
async function advanceDetecting(row: ImportRow): Promise<ImportRow> {
  if (!row.detect_job_id) {
    row.status = "failed";
    row.error = "detect job missing";
    return saveRow(row);
  }
  let result: PollResult;
  try {
    result = await pollClaudeAgentJob(row.detect_job_id, {
      token: token(),
      baseUrl: CLAUDE_AGENT_BASE_URL,
    });
  } catch {
    return saveRow(row); // transient — retry on next poll
  }
  if (result.status !== "done") {
    if (result.status === "failed") {
      row.status = "failed";
      row.error = result.errorMessage || "detection failed";
    }
    // pending/running → retry on next poll; failed → terminal (set above)
    return saveRow(row);
  }
  // done — pull the recipe chunks out of the structured payload
  const structured = result.structured as { recipes?: unknown } | null;
  const list = Array.isArray(structured?.recipes) ? (structured!.recipes as unknown[]) : [];
  const chunks = list
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const title = typeof o.title === "string" ? o.title.trim() : "";
      const text = typeof o.text === "string" ? o.text.trim() : "";
      return { title, text };
    })
    .filter((r) => r.title || r.text)
    .map((r) => ({
      title: r.title || "Untitled recipe",
      text: r.text || r.title,
      status: "queued" as const,
      image: "pending" as const,
    }));
  if (chunks.length === 0) {
    row.status = "failed";
    row.error = "no recipes found in the document";
    return saveRow(row);
  }
  row.chunks = chunks;
  row.status = "detected";
  return saveRow(row);
}

// ---------- parsing (+ create) ----------
async function advanceParsing(row: ImportRow): Promise<ImportRow> {
  const tok = token();

  // 1) Poll in-flight parse jobs; create a dish for each that finished.
  for (const chunk of row.chunks) {
    if (chunk.status !== "parsing" || !chunk.parseJobId) continue;
    let res: PollResult;
    try {
      res = await pollClaudeAgentJob(chunk.parseJobId, {
        token: tok,
        baseUrl: CLAUDE_AGENT_BASE_URL,
      });
    } catch {
      continue; // transient — retry next poll
    }
    if (res.status !== "done") {
      if (res.status === "failed") {
        chunk.status = "failed";
        chunk.error = res.errorMessage || "parse failed";
      }
      continue; // pending/running → retry next poll
    }
    try {
      const dishId = await createDishFromStructured(res.structured, row.user_id);
      chunk.dishId = dishId;
      chunk.status = "created";
    } catch (err) {
      chunk.status = "failed";
      chunk.error = err instanceof Error ? err.message : "could not create dish";
    }
  }

  // 2) Start new parse jobs up to the concurrency cap.
  let inFlight = row.chunks.filter((c) => c.status === "parsing").length;
  if (inFlight < PARSE_CONCURRENCY && row.chunks.some((c) => c.status === "queued")) {
    const pantryList = Array.from(await getPantryDefaults(row.user_id)).sort();
    const targetLanguage = await targetLang(row.user_id);
    for (const chunk of row.chunks) {
      if (inFlight >= PARSE_CONCURRENCY) break;
      if (chunk.status !== "queued") continue;
      try {
        const prompt = buildIngestPrompt({
          userInput: chunk.text,
          pantryList,
          targetLanguage,
        });
        const job = await startClaudeAgentJob({
          prompt,
          responseSchema: DISH_INPUT_JSON_SCHEMA,
          token: tok,
          baseUrl: CLAUDE_AGENT_BASE_URL,
          model: "haiku",
        });
        chunk.parseJobId = job.jobId;
        chunk.status = "parsing";
        inFlight++;
      } catch (err) {
        if (
          err instanceof ClaudeAgentError &&
          (err.code === "queue_full" || err.code === "rate_limited")
        ) {
          break; // back off — leave queued, retry next poll
        }
        chunk.status = "failed";
        chunk.error = err instanceof Error ? err.message : "could not start parse";
      }
    }
  }

  // 3) Transition once every chunk is settled.
  if (row.chunks.every((c) => c.status === "created" || c.status === "failed")) {
    row.status = row.chunks.some((c) => c.status === "created") ? "imaging" : "done";
  }
  return saveRow(row);
}

async function createDishFromStructured(structured: unknown, userId: string): Promise<number> {
  // Same methodRefs resilience as the single-ingest poll route.
  const raw = structured as Record<string, unknown> | null;
  if (raw && typeof raw === "object") {
    if (typeof raw.methodRefs === "string") {
      try {
        raw.methodRefs = JSON.parse(raw.methodRefs);
      } catch {
        delete raw.methodRefs;
      }
    }
    if (raw.methodRefs != null && !Array.isArray(raw.methodRefs)) delete raw.methodRefs;
  }
  const validated = DishInputSchema.safeParse(structured);
  if (!validated.success) throw new Error("parsed dish failed validation");
  // autoImage:false — the batch importer generates images via the Gemini batch.
  const dish = await createDishForUser(validated.data, userId, { autoImage: false });
  return dish.id;
}

async function targetLang(userId: string): Promise<string> {
  const rows = await sql`SELECT default_language FROM users WHERE id = ${userId}`;
  return languageName((rows[0]?.default_language as string | null) ?? null);
}

// ---------- imaging ----------
async function advanceImaging(row: ImportRow): Promise<ImportRow> {
  const apiKey = process.env.GEMINI_API_KEY;
  const pending = row.chunks.filter(
    (c) => c.status === "created" && (c.image ?? "pending") === "pending" && c.dishId != null,
  );
  if (pending.length === 0) {
    row.status = "done";
    return saveRow(row);
  }

  // No image provider configured → finish imageless (each dish is regenerable
  // later via its image button). This is also the local-dev path (no key).
  if (!apiKey) {
    for (const c of pending) c.image = "failed";
    row.status = "done";
    return saveRow(row);
  }

  // First imaging step: submit the Gemini batch(es) for all pending dishes.
  if (row.image_batches.length === 0) {
    const ids = pending.map((c) => c.dishId as number);
    const dishRows = await sql`
      SELECT id, title, subtitle, image_description
        FROM dishes WHERE id = ANY(${ids}::int[]) AND user_id = ${row.user_id}
    `;
    const byId = new Map(dishRows.map((d) => [d.id as number, d]));
    const batches: ImageBatch[] = [];
    for (let i = 0; i < ids.length; i += IMAGE_BATCH_MAX) {
      const slice = ids.slice(i, i + IMAGE_BATCH_MAX);
      const requests: BatchRequest[] = slice
        .filter((id) => byId.has(id))
        .map((id) => {
          const d = byId.get(id)!;
          return {
            key: `dish_${id}`,
            prompt: buildImagePrompt({
              title: d.title as string,
              subtitle: (d.subtitle as string | null) ?? null,
              imageDescription: (d.image_description as string | null) ?? null,
            }),
          };
        });
      if (requests.length === 0) continue;
      try {
        const sub = await submitImageBatch(
          apiKey,
          GOOGLE_IMAGE_MODEL,
          `ds-import-${row.id.slice(0, 8)}-${i}`,
          requests,
        );
        batches.push({ name: sub.name, state: sub.state, applied: false });
      } catch {
        // Couldn't submit this slice → those dishes land imageless.
        for (const id of slice) {
          const c = row.chunks.find((x) => x.dishId === id);
          if (c) c.image = "failed";
        }
      }
    }
    row.image_batches = batches;
    if (batches.length === 0) {
      // every submit failed → nothing left to image
      if (!row.chunks.some((c) => c.status === "created" && (c.image ?? "pending") === "pending")) {
        row.status = "done";
      }
    }
    return saveRow(row);
  }

  // Subsequent steps: poll unapplied batches; apply succeeded results in a slice.
  let applied = 0;
  for (const batch of row.image_batches) {
    if (batch.applied) continue;
    if (applied >= IMAGE_APPLY_SLICE) break;
    let polled;
    try {
      polled = await pollBatch(apiKey, batch.name);
    } catch {
      continue; // transient — retry next poll
    }
    batch.state = polled.state;
    if (polled.state !== "BATCH_STATE_SUCCEEDED" || !polled.results) continue;

    for (const r of polled.results) {
      if (applied >= IMAGE_APPLY_SLICE) break; // resume on the next poll
      const dishId = dishIdFromKey(r.key);
      if (dishId == null) continue;
      const chunk = row.chunks.find((c) => c.dishId === dishId);
      if (!chunk || (chunk.image ?? "pending") !== "pending") continue; // already settled
      if (r.error || !r.bytes || !r.mime) {
        chunk.image = "failed";
        continue;
      }
      try {
        const imageUrl = await uploadDishImage(dishId, r.bytes, r.mime);
        await sql`
          UPDATE dishes SET image_url = ${imageUrl}, updated_at = now()
           WHERE id = ${dishId} AND user_id = ${row.user_id}
        `;
        chunk.image = "done";
      } catch {
        chunk.image = "failed";
      }
      applied++;
    }

    // Mark the batch applied once none of its result-dishes are still pending.
    const stillPending = polled.results.some((r) => {
      const id = dishIdFromKey(r.key);
      if (id == null) return false;
      const c = row.chunks.find((x) => x.dishId === id);
      return c && (c.image ?? "pending") === "pending";
    });
    if (!stillPending) batch.applied = true;
  }

  if (
    row.image_batches.every((b) => b.applied) ||
    !row.chunks.some((c) => c.status === "created" && (c.image ?? "pending") === "pending")
  ) {
    row.status = "done";
  }
  return saveRow(row);
}
