// Provider abstraction for AI image generation. The factory picks the
// most specific provider it can configure from env, falling back to a
// stub that surfaces a clear "not configured" error.
//
// Precedence: REPLICATE_API_TOKEN → ReplicateProvider (Vercel marketplace
// integration auto-injects this), else IMAGE_GEN_URL + IMAGE_GEN_TOKEN
// → generic HttpProvider, else StubProvider.

export interface ImageProvider {
  generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }>;
}

// Strip charset / quality / etc. parameters from a Content-Type header
// so we can pass a bare MIME (e.g. "image/jpeg") to Vercel Blob's put().
function stripMimeParams(value: string): string {
  return value.split(";")[0].trim();
}

const NOT_CONFIGURED =
  "image generation not configured: connect Replicate via Vercel (sets REPLICATE_API_TOKEN), or set IMAGE_GEN_URL and IMAGE_GEN_TOKEN";

// Replicate's flux-1.1-pro — slower (~5–10s) and pricier ($0.04/image)
// than flux-schnell, but materially better at recognising specific
// regional dishes and following long descriptive prompts. To swap
// models, change this constant only — Replicate's hosted-model API
// surface is uniform across Flux variants. flux-schnell is a solid
// cheap fallback if generation cost ever becomes a concern.
const REPLICATE_MODEL = "black-forest-labs/flux-1.1-pro";

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

  constructor(token: string, model: string = REPLICATE_MODEL) {
    this.token = token;
    this.model = model;
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
      body: JSON.stringify({
        input: {
          prompt,
          aspect_ratio: "1:1",
          output_format: "webp",
        },
      }),
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

export function getProvider(): ImageProvider {
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  if (replicateToken) return new ReplicateProvider(replicateToken);
  const url = process.env.IMAGE_GEN_URL;
  const token = process.env.IMAGE_GEN_TOKEN;
  if (url && token) return new HttpProvider(url, token);
  return new StubProvider();
}
