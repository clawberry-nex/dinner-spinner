// Provider abstraction for AI image generation. getProvider() builds an ordered
// fallback chain from the configured env, wrapped in a FallbackProvider that
// tries each in turn (so a primary outage transparently uses the next):
//   Gemini direct → Replicate Nano Banana Pro → Replicate flux → HttpProvider.
// The first two are the SAME model (Gemini 3 Pro Image) on different capacity,
// so a direct-API rate-limit costs latency, not quality. With nothing
// configured it returns a StubProvider with a clear "not configured" error.

export interface ImageProvider {
  generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }>;
}

// Strip charset / quality / etc. parameters from a Content-Type header
// so we can pass a bare MIME (e.g. "image/jpeg") to Vercel Blob's put().
function stripMimeParams(value: string): string {
  return value.split(";")[0].trim();
}

const NOT_CONFIGURED =
  "image generation not configured: set GEMINI_API_KEY, or connect Replicate via Vercel (sets REPLICATE_API_TOKEN), or set IMAGE_GEN_URL and IMAGE_GEN_TOKEN";

// Fallbacks on Replicate — separate capacity from the direct Gemini API.
// nano-banana-pro is the SAME model as the direct call (Gemini 3 Pro Image), so
// it's the FIRST fallback: a direct-API outage costs latency, not quality.
// flux-1.1-pro is the fast last resort if even Replicate's Nano Banana Pro is
// down. To swap models, change these constants only.
const REPLICATE_NANO_BANANA_MODEL = "google/nano-banana-pro";
const REPLICATE_FLUX_MODEL = "black-forest-labs/flux-1.1-pro";

// Gemini's Nano Banana Pro (Gemini 3 Pro Image), called directly. Best quality
// and cheapest path; but it's a preview model, so capacity-constrained (503s
// under load) — which is exactly why the Replicate fallbacks above exist.
const GOOGLE_IMAGE_MODEL = "gemini-3-pro-image-preview";

export class StubProvider implements ImageProvider {
  async generate(_prompt: string): Promise<{ bytes: Uint8Array; mime: string }> {
    throw new Error(NOT_CONFIGURED);
  }
}

export class HttpProvider implements ImageProvider {
  private readonly url: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  async generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `image provider returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const contentType = res.headers.get("content-type") ?? "";
    // Shape A: server streams the image directly.
    if (contentType.startsWith("image/")) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return { bytes: buf, mime: stripMimeParams(contentType) };
    }
    // Shape B: server returns JSON with a { url } pointing to the image.
    if (contentType.includes("json")) {
      const json = (await res.json()) as { url?: string };
      if (!json.url) {
        throw new Error("image provider JSON missing { url } field");
      }
      // Pre-signed URLs (Replicate, fal.ai) are self-authenticating — no auth header needed.
      // If your provider requires auth on the follow-up URL, pass this.token here.
      const imgRes = await fetch(json.url);
      if (!imgRes.ok) {
        throw new Error(
          `image provider follow-up URL returned ${imgRes.status}`,
        );
      }
      const buf = new Uint8Array(await imgRes.arrayBuffer());
      const followMime = stripMimeParams(
        imgRes.headers.get("content-type") ?? "image/jpeg",
      );
      return { bytes: buf, mime: followMime };
    }
    throw new Error(
      `image provider returned unexpected content-type: ${contentType}`,
    );
  }
}

// Replicate-hosted model. POSTs a prediction with `Prefer: wait` so the
// response is sync — Replicate holds the connection until the model
// finishes (or up to ~60s). flux-schnell finishes in ~2s so this fits.
//
// Request:  { input: { prompt, aspect_ratio: "1:1", output_format: "webp" } }
// Response: { status: "succeeded", output: ["https://replicate.delivery/.../out-0.webp"] }
export class ReplicateProvider implements ImageProvider {
  private readonly token: string;
  private readonly model: string;
  private readonly inputDefaults: Record<string, unknown>;

  constructor(
    token: string,
    model: string = REPLICATE_FLUX_MODEL,
    // Static input fields merged with { prompt } per request. Differs per model
    // (e.g. Nano Banana Pro wants resolution + jpg; flux wants webp).
    inputDefaults: Record<string, unknown> = { aspect_ratio: "1:1", output_format: "webp" },
  ) {
    this.token = token;
    this.model = model;
    this.inputDefaults = inputDefaults;
  }

  async generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const url = `https://api.replicate.com/v1/models/${this.model}/predictions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        prefer: "wait",
      },
      body: JSON.stringify({ input: { prompt, ...this.inputDefaults } }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Replicate returned ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as {
      status?: string;
      output?: string | string[] | null;
      error?: string | null;
    };
    if (json.status !== "succeeded") {
      const detail = json.error ? ` (${json.error})` : "";
      throw new Error(
        `Replicate prediction status: ${json.status ?? "unknown"}${detail}`,
      );
    }
    const outputUrl = Array.isArray(json.output) ? json.output[0] : json.output;
    if (!outputUrl) {
      throw new Error("Replicate response missing output URL");
    }
    const imgRes = await fetch(outputUrl);
    if (!imgRes.ok) {
      throw new Error(
        `Replicate output URL returned ${imgRes.status}`,
      );
    }
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    const mime = stripMimeParams(
      imgRes.headers.get("content-type") ?? "image/webp",
    );
    return { bytes: buf, mime };
  }
}

