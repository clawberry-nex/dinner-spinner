import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  isRecipeUrl,
  findScrapeableUrl,
  extractRecipe,
  assertPublicHttpUrl,
  scrapeRecipeUrl,
} from "./scrape-url";

const fixture = fs.readFileSync(
  new URL("./fixtures/masienda-pastel.html", import.meta.url),
  "utf8",
);

// ---------------------------------------------------------------------------
// isRecipeUrl — only a bare single URL should trigger server-side scraping.
// ---------------------------------------------------------------------------

test("isRecipeUrl: true for a bare http/https URL (trimmed)", () => {
  assert.equal(isRecipeUrl("https://masienda.com/blogs/learn/pastel-azteca"), true);
  assert.equal(isRecipeUrl("http://example.com/r"), true);
  assert.equal(isRecipeUrl("  https://example.com/r?srsltid=abc  "), true);
});

test("isRecipeUrl: false for prose, partial, or multi-token input", () => {
  assert.equal(isRecipeUrl("a sticky miso aubergine for two"), false);
  assert.equal(isRecipeUrl("check out https://example.com/r it's great"), false);
  assert.equal(isRecipeUrl("www.example.com/r"), false); // no scheme
  assert.equal(isRecipeUrl("https://example.com/r\nplus a note"), false);
  assert.equal(isRecipeUrl(""), false);
  assert.equal(isRecipeUrl("ftp://example.com/r"), false);
});

// ---------------------------------------------------------------------------
// findScrapeableUrl — a URL that dominates the input (bare URL, or the Android
// share case of "title + url" / "title + snippet + url"), but NOT a full recipe
// that merely contains a source link.
// ---------------------------------------------------------------------------

test("findScrapeableUrl: bare URL", () => {
  assert.equal(
    findScrapeableUrl("https://masienda.com/blogs/learn/pastel-azteca?srsltid=x"),
    "https://masienda.com/blogs/learn/pastel-azteca?srsltid=x",
  );
});

test("findScrapeableUrl: Android share — title + url on separate lines", () => {
  const shared =
    "Pastel Azteca en Salsa Verde (Mexican Lasagna) – Masienda\nhttps://masienda.com/blogs/learn/pastel-azteca?srsltid=abc";
  assert.equal(
    findScrapeableUrl(shared),
    "https://masienda.com/blogs/learn/pastel-azteca?srsltid=abc",
  );
});

test("findScrapeableUrl: share with a title + short snippet + url", () => {
  const shared =
    "Best Tomato Soup\nA cozy weeknight soup from our kitchen.\nhttps://example.com/recipes/tomato-soup";
  assert.equal(findScrapeableUrl(shared), "https://example.com/recipes/tomato-soup");
});

test("findScrapeableUrl: strips trailing punctuation around an inline url", () => {
  assert.equal(
    findScrapeableUrl("try this one: https://example.com/r."),
    "https://example.com/r",
  );
});

test("findScrapeableUrl: null when a full recipe body merely contains a source url", () => {
  const pasted =
    "Grandma's Stew\n\nIngredients:\n" +
    Array.from({ length: 30 }, (_, i) => `- ingredient number ${i} with some prep notes`).join("\n") +
    "\n\nMethod:\nBrown the beef, add stock, simmer two hours, season well and serve hot.\n" +
    "Source: https://example.com/stew";
  assert.equal(findScrapeableUrl(pasted), null);
});

test("findScrapeableUrl: null for prose with no url, and for a private-host share", () => {
  assert.equal(findScrapeableUrl("a sticky miso aubergine for two"), null);
  assert.equal(findScrapeableUrl("My recipe\nhttp://127.0.0.1/secret"), null);
});

// ---------------------------------------------------------------------------
// extractRecipe — schema.org Recipe JSON-LD (the gold path).
// ---------------------------------------------------------------------------

test("extractRecipe: pulls title, ingredients, method, and image from JSON-LD", () => {
  const r = extractRecipe(fixture, "https://masienda.com/blogs/learn/pastel-azteca");
  assert.equal(r.title, "Pastel Azteca (Mexican Casserole)");
  // image: first JSON-LD image wins over og:image.
  assert.equal(r.imageUrl, "https://images.getrecipekit.com/pastel-16x9.jpg?aspect_ratio=16:9&quality=90&");
  // text carries the raw ingredient + step strings for the agent to structure.
  assert.match(r.text, /Ingredients:/);
  assert.match(r.text, /10 tomatillos, husked, rinsed, and chopped/);
  assert.match(r.text, /2 cloves garlic, peeled/);
  assert.match(r.text, /Method:/);
  assert.match(r.text, /Saute the onion and garlic until fragrant\./);
  assert.match(r.text, /Blend the salsa until smooth/);
  assert.match(r.text, /Serves: 6 servings/);
  // It must NOT drag in page noise.
  assert.doesNotMatch(r.text, /this is noise/);
  assert.doesNotMatch(r.text, /Cart empty/);
});

