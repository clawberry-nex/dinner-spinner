import { notFound } from "next/navigation";
import { DEMO_DISHES } from "@/lib/demo/dishes";
import { SpinnerExperience } from "../_experiences/spinner-experience";

// Dormant until the snapshot is generated: empty snapshot → 404.
export default function DemoSpinnerPage() {
  if (DEMO_DISHES.length === 0) notFound();
  return <SpinnerExperience />;
}
