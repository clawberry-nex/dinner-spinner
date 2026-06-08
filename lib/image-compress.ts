const MAX_RAW_BYTES = 20 * 1024 * 1024; // 20MB pre-compression sanity cap

// Claude Opus 4.x reads images up to a 2576px long edge (~3.75MP) — its
// high-resolution vision ceiling. Photo ingests run on Opus (see
// app/api/ingest/route.ts), so we send at that resolution: small printed
// quantities (½, 0.5, 175g) survive instead of smearing at the old 1280px.
// Pre-4.7 models (Haiku/Sonnet) cap at ~1568px — if ingest ever moves back to
// one of those, lower this to 1568 to avoid wasted upload. Ingest is async, so
// the larger image no longer has to beat a 60s synchronous-call budget.
const MAX_DIMENSION = 2576;

// Encode at decreasing quality until the result fits the budget, so a dense
// photo can't blow past the /api/ingest body cap (4.5MB on Vercel Hobby; the
// route schema caps the base64 string at 4.5M chars). base64 inflates ~1.34×,
// so a 3MB JPEG is ~4MB of base64 — under the cap with headroom for the JSON
// envelope. A 2576px photo of printed text comfortably fits at high quality;
// the lower steps only engage for unusually busy images.
const QUALITY_STEPS = [0.92, 0.85, 0.78, 0.7];
const MAX_ENCODED_BYTES = 3_000_000;

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

// Draw the bitmap scaled to fit `maxDim` on its long edge and encode as JPEG at
// `quality`. Downscale-only — never upscales a small source.
function encodeJpeg(bitmap: ImageBitmap, maxDim: number, quality: number): Promise<Blob> {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxDim ? maxDim / longest : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context.");
  ctx.drawImage(bitmap, 0, 0, w, h);

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to encode JPEG."))),
      "image/jpeg",
      quality,
    ),
  );
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

  try {
    let blob: Blob | null = null;
    for (const quality of QUALITY_STEPS) {
      blob = await encodeJpeg(bitmap, MAX_DIMENSION, quality);
      if (blob.size <= MAX_ENCODED_BYTES) break;
    }
    // Still over budget even at the lowest quality (an unusually dense photo):
    // halve the dimension so we never exceed the request body cap.
    if (blob && blob.size > MAX_ENCODED_BYTES) {
      blob = await encodeJpeg(bitmap, Math.round(MAX_DIMENSION / 2), 0.8);
    }
    if (!blob) throw new Error("Failed to encode JPEG.");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return { data: btoa(binary), mediaType: "image/jpeg" };
  } finally {
    bitmap.close();
  }
}
