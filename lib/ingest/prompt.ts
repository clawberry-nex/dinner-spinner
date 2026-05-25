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

  const pantryLine = input.pantryList.length
    ? `Pantry items (mark \`pantry: true\` for exact or close semantic match like "cumin powder" → "cumin"): ${input.pantryList.join(", ")}.`
    : "";

  return `Parse this recipe and call submit_result. Do not respond with prose.

INPUT:
${inputBody}

Each ingredient is split into structured fields — never cram everything into \`name\`:
- name: bare purchasable thing, singular and canonical ("tomato" not "tomatoes", "chicken thigh" not "chicken legs", "green chili" not "green chilli"). Colour stays with name when it changes the product.
- descriptor: size/quality that matters at the store ("small", "medium", "large", "ripe"). Never "fresh" — implied.
- preparation: cut/cook prep ("thinly sliced", "peeled and diced", "trimmed").
- unit: prefer g, kg, ml, l, tsp, tbsp, cup, piece, clove, slice, sprig, leaf, head, bulb, stalk, bunch, handful, can, jar, bottle, pack, pinch, dash, splash, drizzle, to taste. Singular.
- Translate Dutch → English (stuks=piece, el=tbsp, tl=tsp, teentjes=clove, uien=onion, knoflook=garlic).

Flags:
- scalable: false for FIXED quantities (1 bay leaf, 1 cinnamon stick, 1 stock cube). Default unset.
- optional: true if the recipe says "optional", "to taste" (non-pantry), "to serve", "to garnish".
- alternatives: ["X"] for "butter or X" — primary in name, others in alternatives.

${pantryLine}
For "salt and black pepper to taste" emit two pantry:true rows with unit="to taste", quantity=1.

Top-level fields:
- title: short dish name.
- subtitle: optional 1-line description if obvious.
- recipe: markdown instructions, only if input had them.
- baseServings: from the recipe, default 4.
- tags: only obvious dietary/protein tags (vegetarian, vegan, chicken, beef, fish, pasta, rice, soup, curry, stir fry, salad, dessert, breakfast). No personal tags.
- image_description: one short visual phrase for image generation ("creamy mushroom pasta with parsley garnish").

Call submit_result now.`;
}
