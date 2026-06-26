import { notFound } from "next/navigation";
import { DEMO_DISHES } from "@/lib/demo/dishes";
import { DemoLibrary } from "../../_experiences/demo-library";

export default function DemoDishesPage() {
  if (DEMO_DISHES.length === 0) notFound();
  return <DemoLibrary />;
}