test("extractRecipe: handles string-array instructions and a string image", () => {
  const html = `<html><head></head><body>
    <script type="application/ld+json">${JSON.stringify({
      "@type": "Recipe",
      name: "Quick Eggs",
      image: "https://img.example.com/eggs.jpg",
      recipeIngredient: ["2 eggs", "butter"],
      recipeInstructions: ["Crack eggs.", "Fry in butter."],
    })}</script></body></html>`;
  const r = extractRecipe(html, "https://example.com/eggs");
  assert.equal(r.title, "Quick Eggs");
  assert.equal(r.imageUrl, "https://img.example.com/eggs.jpg");
  assert.match(r.text, /2 eggs/);
  assert.match(r.text, /Crack eggs\./);
  assert.match(r.text, /Fry in butter\./);
});

test("extractRecipe: handles HowToSection instructions and image object", () => {
  const html = `<html><body>
    <script type="application/ld+json">${JSON.stringify({
      "@graph": [{
        "@type": ["Thing", "Recipe"],
        name: "Layered Bake",
        image: { url: "https://img.example.com/bake.jpg" },
        recipeIngredient: ["dough", "filling"],
        recipeInstructions: [
          { "@type": "HowToSection", name: "Dough", itemListElement: [
            { "@type": "HowToStep", text: "Mix flour and water." },
          ]},
          { "@type": "HowToSection", name: "Assemble", itemListElement: [
            { "@type": "HowToStep", text: "Layer and bake." },
          ]},
        ],
      }],
    })}</script></body></html>`;
  const r = extractRecipe(html, "https://example.com/bake");
  assert.equal(r.title, "Layered Bake");
  assert.equal(r.imageUrl, "https://img.example.com/bake.jpg");
  assert.match(r.text, /Mix flour and water\./);
  assert.match(r.text, /Layer and bake\./);
});

test("extractRecipe: falls back to stripped page text + og:image when no Recipe JSON-LD", () => {
  const html = `<html><head>
      <meta property="og:image" content="https://img.example.com/hero.jpg" />
    </head><body>
      <script>var x = 1;</script>
      <nav>menu</nav>
      <article><h1>Grandma's Stew</h1><p>Brown the beef, then add stock and simmer for two hours.</p></article>
      <style>.x{color:red}</style>
    </body></html>`;
  const r = extractRecipe(html, "https://example.com/stew");
  assert.equal(r.imageUrl, "https://img.example.com/hero.jpg");
  assert.match(r.text, /Brown the beef/);
  assert.match(r.text, /simmer for two hours/);
  // script/style contents stripped
  assert.doesNotMatch(r.text, /var x = 1/);
  assert.doesNotMatch(r.text, /color:red/);
});

// ---------------------------------------------------------------------------
// assertPublicHttpUrl — SSRF guard.
// ---------------------------------------------------------------------------

test("assertPublicHttpUrl: accepts public http/https", () => {
  assert.equal(assertPublicHttpUrl("https://masienda.com/r").hostname, "masienda.com");
  assert.equal(assertPublicHttpUrl("http://example.com").protocol, "http:");
});

test("assertPublicHttpUrl: rejects non-http schemes, localhost, and private/metadata IPs", () => {
  for (const bad of [
    "ftp://example.com/r",
    "file:///etc/passwd",
    "not a url",
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://192.168.1.10/x",
    "http://10.0.0.5/x",
    "http://[::1]/x",
  ]) {
    assert.throws(() => assertPublicHttpUrl(bad), new RegExp("url"), `expected throw for ${bad}`);
  }
});

// ---------------------------------------------------------------------------
// scrapeRecipeUrl — composes guard + fetch + extract (injected fetcher).
// ---------------------------------------------------------------------------

test("scrapeRecipeUrl: fetches with a UA and extracts the recipe", async () => {
  let sawUA = false;
  const fetcher = (async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (headers.get("user-agent")) sawUA = true;
    return new Response(fixture, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;

  const r = await scrapeRecipeUrl("https://masienda.com/blogs/learn/pastel-azteca", { fetcher });
  assert.equal(r.title, "Pastel Azteca (Mexican Casserole)");
  assert.match(r.text, /10 tomatillos/);
  assert.equal(sawUA, true, "should send a User-Agent so sites don't 403 the bot");
});

test("scrapeRecipeUrl: rejects a private URL before fetching", async () => {
  let fetched = false;
  const fetcher = (async () => {
    fetched = true;
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  await assert.rejects(() => scrapeRecipeUrl("http://127.0.0.1/x", { fetcher }));
  assert.equal(fetched, false, "guard must run before any network call");
});
