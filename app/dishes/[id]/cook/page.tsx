import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";
import { rowToDish } from "@/lib/types";
import CookView from "./cook-view";

export default async function CookPage(props: PageProps<"/dishes/[id]/cook">) {
  const { id } = await props.params;
  const search = await props.searchParams;
  const dishId = Number(id);
  if (!Number.isFinite(dishId)) notFound();

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) notFound();

  const rows = await sql`
    SELECT * FROM dishes WHERE id = ${dishId} AND user_id = ${userId}
  `;
  if (rows.length === 0) notFound();
  const dish = rowToDish(rows[0]);

  const raw = search?.servings;
  const servingsParam = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(servingsParam);
  const servings =
    Number.isFinite(parsed) && parsed > 0 ? parsed : dish.baseServings;

  return <CookView dish={dish} initialServings={servings} />;
}
