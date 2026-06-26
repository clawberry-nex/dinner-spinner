import { notFound } from "next/navigation";
import { DEMO_DISHES } from "@/lib/demo/dishes";
import { PlanExperience } from "../../_experiences/plan-experience";

export default function DemoPlanPage() {
  if (DEMO_DISHES.length === 0) notFound();
  return <PlanExperience />;
}
