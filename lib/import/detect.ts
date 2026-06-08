import { z } from "zod";
import { stripNullFromAnyOf } from "@/lib/ingest/schema";

// Detect schema: split raw text into N recipe chunks (title + verbatim text).
// Deliberately minimal so it stays within claude-agent's structured-output
// budget even for a large document, and anyOf-free (json-schema-to-zod can't
// handle anyOf) — kept that way via stripNullFromAnyOf, same as the dish schema.
const DetectSchema = z.object({
  recipes: z.array(
    z.object({
      title: z.string(),
      text: z.string(),
    }),
  ),
});

const { $schema: _drop, ...raw } = z.toJSONSchema(DetectSchema) as Record<string, unknown>;
export const DETECT_JSON_SCHEMA = stripNullFromAnyOf(raw) as Record<string, unknown>;

/** A recipe the detect job pulled out of the uploaded/pasted document. */
export interface DetectedRecipe {
  title: string;
  text: string;
}

/**
 * Prompt for the detect job. ALL input formats (txt/md/json/messy paste) are
 * fed as raw text — the model finds the recipe boundaries; we never parse the
 * input structurally. Each recipe's text is copied verbatim so the per-chunk
 * parse step (the existing single-ingest path) gets the original content.
 */
export function buildDetectPrompt(text: string): string {
  return `Split the following document into the individual recipes it contains, and call submit_result. Do not respond with prose.

The document may be plain text, markdown, JSON, a numbered list, or a messy paste — treat ALL of it as raw text. Find each distinct recipe. For each, return:
- title: the recipe's name (a short dish title).
- text: that recipe's FULL text, copied VERBATIM from the document — its ingredients and method/instructions if present. Do not summarize, translate, reformat, or invent. Include everything belonging to that one recipe and nothing from its neighbours.

Rules:
- One entry per recipe, in the document's original order.
- If the document is a single recipe, return exactly one entry.
- If it's just a list of dish names with no details, return one entry per name with \`text\` set to that name.
- Ignore non-recipe text (introductions, page numbers, section headers that aren't recipes).

DOCUMENT:
${text}

Call submit_result now.`;
}
