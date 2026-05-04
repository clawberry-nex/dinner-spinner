import type { Dish } from "./types.ts";

// House-style preamble — the strict visual rules every generated image
// must obey. Iterate this copy in git; the dish-specific tail just names
// what's on the plate.
//
// Keep it as one paragraph. Most image models weight the front of the
// prompt more heavily, so the framing/lighting/palette rules go first
// and the dish description trails.
export const IMAGE_STYLE_PREAMBLE = [
  "Photorealistic editorial food photography.",
  "Square 1:1 crop, top-down overhead angle.",
  "A single serving plated on a matte off-white ceramic plate, centered.",
  "The plate rests on a textured dark linen tablecloth in muted earth tones.",
  "Soft, diffused northern daylight from the upper-left,",
  "gentle natural shadows, no harsh highlights, no studio glare.",
  "One piece of brushed-steel cutlery beside the plate (fork or spoon as appropriate),",
  "and a small folded linen napkin in a muted earth tone partially under the plate.",
  "Restrained styling, sparse composition, no garnish-spam.",
  "No text, no logos, no watermarks, no human hands, no labels.",
  "Cookbook editorial restraint, color palette warm and earthy.",
].join(" ");

export function buildImagePrompt(
  dish: Pick<Dish, "title" | "subtitle">,
): string {
  const title = dish.title.trim();
  const subtitle = dish.subtitle?.trim();
  const description = subtitle ? `${title} — ${subtitle}` : title;
  return `${IMAGE_STYLE_PREAMBLE} The dish: ${description}.`;
}
