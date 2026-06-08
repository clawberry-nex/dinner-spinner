import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { auth } from "@/lib/auth";
import { rowToDish } from "@/lib/types";
import EditDishClient from "./edit-client";

export default async function EditDishPage(props: PageProps<"/dishes/[id]/edit">) {
  const { id } = await props.params;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) notFound();

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) notFound();

  const rows = await sql`
    SELECT d.*,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
    FROM dishes d
    WHERE d.id = ${dishId} AND d.user_id = ${userId}
    LIMIT 1
  `;
  if (rows.length === 0) notFound();
  const dish = rowToDish(rows[0]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-bg">
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24 lg:pb-12">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-5 pt-[var(--safe-top)] lg:px-10">
          <EditDishClient dish={dish} />
        </div>
      </div>
    </div>
  );
}
