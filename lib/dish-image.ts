import "server-only";
import { sql } from "./db";
import { isPremiumImageUser } from "./auth-helpers";
import { buildImagePrompt } from "./image-prompt";
import { getProvider } from "./image-provider";
import { uploadDishImage } from "./image-storage";
import { assertPublicHttpUrl } from "./ingest/scrape-url";

const SOURCE_IMAGE_UA =
  "Mozilla/5.0 (compatible; DinnerSpinnerBot/1.0; +https://dinner-spinner.van-willigenburg.nl)";
const MAX_SOURCE_IMAGE_BYTES = 15_000_000;

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

// Download an image from an external URL (e.g. a scraped recipe page's own
// photo) and store it as the dish image — instead of generating one. Same
// storage path as generation (sharp → WebP → Vercel Blob), so we never
// hotlink the source. User-scoped UPDATE so a stale/forged dish id can't
// write to another user's row. Throws on a non-public URL, a non-image
// response, or an over-size body; the caller decides whether to fall back to
// generation.
export async function storeImageFromUrl(
  dish: { id: number },
  userId: string,
  sourceUrl: string,
  opts: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<string> {
  const u = assertPublicHttpUrl(sourceUrl);
  const fetcher = opts.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  let res: Response;
  try {
    res = await fetcher(u.toString(), {
      headers: { "user-agent": SOURCE_IMAGE_UA, accept: "image/*" },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`source image fetch failed (${res.status})`);
  const ct = res.headers.get("content-type")?.toLowerCase() ?? "";
  if (ct && !ct.startsWith("image/")) {
    throw new Error(`source url is not an image (content-type: ${ct})`);
  }
  const declaredLen = Number(res.headers.get("content-length") ?? 0);
  if (declaredLen > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`source image too large (${declaredLen} bytes)`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("source image was empty");
  if (bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`source image too large (${bytes.byteLength} bytes)`);
  }
  const imageUrl = await uploadDishImage(dish.id, bytes, ct || "image/jpeg");
  await sql`
    UPDATE dishes SET image_url = ${imageUrl}, updated_at = now()
     WHERE id = ${dish.id} AND user_id = ${userId}
  `;
  return imageUrl;
}
