import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import DishView from "./dish-view";

export default async function DishPage(props: PageProps<"/dishes/[id]">) {
  const { id } = await props.params;
  const rows = await sql`SELECT * FROM dishes WHERE id = ${Number(id)}`;
  if (rows.length === 0) notFound();
  const dish = rowToDish(rows[0]);
  return <DishView dish={dish} />;
}