// Gemini direct (Nano Banana Pro). One HTTP hop, returns the image as
// inline base64 in the response. Faster than Replicate's proxy and the
// images come back at higher quality (~2-3 MB jpeg vs Replicate's ~450 KB).
export class GoogleProvider implements ImageProvider {
  private readonly key: string;
  private readonly model: string;

  constructor(key: string, model: string = GOOGLE_IMAGE_MODEL) {
    this.key = key;
    this.model = model;
  }

  async generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": this.key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini returned ${res.status}: ${body.slice(0, 200)}`);
    }
    type InlineData = {
      mimeType?: string;
      mime_type?: string;
      data?: string;
    };
    type Part = { text?: string; inlineData?: InlineData; inline_data?: InlineData };
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Part[] } }>;
    };
    const parts: Part[] = json.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      const inline = p.inlineData ?? p.inline_data;
      if (inline?.data) {
        const mime = stripMimeParams(
          inline.mimeType ?? inline.mime_type ?? "image/jpeg",
        );
        return { bytes: new Uint8Array(Buffer.from(inline.data, "base64")), mime };
      }
    }
    // Surface any prose Gemini emitted instead of an image — usually a
    // safety refusal or a content-policy hit.
    const text = parts.map((p) => p.text).filter(Boolean).join(" ").slice(0, 300);
    throw new Error(`Gemini returned no image${text ? `: ${text}` : ""}`);
  }
}

// Tries each provider in order, falling through to the next on ANY error. This
// is what keeps image generation alive when the primary (Gemini) is rate-limited
// or returns 503 "experiencing high demand" — it transparently retries on
// Replicate. One attempt per provider per image, so it never floods.
export class FallbackProvider implements ImageProvider {
  private readonly providers: ImageProvider[];
  constructor(providers: ImageProvider[]) {
    this.providers = providers;
  }
  async generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }> {
    let lastErr: unknown = new Error(NOT_CONFIGURED);
    for (const p of this.providers) {
      try {
        return await p.generate(prompt);
      } catch (err) {
        lastErr = err;
        console.warn(
          `image provider ${p.constructor.name} failed, trying next:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(NOT_CONFIGURED);
  }
}

export function getProvider(): ImageProvider {
  // Preference order; FallbackProvider tries each until one succeeds:
  //   1. Gemini direct        — best quality, cheapest, fastest when up
  //   2. Replicate Nano Banana Pro — SAME model, separate capacity (keeps
  //                              quality through a direct-API rate-limit/503)
  //   3. Replicate flux-1.1-pro    — fast last resort
  //   4. generic HttpProvider      — if a custom endpoint is configured
  const providers: ImageProvider[] = [];
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) providers.push(new GoogleProvider(geminiKey));
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (replicateToken) {
    providers.push(
      new ReplicateProvider(replicateToken, REPLICATE_NANO_BANANA_MODEL, {
        aspect_ratio: "1:1",
        output_format: "jpg",
        resolution: "2K",
      }),
    );
    providers.push(
      new ReplicateProvider(replicateToken, REPLICATE_FLUX_MODEL, {
        aspect_ratio: "1:1",
        output_format: "webp",
      }),
    );
  }
  const url = process.env.IMAGE_GEN_URL;
  const token = process.env.IMAGE_GEN_TOKEN;
  if (url && token) providers.push(new HttpProvider(url, token));

  if (providers.length === 0) return new StubProvider();
  if (providers.length === 1) return providers[0];
  return new FallbackProvider(providers);
}
