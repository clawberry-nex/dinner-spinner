import { FallbackCard } from "@/app/_og/card";
import { renderCardJpeg } from "@/lib/og/render";

export const runtime = "nodejs";
export const alt = "Dinner Spinner";
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";

export default async function Image() {
  return renderCardJpeg(<FallbackCard />);
}
