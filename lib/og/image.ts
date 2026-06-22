import sharp from "sharp";

// Fetch an image (the dish/avatar WebP on Vercel Blob) and return it as a
// square JPEG data URL. Satori (next/og) cannot decode WebP and remote-image
// fetching is unreliable, so OG cards embed photos as JPEG data URLs.
// Returns null on any failure — the caller renders a photo-less card.
export async function fetchAsJpegDataUrl(
  url: string,
  opts: { fetcher?: typeof fetch; timeoutMs?: number; size?: number } = {},
): Promise<string | null> {
  const fetcher = opts.fetcher ?? fetch;
  const size = opts.size ?? 630;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetcher(url, { signal: controller.signal });
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    const jpeg = await sharp(input).resize(size, size, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
