import { put } from "@vercel/blob";

// Drops the bytes into the project's Vercel Blob store and returns the
// permanent CDN URL. Keep this narrow — route handlers should not
// import @vercel/blob directly so the dependency stays swappable.
//
// Path scheme:  dishes/{dishId}/{nanoid}.{ext}
// The nanoid suffix means re-rolling a dish gives the user a fresh
// URL — no CDN cache surprises.

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    default:
      return "img";
  }
}

function nanoid(): string {
  // 12 url-safe chars, plenty for collision avoidance at this scale.
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Buffer.from(bytes).toString("base64url");
}

export async function uploadDishImage(
  dishId: number,
  bytes: Uint8Array,
  mime: string,
): Promise<string> {
  const ext = extFromMime(mime);
  const path = `dishes/${dishId}/${nanoid()}.${ext}`;
  const result = await put(path, Buffer.from(bytes), {
    access: "public",
    contentType: mime,
    addRandomSuffix: false,
  });
  return result.url;
}
