import { STANDARD_INGREDIENTS } from "../vocabulary.ts";

export interface IngestPromptInput {
  /** Free-text from the textarea: prompt, recipe prose, or URL. May be null when only an image is attached. */
  userInput: string | null;
  /** Pantry default names, lowercased. */
  pantryList: string[];
}

export function buildIngestPrompt(input: IngestPromptInput): string {
  const inputBody =
    input.userInput && input.userInput.trim().length > 0
      ? input.userInput.trim()
      : "(see attached image)";

  return `You parse cooking recipes into structured JSON for the Dinner Spinner app.

INPUT (recipe text, URL, free-text prompt, or an attached image — possibly several):
${inputBody}

If the input contains a URL, fetch it and read the recipe from the page.
If an image is attached, read the recipe text or ingredient list from it.

OUTPUT
Call the \`submit_result\` tool with a payload matching its schema.
DO NOT respond with prose. Use the tool.

RULES — ingredient parsing
- Split every ingredient into structured fields. Never cram everything into \`name\`.
- name = the bare purchasable thing, singular ("tomato", not "tomatoes"; "onion", not "onions").
- descriptor = size/quality affecting purchase ("small", "medium", "large", "ripe"). Never "fresh" — that's implied.
- preparation = cut/cook prep ("thinly sliced", "peeled and diced", "trimmed").
- Colour that changes the product stays in \`name\`: "green chili" ≠ "red chili"; "red pepper" ≠ "yellow pepper".
- Translate Dutch → English: "stuks" → "piece", "el" → "tbsp", "tl" → "tsp", "teentjes" → "clove", "uien" → "onion", "knoflook" → "garlic".

RULES — units (prefer one of these)
Weight: g, kg, oz, lb
Volume: ml, l, tsp, tbsp, cup, fl oz
Count: piece, clove, wedge, slice, sprig, leaf, head, bulb, stalk, bunch, handful, can, jar, bottle, pack
Imprecise: pinch, dash, splash, drizzle, to taste
Always singular ("clove", not "cloves").

RULES — standard ingredient names
Prefer these canonical names where applicable:
${STANDARD_INGREDIENTS.join(", ")}
If the recipe genuinely needs something not in this list (gochujang, tahini, sumac, nduja), use the literal name — don't force a bad mapping.

RULES — pantry flag
Set \`pantry: true\` for ingredients in this list (exact match or close semantic match like "cumin powder" → "cumin"):
${input.pantryList.join(", ")}
Use judgment for near-matches. Don't aggressively flag "smoked paprika" just because "paprika" might be in the list.
For "salt and black pepper to taste" → two ingredients, both \`pantry: true\`, \`unit: "to taste"\`, \`quantity: 1\`.

RULES — flags
- scalable: false for FIXED quantities regardless of servings (1 bay leaf, 1 cinnamon stick, 1 star anise, 1 stock cube). Default unset (= scalable).
- optional: true if the recipe says "optional", "to taste" (non-pantry), "to serve", "to garnish". Default unset (= required).
- alternatives: array of strings for "X or Y" — primary in \`name\`, alternatives listed. e.g. "butter or olive oil" → name: "butter", alternatives: ["olive oil"].

RULES — top-level dish fields
- title: short dish name.
- subtitle: 1-line description, only if the recipe context supports one. Skip if unclear.
- recipe: long-form cooking instructions in markdown, only if the input contained instructions. Skip if input was just an ingredient list or brief prompt.
- baseServings: number stated in the recipe. Default 4 if unstated.
- tags: infer obvious dietary/protein tags only — "vegetarian", "vegan", "chicken", "beef", "fish", "pasta", "rice", "soup", "curry", "stir fry", "salad", "dessert", "breakfast". Do NOT invent personal tags like "Finn likes this" or "weeknight".
- image_description: one short phrase describing the finished dish for image generation, e.g. "creamy mushroom pasta with parsley garnish on a creamware plate". Keep it visual and food-focused.

Now parse the input and call submit_result.`;
}
