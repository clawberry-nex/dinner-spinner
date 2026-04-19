import type { ReactNode } from "react";

type Block =
  | { type: "h"; level: number; text: string }
  | { type: "ol"; items: string[] }
  | { type: "p"; text: string };

function parse(text: string): Block[] {
  const out: Block[] = [];
  let current: { type: "ol"; items: string[] } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { if (current) { out.push(current); current = null; } continue; }
    const h = line.match(/^(#+)\s+(.+)$/);
    if (h) { if (current) { out.push(current); current = null; } out.push({ type: "h", level: h[1].length, text: h[2] }); continue; }
    const li = line.match(/^\s*\d+\.\s+(.+)$/) || line.match(/^\s*[-*]\s+(.+)$/);
    if (li) { if (!current) current = { type: "ol", items: [] }; current.items.push(li[1]); continue; }
    if (current) { out.push(current); current = null; }
    out.push({ type: "p", text: line });
  }
  if (current) out.push(current);
  return out;
}

function inline(t: string): ReactNode[] {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="text-ink">{p.slice(2, -2)}</strong>;
    return <span key={i}>{p}</span>;
  });
}

export function MarkdownLite({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "h") {
          return (
            <h3 key={i} className="mt-[18px] mb-1 text-[18px] italic font-medium tracking-[-0.01em] text-ink" style={{ fontFamily: "var(--font-disp)" }}>
              {b.text}
            </h3>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={i} className="m-0 my-2 list-none p-0">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-3 py-[6px]">
                  <span className="min-w-[18px] pt-[2px] text-[12px] font-semibold text-accent" style={{ fontFamily: "var(--font-mono)" }}>{j + 1}.</span>
                  <span className="flex-1">{inline(it)}</span>
                </li>
              ))}
            </ol>
          );
        }
        return <p key={i} className="my-[6px]">{inline(b.text)}</p>;
      })}
    </>
  );
}
