"use client";

import { useRouter } from "next/navigation";
import type { Dish } from "@/lib/types";
import DishForm from "@/app/_components/dish-form";
import { Button } from "@/app/_components/ui";

export default function EditDishClient({ dish }: { dish: Dish }) {
  const router = useRouter();

  async function del() {
    if (!confirm("Delete this dish?")) return;
    const res = await fetch(`/api/dishes/${dish.id}`, { method: "DELETE" });
    if (res.ok) router.push("/");
  }

  return (
    <>
      <DishForm
        initial={dish}
        onSaved={(saved) => router.push(`/dishes/${saved.id}`)}
      />
      <div className="rounded-md border border-red-300 p-3 dark:border-red-900">
        <p className="mb-2 text-sm">Danger zone</p>
        <Button variant="ghost" size="sm" onClick={del}>
          Delete this dish
        </Button>
      </div>
    </>
  );
}
