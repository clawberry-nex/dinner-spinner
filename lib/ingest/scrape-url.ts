// Server-side recipe-URL scraping.
//
// Why this exists: when the user pastes a recipe URL, we used to hand the raw
// URL to claude-agent and let Haiku fetch it with WebFetch. Heavy pages (a
// 1.1 MB Shopify food blog) blew the agent's 8-turn budget before it could
// call submit_result ("Reached maximum number of turns (8)"). Instead we fetch
// the page here, extract clean recipe text (schema.org Recipe JSON-LD when
// present, a stripped-text fallback otherwise) plus the page's own recipe
// image, and feed the agent pristine text — a 1-2 turn job. The image lets the
// import use the source photo instead of generating one.
//
// Deliberately dependency-free (no cheerio/jsdom) and free of `server-only`
// so it stays unit-testable: only `fetch` + string parsing.

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 4_000_000;
const UA =
  "Mozilla/5.0 (compatible; DinnerSpinnerBot/1.0; +https://dinner-spinner.van-willigenburg.nl)";

export interface ScrapeResult {
  title: string | null;
  /** Clean recipe text for the agent to structure. */
  text: string;
  /** The page's own recipe image, absolute URL, or null. */
  imageUrl: string | null;
}

/**
 * True only when the input is a single bare http(s) URL — that's when we
 * scrape server-side. Prose, "check out <url>", or schemeless hosts fall
 * through to the normal text-ingest path.
 */
export function isRecipeUrl(input: string): boolean {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;
  return /^https?:\/\/\S+$/i.test(s);
}

/**
 * Validate a URL is safe to fetch server-side: http/https only, and not a
 * loopback / private / link-local / metadata host. Pragmatic SSRF guard for
 * an auth-gated personal app — it blocks IP-literal and obvious-name private
 * targets but does not resolve DNS (no rebind protection). Throws on reject.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`invalid url: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`unsupported url scheme (${u.protocol}) for ${raw}`);
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    isPrivateIp(host)
  ) {
    throw new Error(`refusing to fetch private url host: ${host}`);
  }
  return u;
}

function isPrivateIp(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  }
  if (host === "::1") return true;
  if (/^f[cd]/i.test(host)) return true; // fc00::/7 unique-local
  if (/^fe80/i.test(host)) return true; // link-local
  return false;
}

/** Fetch + extract. Guard runs BEFORE any network call. */
export async function scrapeRecipeUrl(
  url: string,
  opts: { fetcher?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {},
): Promise<ScrapeResult> {
  const u = assertPublicHttpUrl(url);
  const fetcher = opts.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetcher(u.toString(), {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`fetch failed (${res.status}) for ${u.hostname}`);
  }
  const html = (await res.text()).slice(0, opts.maxBytes ?? DEFAULT_MAX_BYTES);
  return extractRecipe(html, u.toString());
}

/** Pure extraction: JSON-LD Recipe → clean text + image; else stripped text. */
export function extractRecipe(html: string, pageUrl: string): ScrapeResult {
  const ogImage = firstMeta(html, ["og:image", "twitter:image"]);
  const recipe = findRecipeNode(html);
  if (recipe) {
    const name = strOrNull(recipe.name);
    return {
      title: name ? decodeEntities(name) : null,
      text: recipeNodeToText(recipe),
      imageUrl: absolutize(firstImage(recipe.image) ?? ogImage, pageUrl),
    };
  }
  return {
    title: null,
    text: htmlToText(html),
    imageUrl: absolutize(ogImage, pageUrl),
  };
}

// --- JSON-LD ---------------------------------------------------------------

type RecipeNode = Record<string, unknown>;

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1].trim()));
    } catch {
      // malformed block — skip
    }
  }
  return out;
}

function isRecipeType(t: unknown): boolean {
  return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
}

function findRecipeNode(html: string): RecipeNode | null {
  for (const block of jsonLdBlocks(html)) {
    const r = searchRecipe(block);
    if (r) return r;
  }
  return null;
}

function searchRecipe(node: unknown): RecipeNode | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = searchRecipe(n);
      if (r) return r;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (isRecipeType(obj["@type"])) return obj;
  if (Array.isArray(obj["@graph"])) return searchRecipe(obj["@graph"]);
  return null;
}

function recipeNodeToText(r: RecipeNode): string {
  const parts: string[] = [];
  const name = strOrNull(r.name);
  if (name) parts.push(decodeEntities(name));
  const desc = strOrNull(r.description);
  if (desc) parts.push(decodeEntities(stripTags(desc)));
  const yld = recipeYieldToText(r.recipeYield);
  if (yld) parts.push(`Serves: ${yld}`);
  const ings = ingredientLines(r.recipeIngredient);
  if (ings.length) {
    parts.push("Ingredients:\n" + ings.map((i) => `- ${i}`).join("\n"));
  }
  const steps = instructionLines(r.recipeInstructions);
  if (steps.length) {
    parts.push("Method:\n" + steps.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  }
  return parts.join("\n\n");
}

function recipeYieldToText(y: unknown): string | null {
  if (Array.isArray(y)) y = y[0];
  if (typeof y === "number") return String(y);
  if (typeof y === "string") return y.trim() || null;
  return null;
}

function ingredientLines(x: unknown): string[] {
  const arr = Array.isArray(x) ? x : x != null ? [x] : [];
  return arr
    .map((v) =>
      typeof v === "string"
        ? v
        : strOrNull((v as Record<string, unknown>)?.name) ?? "",
    )
    .map((s) => decodeEntities(stripTags(s)).trim())
    .filter(Boolean);
}

function instructionLines(x: unknown): string[] {
  const out: string[] = [];
  const visit = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === "string") {
      const s = decodeEntities(stripTags(n)).trim();
      if (s) out.push(s);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n === "object") {
      const o = n as Record<string, unknown>;
      if (Array.isArray(o.itemListElement)) {
        visit(o.itemListElement); // HowToSection → flatten its steps
        return;
      }
      const txt = strOrNull(o.text) ?? strOrNull(o.name);
      if (txt) {
        const s = decodeEntities(stripTags(txt)).trim();
        if (s) out.push(s);
      }
    }
  };
  visit(x);
  return out;
}

function firstImage(x: unknown): string | null {
  if (x == null) return null;
  if (typeof x === "string") return x.trim() || null;
  if (Array.isArray(x)) {
    for (const v of x) {
      const u = firstImage(v);
      if (u) return u;
    }
    return null;
  }
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    return strOrNull(o.url) ?? strOrNull(o.contentUrl) ?? null;
  }
  return null;
}

// --- HTML helpers ----------------------------------------------------------

function firstMeta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${escapeRe(key)}["'][^>]*>`,
      "i",
    );
    const tag = html.match(re);
    if (tag) {
      const c = tag[0].match(/content=["']([^"']*)["']/i);
      if (c && c[1].trim()) return c[1].trim();
    }
  }
  return null;
}

function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = stripTags(s);
  s = decodeEntities(s);
  s = s
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.slice(0, 12_000);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

function absolutize(url: string | null, base: string): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url; // already absolute — return verbatim
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function strOrNull(x: unknown): string | null {
  return typeof x === "string" && x.trim() ? x.trim() : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(Number(n)));
}
