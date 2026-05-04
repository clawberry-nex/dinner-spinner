// Provider abstraction for AI image generation. The factory picks
// between a stub (throws a helpful "not configured" message) and the
// HTTP provider (POSTs to a configured URL with a bearer token).
//
// Adding a new provider — or tweaking the request shape of HttpProvider
// for a specific service — is the only place that needs to change when
// the actual generation URL is wired in.

export interface ImageProvider {
  generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }>;
}

const NOT_CONFIGURED =
  "image generation not configured: set IMAGE_GEN_URL and IMAGE_GEN_TOKEN in env";

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
      return { bytes: buf, mime: contentType };
    }
    // Shape B: server returns JSON with a { url } pointing to the image.
    if (contentType.includes("json")) {
      const json = (await res.json()) as { url?: string };
      if (!json.url) {
        throw new Error("image provider JSON missing { url } field");
      }
      const imgRes = await fetch(json.url);
      if (!imgRes.ok) {
        throw new Error(
          `image provider follow-up URL returned ${imgRes.status}`,
        );
      }
      const buf = new Uint8Array(await imgRes.arrayBuffer());
      const followMime =
        imgRes.headers.get("content-type") ?? "image/jpeg";
      return { bytes: buf, mime: followMime };
    }
    throw new Error(
      `image provider returned unexpected content-type: ${contentType}`,
    );
  }
}

export function getProvider(): ImageProvider {
  const url = process.env.IMAGE_GEN_URL;
  const token = process.env.IMAGE_GEN_TOKEN;
  if (!url || !token) return new StubProvider();
  return new HttpProvider(url, token);
}
