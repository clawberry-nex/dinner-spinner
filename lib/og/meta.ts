// Pure text builders for link-preview metadata (Open Graph / Twitter / the
// composed card). No I/O so they're unit-tested; shared by the page
// generateMetadata and the opengraph-image routes so both stay in sync.

export type OgText = { title: string; description: string };

export function dishOgText(dish: {
  title: string;
  subtitle: string | null;
  tags: string[];
  baseServings: number;
}): OgText {
  const subtitle = dish.subtitle?.trim();
  if (subtitle) return { title: dish.title, description: subtitle };
  const parts: string[] = [];
  if (dish.tags.length > 0) parts.push(dish.tags.slice(0, 3).join(" · "));
  parts.push(`serves ${dish.baseServings}`);
  return { title: dish.title, description: parts.join(" · ") };
}

export function profileOgText(
  profile: { name: string | null; handle: string; bio: string | null },
  publicCount: number,
): OgText {
  const name = profile.name?.trim();
  const title = name ? `${name}'s recipes` : `@${profile.handle}`;
  const bio = profile.bio?.trim();
  const description = bio
    ? bio
    : `${publicCount} ${publicCount === 1 ? "recipe" : "recipes"} on Dinner Spinner`;
  return { title, description };
}
