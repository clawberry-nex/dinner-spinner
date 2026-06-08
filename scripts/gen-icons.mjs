// Regenerate every app icon from two sources:
//   • app/icon.svg              — the simplified favicon glyph (legible at 16px)
//   • public/icons/logo-mark.svg — the detailed V2 spinner-wheel logo
//
//   npx tsx scripts/gen-icons.mjs      (or: node scripts/gen-icons.mjs)
//
// Outputs:
//   app/favicon.ico                            — 16/32/48, from app/icon.svg (simple)
//   public/icons/icon-{192,512}.png            — PWA "any": full wheel, transparent
//   public/icons/icon-maskable-{192,512}.png   — PWA "maskable": full wheel on --bg, padded
//   public/icons/apple-touch-icon.png          — 180px, full wheel on --bg
//
// The browser tab uses app/icon.svg (+ favicon.ico) → the simple glyph; the PWA
// manifest / iOS home screen use the public/icons PNGs → the detailed wheel.
// Re-run after editing either source.

import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAVICON_SVG = join(root, "app/icon.svg");
const WHEEL_SVG = join(root, "public/icons/logo-mark.svg");
const ICONS = join(root, "public/icons");

const BG = { r: 0x15, g: 0x11, b: 0x0e, alpha: 1 }; // --bg / theme_color (warm near-black)
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const rasterize = async (path) =>
  sharp(await readFile(path), { density: 192 })
    .resize(2048, 2048, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();

// --- PWA / home-screen icons: the detailed wheel ---
const wheel = await rasterize(WHEEL_SVG);
const plain = (size) =>
  sharp(wheel).resize(size, size, { fit: "contain", background: TRANSPARENT }).png().toBuffer();
// Wheel centered on an opaque background, scaled so the platform mask can't clip it.
const padded = async (size, scale, bg) => {
  const inner = Math.round(size * scale);
  const logo = await sharp(wheel)
    .resize(inner, inner, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();
};

await writeFile(join(ICONS, "icon-192.png"), await plain(192));
await writeFile(join(ICONS, "icon-512.png"), await plain(512));
await writeFile(join(ICONS, "icon-maskable-192.png"), await padded(192, 0.72, BG));
await writeFile(join(ICONS, "icon-maskable-512.png"), await padded(512, 0.72, BG));
await writeFile(join(ICONS, "apple-touch-icon.png"), await padded(180, 0.82, BG));

// --- favicon: the simple glyph (its own opaque tile) ---
const fav = await rasterize(FAVICON_SVG);
const favFrame = (size) =>
  sharp(fav).resize(size, size, { fit: "contain", background: TRANSPARENT }).png().toBuffer();

// Minimal ICO encoder embedding PNG frames (PNG-in-ICO, supported since Vista).
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(16 * frames.length);
  let offset = 6 + 16 * frames.length;
  frames.forEach((f, i) => {
    const e = dir.subarray(i * 16, i * 16 + 16);
    e.writeUInt8(f.size >= 256 ? 0 : f.size, 0); // width (0 means 256)
    e.writeUInt8(f.size >= 256 ? 0 : f.size, 1); // height
    e.writeUInt8(0, 2); // palette count
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(f.buf.length, 8); // bytes in resource
    e.writeUInt32LE(offset, 12); // offset
    offset += f.buf.length;
  });
  return Buffer.concat([header, dir, ...frames.map((f) => f.buf)]);
}

const icoFrames = await Promise.all([16, 32, 48].map(async (size) => ({ size, buf: await favFrame(size) })));
await writeFile(join(root, "app/favicon.ico"), buildIco(icoFrames));

console.log("icons regenerated — favicon from app/icon.svg, PWA from logo-mark.svg");
