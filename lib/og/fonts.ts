import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type OgFont = { name: string; data: Buffer; weight: 500 | 700; style: "normal" };

// process.cwd() is the Next project root at runtime (per next/og docs).
const DIR = join(process.cwd(), "assets", "og-fonts");

let cache: OgFont[] | null = null;

// Read the bundled TTFs once per lambda. Buffers are accepted directly by
// ImageResponse's `fonts` option.
export async function loadOgFonts(): Promise<OgFont[]> {
  if (cache) return cache;
  const [spectral700, schibsted700, schibsted500] = await Promise.all([
    readFile(join(DIR, "Spectral-700.ttf")),
    readFile(join(DIR, "SchibstedGrotesk-700.ttf")),
    readFile(join(DIR, "SchibstedGrotesk-500.ttf")),
  ]);
  cache = [
    { name: "Spectral", data: spectral700, weight: 700, style: "normal" },
    { name: "Schibsted Grotesk", data: schibsted700, weight: 700, style: "normal" },
    { name: "Schibsted Grotesk", data: schibsted500, weight: 500, style: "normal" },
  ];
  return cache;
}
