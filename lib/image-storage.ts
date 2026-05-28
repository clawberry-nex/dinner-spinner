import { put } from "@vercel/blob";
import sharp from "sharp";

// Drops the bytes into the project's Vercel Blob store and returns the
// permanent CDN URL. Keep this narrow — route handlers should not
// import @vercel/blob directly so the dependency stays swappable.
//
// Path scheme:  dishes/{dishId}/{nanoid}.{ext}
// The nanoid suffix means re-rolling a dish gives the user a fresh
// URL — no CDN cache surprises.
//
// Compression: every image is downscaled to MAX_DIMENSION and re-encoded
// as WebP at quality WEBP_QUALITY before upload. Gemini Nano Banana Pro
// returns ~2.5 MB JPEGs at 2048×2048; the spinner thumbnail and dish-page
// hero never display larger than ~600px on the wire, so we lose nothing
// visible by capping at 1024 and gain a 10× size reduction.

const MAX_DIMENSION = 1024;
const WEBP_QUALITY = 80;

function nanoid(): string {
  // 12 url-safe chars, plenty for collision avoidance at this scale.
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Resize+reencode for storage. Provider-agnostic — feed it whatever the
 * image-gen API returned (Gemini JPEG, Flux WebP, etc.) and it produces
 * a uniformly small WebP. Falls back to the original bytes if sharp
 * throws (image-gen succeeded; don't lose the result over a re-encode
 * hiccup).
 */
async function compressForStorage(
  bytes: Uint8Array,
  sourceMime: string,
): Promise<{ bytes: Buffer; mime: string }> {
  try {
    const out = await sharp(Buffer.from(bytes))
      .rotate() // honor EXIF orientation (Gemini sometimes embeds it)
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
    return { bytes: out, mime: "image/webp" };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[uploadDishImage] sharp re-encode failed, storing original", err);
    return { bytes: Buffer.from(bytes), mime: sourceMime };
  }
}

export async function uploadDishImage(
  dishId: number,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const compressed = await compressForStorage(bytes, mime);
  const ext = compressed.mime === "image/webp" ? "webp" : "img";
  const path = `dishes/${dishId}/${nanoid()}.${ext}`;
  const result = await put(path, compressed.bytes, {
    access: "public",
    contentType: compressed.mime,
    addRandomSuffix: false,
  });
  return result.url;
}
