import "server-only";
import { advanceDishImageJob } from "./dish-image-job";

export const MAX_IMAGE_JOB_HOPS = 24;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function selfBaseUrl(): string | null {
  const authUrl = process.env.AUTH_URL;
  if (authUrl) return authUrl.replace(/\/+$/, "");
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;
  return null;
}

/**
 * Start or continue the protected background chain for one dish image. The
 * route acknowledges immediately and performs polling inside its own after().
 */
export async function kickDishImageAdvance(
  jobId: string,
  hops = 0,
): Promise<void> {
  const secret = process.env.CRON_SECRET;
  const base = selfBaseUrl();
  if (!secret || !base || hops > MAX_IMAGE_JOB_HOPS) return;
  try {
    await fetch(`${base}/api/dishes/images/advance-bg`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ jobId, hops }),
    });
  } catch {
    // Browser polling and the daily sweep remain recovery paths.
  }
}

/**
 * Poll and apply one durable image job within a Vercel invocation, then hand it
 * to a fresh invocation if GPT Image 2 is still working.
 */
export async function driveDishImageJob(
  jobId: string,
  hops = 0,
): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    let job;
    try {
      job = await advanceDishImageJob(jobId);
    } catch {
      await sleep(3000);
      continue;
    }
    if (!job || job.status === "done" || job.status === "failed") return;
    await sleep(3000);
  }
  if (hops < MAX_IMAGE_JOB_HOPS) {
    await kickDishImageAdvance(jobId, hops + 1);
  }
}
