import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { rowToCookLogEntry, rowToDish } from "@/lib/types";
import DishView from "./dish-view";

export default async function DishPage(props: PageProps<"/dishes/[id]">) {
  const { id } = await props.params;
  const dishId = Number(id);
  const rows = await sql`
    SELECT d.*,
      (SELECT MAX(cooked_at) FROM cook_log WHERE dish_id = d.id) AS last_cooked_at,
      (SELECT AVG(rating)::float FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS avg_rating,
      (SELECT COUNT(*) FROM cook_log WHERE dish_id = d.id AND rating IS NOT NULL) AS rating_count
    FROM dishes d
    WHERE d.id = ${dishId}
  `;
  if (rows.length === 0) notFound();
  const dish = rowToDish(rows[0]);
  const logRows = await sql`
    SELECT id, cooked_at, rating, note
    FROM cook_log
    WHERE dish_id = ${dishId}
    ORDER BY cooked_at DESC
    LIMIT 100
  `;
  const history = logRows.map(rowToCookLogEntry);
  return <DishView dish={dish} history={history} />;
}
