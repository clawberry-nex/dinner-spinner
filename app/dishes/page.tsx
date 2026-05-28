import { redirect } from "next/navigation";

// /dishes was the old dish-browse tab. It now lives on the You page as part
// of the user's public profile. Keep this route as a redirect so any stale
// PWA shortcut, bookmark, or external link still works.
export default function DishesRedirect() {
  redirect("/me");
}
