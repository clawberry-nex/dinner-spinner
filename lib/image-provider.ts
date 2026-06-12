// Image generation goes through the Nex API (claude-agent's /api/v1/images) —
// dinner-spinner no longer calls Gemini/Replicate directly. Nex owns the Gemini
// call, model aliasing, batching and cost; we keep prompt-building
// (lib/image-prompt) and Blob storage (lib/image-storage).
//
// Model mapping:
//   premium (seed owner + PREMIUM_IMAGE_EMAILS) → nano-banana-pro @ 2K (top quality)
//   everyone else                               → nano-banana-2  @ 1K (Pro-class at flash price)
//
// Resilience note: this is Gemini-only (no Replicate/flux fallback). Nex retries
// 503s internally; a hard Nex/Gemini outage now fails the generation rather than
// silently falling back. Accepted trade for centralising the key + cost on Nex.

import { generateImageViaNex } from "./nex-image.ts";

export interface ImageProvider {
  generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }>;
}

const NOT_CONFIGURED =
  "image generation not configured: set NEX_API_TOKEN (a token with the images:generate scope), and optionally CLAUDE_AGENT_URL";

const PREMIUM_MODEL = "nano-banana-pro";
const PREMIUM_SIZE = "2K";
const STANDARD_MODEL = "nano-banana-2";
const STANDARD_SIZE = "1K";

export class StubProvider implements ImageProvider {
  async generate(_prompt: string): Promise<{ bytes: Uint8Array; mime: string }> {
    throw new Error(NOT_CONFIGURED);
  }
}

// Generates via Nex /images. `model` and `size` are public so callers/tests can
// see which tier was selected.
export class NexProvider implements ImageProvider {
  constructor(
    private readonly token: string,
    public readonly model: string,
    public readonly size: string,
    private readonly baseUrl?: string,
  ) {}

  async generate(prompt: string): Promise<{ bytes: Uint8Array; mime: string }> {
    return generateImageViaNex({
      prompt,
      model: this.model,
      size: this.size,
      aspectRatio: "1:1",
      token: this.token,
      baseUrl: this.baseUrl,
    });
  }
}

// `premium` (default true) selects the higher-quality, pricier model. The seed
// owner generates premium; other users get the cheaper standard tier.
export function getProvider(opts: { premium?: boolean } = {}): ImageProvider {
  const { premium = true } = opts;
  const token = process.env.NEX_API_TOKEN;
  if (!token) return new StubProvider();
  const baseUrl = process.env.CLAUDE_AGENT_URL;
  return premium
    ? new NexProvider(token, PREMIUM_MODEL, PREMIUM_SIZE, baseUrl)
    : new NexProvider(token, STANDARD_MODEL, STANDARD_SIZE, baseUrl);
}
