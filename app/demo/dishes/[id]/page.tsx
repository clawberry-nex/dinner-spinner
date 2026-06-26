import { notFound } from "next/navigation";
import { DEMO_DISHES } from "@/lib/demo/dishes";
import DishView from "@/app/dishes/[id]/dish-view";

export default async function DemoDishPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const dish = DEMO_DISHES.find((d) => String(d.id) === id);
  if (!dish) notFound();
  return (
    <DishView
      dish={dish}
      history={[]}
      isOwner={false}
      ownerHandle={null}
      ownerName={null}
      hrefBase="/demo"
      planConfig={{ storageKey: "demoMealPlan" }}
    />
  );
}
