export interface IngestPromptInput {
  /** Free-text from the textarea: prompt, recipe prose, or URL. May be null when only an image is attached. */
  userInput: string | null;
  /** Pantry default names, lowercased. */
  pantryList: string[];
  /** Human language name to translate all recipe text into. Defaults to English. */
  targetLanguage?: string;
}

export function buildIngestPrompt(input: IngestPromptInput): string {
  const inputBody =
    input.userInput && input.userInput.trim().length > 0
      ? input.userInput.trim()
      : "(see attached image)";

  const lang = (input.targetLanguage ?? "English").trim() || "English";

  const pantryLine = input.pantryList.length
    ? `Pantry items (mark \`pantry: true\` for exact or close semantic match like "cumin powder" → "cumin"): ${input.pantryList.join(", ")}.`
    : "";

  return `Parse this recipe and call submit_result. Do not respond with prose.

INPUT:
${inputBody}

LANGUAGE: Write ALL human-readable text — title, subtitle, recipe steps, "## Section" headers, descriptor, preparation — in ${lang}. Translate from the source language if needed. Two EXCEPTIONS stay canonical English: ingredient \`name\` (use the standard English vocabulary below) and \`image_description\`.

Each ingredient is split into structured fields — never cram everything into \`name\`:
- name: bare purchasable thing, singular and canonical, in English ("tomato" not "tomatoes", "chicken thigh" not "chicken legs", "green chili" not "green chilli"). Colour stays with name when it changes the product.
- descriptor: size/quality that matters at the store ("small", "medium", "large", "ripe"). Never "fresh" — implied.
- preparation: cut/cook prep ("thinly sliced", "peeled and diced", "trimmed").
- unit: prefer g, kg, ml, l, tsp, tbsp, cup, piece, clove, slice, sprig, leaf, head, bulb, stalk, bunch, handful, can, jar, bottle, pack, pinch, dash, splash, drizzle, to taste. Singular.
- Ingredient names/units are always English (stuks=piece, el=tbsp, tl=tsp, teentjes=clove, uien=onion, knoflook=garlic), even when the rest of the recipe is in ${lang}.
- section: when the recipe has labelled parts, set this to the part name matching a "## Section" header in the method (e.g. "Dough", "Filling", "Toppings"), written in ${lang} to match your headers. Omit for single-part recipes.

Flags:
- scalable: false for FIXED quantities (1 bay leaf, 1 cinnamon stick, 1 stock cube). Default unset.
- optional: true if the recipe says "optional", "to taste" (non-pantry), "to serve", "to garnish".
- alternatives: ["X"] for "butter or X" — primary in name, others in alternatives.

${pantryLine}
For "salt and black pepper to taste" emit two pantry:true rows with unit="to taste", quantity=1.

Top-level fields:
- title: short dish name (in ${lang}).
- subtitle: optional 1-line description if obvious (in ${lang}).
- recipe: the method, only if the input had instructions, as Markdown in ${lang}. For multi-part recipes use "## Section Title" headers (e.g. "## Dough", "## Filling", "## Toppings"); under each, write numbered steps "1.", "2.", one step per line. Single-part recipes: numbered steps, no header.
- methodRefs: for every place the method text refers to an ingredient — INCLUDING loose references like "the seeds", "the dough", "the spices", "the sauce" — add { "phrase": <exact substring copied from your recipe text>, "ingredients": [<0-based indices into the ingredients array>] }. Use the EXACT substring as it appears in the \`recipe\` method you just wrote (in ${lang}) — copy from your output, not from the source text. A phrase may map to several ingredients ("the dough" → flour, water, yeast). Only include references you are confident about.
- baseServings: from the recipe, default 4.
- tags: only obvious dietary/protein tags (vegetarian, vegan, chicken, beef, fish, pasta, rice, soup, curry, stir fry, salad, dessert, breakfast). No personal tags.
- image_description: one short visual phrase IN ENGLISH for image generation ("creamy mushroom pasta with parsley garnish").

Call submit_result now.`;
}
