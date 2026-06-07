// Regenerate the PWA icon set from the brand mark (public/icons/logo-mark.svg).
// Run after the logo changes:  node scripts/generate-icons.mjs
//
// - icon-{192,512}.png        transparent mark ("any" purpose)
// - icon-maskable-{192,512}.png  mark on the warm-dark bg, inset into the
//                                maskable safe zone (~72%)
// - apple-touch-icon.png      180px, mark on a solid bg (iOS ignores alpha)
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "public/icons/logo-mark.svg";
const BG = { r: 0x15, g: 0x11, b: 0x0e, alpha: 1 }; // #15110E — warm espresso
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const svg = readFileSync(SRC);

// render the vector crisply, then fit to the target box
async function mark(px) {
  return sharp(svg, { density: 600 })
    .resize(px, px, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();
}

async function onBg(px, inset) {
  const inner = Math.round(px * inset);
  const m = await mark(inner);
  return sharp({ create: { width: px, height: px, channels: 4, background: BG } })
    .composite([{ input: m, gravity: "center" }])
    .png()
    .toBuffer();
}

for (const px of [192, 512]) {
  writeFileSync(`public/icons/icon-${px}.png`, await mark(px));
  writeFileSync(`public/icons/icon-maskable-${px}.png`, await onBg(px, 0.72));
}
writeFileSync("public/icons/apple-touch-icon.png", await onBg(180, 0.74));
console.log("✓ regenerated PWA icons from", SRC);
