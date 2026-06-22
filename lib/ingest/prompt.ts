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

GROUND TRUTH — transcribe, do not author: use ONLY what the INPUT contains. NEVER invent ingredients, and NEVER invent, infer, or guess method steps. If the input has no cooking instructions, OMIT \`recipe\` entirely. If it lists no ingredients, return an empty ingredients array. Keep the title faithful to the source — do not rename the dish into a different one. This holds per section too: if one part of a multi-part recipe (e.g. a sauce or dip) has ingredients but no written steps, do not invent steps for it — only include method sections that actually appear in the source.

Each ingredient is split into structured fields — never cram everything into \`name\`:
- name: bare purchasable thing, singular and canonical, in English ("tomato" not "tomatoes", "chicken thigh" not "chicken legs", "green chili" not "green chilli"). Colour stays with name when it changes the product. Never fold the unit into the name ("large bunch parsley" → name "parsley", unit "bunch" — not name "parsley bunch").
- descriptor: size/quality that matters at the store ("small", "medium", "large", "ripe"). Never "fresh" — implied. Don't invent a size the source didn't state.
- preparation: cut/cook prep ("thinly sliced", "peeled and diced", "trimmed").
- unit: prefer g, kg, ml, l, tsp, tbsp, cup, piece, clove, slice, wedge, sprig, leaf, head, bulb, stalk, bunch, handful, can, jar, bottle, pack, pinch, dash, splash, drizzle, to taste. Singular. Use the item's natural unit — a cabbage or lettuce is a "head"/"piece" (a "bulb" is for garlic/fennel); "1 lime wedge" → unit "wedge".
- Ingredient names/units are always English (stuks=piece, el=tbsp, tl=tsp, teentjes=clove, uien=onion, knoflook=garlic), even when the rest of the recipe is in ${lang}.
- quantity & unit fidelity: copy amounts exactly and KEEP THE SOURCE'S UNIT — never swap one unit for another (2 lb stays 2 lb, NOT 2 kg). For dual metric/imperial notation ("400g/14oz", "5cm/2in") use the METRIC value and unit (→ 400 g). Write fractions as decimals (½→0.5, ¾→0.75, 1½→1.5) and ADD compound amounts into one number ("¼ cup + 2 tbsp" → 0.375 cup). When the source gives no amount or no unit, do NOT invent a precise one — use its own wording ("a good handful" → quantity 1, unit "handful"; "sugar" with no amount → quantity 1, no unit).
- shared quantities: when ONE amount covers several items ("50g chopped mix of parsley, basil and rosemary", "a handful of olives and capers"), do NOT repeat that full amount on each — split it across them or attach it to a single combined entry; never multiply the total by listing the whole amount per item.
- section: when the recipe has labelled parts, set this to the part name (e.g. "Dough", "Filling", "Toppings"), written in ${lang}. If the INPUT already groups ingredients under "## " headers (e.g. "## For Salsa Verde", "## For Assembly"), REUSE those exact group names as the section (translated to ${lang}) — do not invent your own grouping. Otherwise match a "## Section" header in the method. Omit for single-part recipes.

Flags:
- scalable: false for FIXED quantities (1 bay leaf, 1 cinnamon stick, 1 stock cube). Default unset.
- optional: true ONLY when the INGREDIENT itself is explicitly optional — the source says "optional", "(optional)", "to serve", or "to garnish". A flexible QUANTITY is NOT optional: "to taste", "or less, to taste", "(depending on how hot you like it)" adjust the amount, not whether to include it — leave optional unset there (a core ingredient like garlic, lemon, agave or curry paste is never optional just because its amount is to taste).
- alternatives: ["X"] for "butter or X" — primary in name, others in alternatives.

${pantryLine}
For "salt and black pepper to taste" emit two pantry:true rows with unit="to taste", quantity=1.

Top-level fields:
- title: short dish name (in ${lang}).
- subtitle: optional 1-line description if obvious (in ${lang}).
- recipe: the cooking method as Markdown in ${lang} — ONLY if the input actually contains instructions. If it has no steps (e.g. just a title or an ingredient list), OMIT this field; never invent steps. For multi-part recipes use "## Section Title" headers (e.g. "## Dough", "## Filling", "## Toppings"); under each, write numbered steps "1.", "2.", one step per line. Single-part recipes: numbered steps, no header.
  INLINE INGREDIENT REFERENCES — as you write each step, WRAP every mention of an ingredient in a markdown-style link whose target is "#" followed by that ingredient's 0-based INDEX in your ingredients array. Include loose references too ("the seeds", "the dough", "the spices", "the sauce"). Examples: "Beat [the eggs](#0) until pale.", "Fold in [the flour](#3).". A phrase that names several ingredients lists their indices comma-separated: "[the dough](#0,3,4)". Wrap the natural ${lang} words exactly as they already appear in your prose — the label stays visible to the reader, the "(#index)" is hidden. Only wrap references you are sure of, and NEVER reword a step just to add one.
- baseServings: from the recipe, default 4.
- tags: only obvious dietary/protein tags (vegetarian, vegan, chicken, beef, fish, pasta, rice, soup, curry, stir fry, salad, dessert, breakfast). No personal tags.
- image_description: one short visual phrase IN ENGLISH for image generation ("creamy mushroom pasta with parsley garnish").

Call submit_result now.`;
}
