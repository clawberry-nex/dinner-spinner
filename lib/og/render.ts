import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { ReactElement } from "react";
import { loadOgFonts } from "./fonts";

export const OG_SIZE = { width: 1200, height: 630 } as const;

// Compose a card with Satori (PNG) then re-encode to a small JPEG. WhatsApp
// silently drops WebP and oversized og:images; a 1200×630 JPEG q80 lands
// ~150–250 KB and renders as a full-width banner.
export async function renderCardJpeg(element: ReactElement): Promise<Response> {
  const fonts = await loadOgFonts();
  const png = new ImageResponse(element, { ...OG_SIZE, fonts });
  const pngBuf = Buffer.from(await png.arrayBuffer());
  const jpeg = await sharp(pngBuf).jpeg({ quality: 80 }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400",
    },
  });
}
