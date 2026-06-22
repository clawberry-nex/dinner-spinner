// Presentational cards rendered inside Satori (next/og). Every element uses
// display:flex (Satori requirement); text is truncated in JS rather than CSS
// line-clamp to stay within type-checked CSSProperties.

const C = {
  bg: "#15110E",
  panel: "#1F1915",
  text: "#F3EADF",
  dim: "#BBAE9F",
  accent: "#E27D45",
  gold: "#E6B450",
};

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

function Ring() {
  return <div style={{ width: 120, height: 120, borderRadius: 120, border: `12px solid ${C.accent}`, display: "flex" }} />;
}

function Kicker() {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontFamily: "Schibsted Grotesk", fontWeight: 700, fontSize: 26, letterSpacing: 4, color: C.accent }}>
        DINNER SPINNER
      </div>
      <div style={{ display: "flex", marginTop: 8, width: 64, height: 5, borderRadius: 5, background: C.accent }} />
    </div>
  );
}

export function FallbackCard({ tagline = "Pick a dinner, scale the recipe, build a shopping list." }: { tagline?: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: C.bg, padding: 90 }}>
      <Ring />
      <div style={{ display: "flex", marginTop: 36, fontFamily: "Spectral", fontWeight: 700, fontSize: 78, color: C.text }}>Dinner Spinner</div>
      <div style={{ display: "flex", marginTop: 18, fontFamily: "Schibsted Grotesk", fontWeight: 500, fontSize: 30, color: C.dim, textAlign: "center", maxWidth: 820 }}>
        {truncate(tagline, 120)}
      </div>
    </div>
  );
}

export function DishCard({ photo, title, meta }: { photo: string | null; title: string; meta: string }) {
  if (!photo) {
    return (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", background: C.bg, padding: 90 }}>
        <Kicker />
        <div style={{ display: "flex", marginTop: 28, fontFamily: "Spectral", fontWeight: 700, fontSize: 76, lineHeight: 1.05, color: C.text }}>
          {truncate(title, 60)}
        </div>
        <div style={{ display: "flex", marginTop: 20, fontFamily: "Schibsted Grotesk", fontWeight: 500, fontSize: 30, color: C.dim }}>
          {truncate(meta, 80)}
        </div>
      </div>
    );
  }
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "row", background: C.bg }}>
      <img src={photo} width={630} height={630} style={{ width: 630, height: 630, objectFit: "cover" }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 56, background: C.panel }}>
        <Kicker />
        <div style={{ display: "flex", overflow: "hidden", fontFamily: "Spectral", fontWeight: 700, fontSize: 60, lineHeight: 1.08, color: C.text }}>
          {truncate(title, 70)}
        </div>
        <div style={{ display: "flex", overflow: "hidden", fontFamily: "Schibsted Grotesk", fontWeight: 500, fontSize: 28, color: C.dim }}>
          {truncate(meta, 90)}
        </div>
      </div>
    </div>
  );
}

export function ProfileCard({ photo, name, handle, line }: { photo: string | null; name: string; handle: string | null; line: string }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "row", background: C.bg }}>
      {photo ? (
        <img src={photo} width={630} height={630} style={{ width: 630, height: 630, objectFit: "cover" }} />
      ) : (
        <div style={{ width: 630, height: 630, display: "flex", alignItems: "center", justifyContent: "center", background: C.panel }}>
          <Ring />
        </div>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: 56, background: C.panel }}>
        <Kicker />
        <div style={{ display: "flex", overflow: "hidden", marginTop: 28, fontFamily: "Spectral", fontWeight: 700, fontSize: 58, color: C.text }}>
          {truncate(name, 40)}
        </div>
        {handle ? (
          <div style={{ display: "flex", marginTop: 10, fontFamily: "Schibsted Grotesk", fontWeight: 500, fontSize: 30, color: C.gold }}>@{handle}</div>
        ) : null}
        <div style={{ display: "flex", overflow: "hidden", marginTop: 20, fontFamily: "Schibsted Grotesk", fontWeight: 500, fontSize: 28, color: C.dim }}>
          {truncate(line, 90)}
        </div>
      </div>
    </div>
  );
}
