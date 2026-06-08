import "server-only";
import { sql } from "./db";
import { isPremiumImageUser } from "./auth-helpers";
import { buildImagePrompt } from "./image-prompt";
import { getProvider } from "./image-provider";
import { uploadDishImage } from "./image-storage";

// Generate a dish photo, store it in blob, and point the dish row at it.
// The single source for image generation — shared by the create-route's
// fire-and-forget auto-gen and the async regenerate job. User-scoped so a
// stale/forged dish id can't write to another user's row.
export async function generateAndStoreImage(
  dish: {
    id: number;
    title: string;
    subtitle: string | null;
    imageDescription: string | null;
  },
  userId: string,
): Promise<string> {
  const prompt = buildImagePrompt({
    title: dish.title,
    subtitle: dish.subtitle,
    imageDescription: dish.imageDescription,
  });
  // Premium (Nano Banana Pro) generation is for the seed owner + anyone in
  // PREMIUM_IMAGE_EMAILS — everyone else generates with the cheaper flux model.
  const premium = await isPremiumImageUser(userId);
  const { bytes, mime } = await getProvider({ premium }).generate(prompt);
  const imageUrl = await uploadDishImage(dish.id, bytes, mime);
  await sql`
    UPDATE dishes SET image_url = ${imageUrl}, updated_at = now()
     WHERE id = ${dish.id} AND user_id = ${userId}
  `;
  return imageUrl;
}
