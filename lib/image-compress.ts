const MAX_RAW_BYTES = 20 * 1024 * 1024; // 20MB pre-compression sanity cap
// Claude vision works fine on 1280px and processes 3-4x faster than 2048px.
// Smaller dimensions also cut upload time on mobile networks substantially.
// Tuned for the 60s Vercel Hobby function budget against /api/v1/chat
// (which takes ~30-47s for image ingest at 2048px per claude-agent's
// audit log).
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.78;
const SUPPORTED_INPUT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/gif",
]);

export interface CompressedImage {
  /** Base64 string (no `data:` prefix). */
  data: string;
  /** Always `image/jpeg` after compression. */
  mediaType: "image/jpeg";
}

export async function compressImage(file: File): Promise<CompressedImage> {
  if (file.size > MAX_RAW_BYTES) {
    throw new Error(
      `Image too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 20MB).`,
    );
  }
  if (!SUPPORTED_INPUT_TYPES.has(file.type)) {
    throw new Error(`Unsupported image type: ${file.type || "unknown"}.`);
  }

  // ImageBitmap respects EXIF orientation in modern browsers when given
  // `imageOrientation: "from-image"`. createImageBitmap is the only
  // documented portable path that handles HEIC/HEIF on iOS Safari.
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("Failed to encode JPEG.");

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const data = btoa(binary);

  return { data, mediaType: "image/jpeg" };
}
