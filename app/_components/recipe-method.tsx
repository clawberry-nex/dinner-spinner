import type { ReactNode } from "react";
import { parseMethod } from "@/lib/recipe";

// Inline bold (**x**) — preserves the one inline style MarkdownLite supported.
function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <strong key={i} className="text-ink">
          {p.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

// Renders a recipe method as sections of numbered steps. Numbering restarts
// per section (index within the section). Shared shape with cook mode.
export function RecipeMethod({ text }: { text: string }) {
  const sections = parseMethod(text);
  if (sections.length === 0) {
    return <p className="my-[6px]">{inline(text)}</p>;
  }
  return (
    <>
      {sections.map((section, si) => (
        <section key={si} className="mb-4">
          {section.title && (
            <h3
              className="mt-[18px] mb-1 text-[18px] italic font-medium tracking-[-0.01em] text-ink"
              style={{ fontFamily: "var(--font-disp)" }}
            >
              {section.title}
            </h3>
          )}
          <ol className="m-0 my-2 list-none p-0">
            {section.steps.map((step, j) => (
              <li key={j} className="flex gap-3 py-[6px]">
                <span
                  className="min-w-[18px] pt-[2px] text-[12px] font-semibold text-accent"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {j + 1}.
                </span>
                <span className="flex-1">{inline(step)}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
