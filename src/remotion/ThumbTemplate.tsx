import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";

/**
 * THUMB TEMPLATE PACK — designer-grade LOCKED layouts (docs/THUMB_TEMPLATES.md).
 * Full composites: AI art in a slot + typography in a fixed, professional
 * layout. 60-30-10 color rule, ≥4.5:1 contrast (lum math), safe zones.
 */
export type ThumbTemplateProps = {
  layout: "diagonal_split" | "number_burst" | "circle_spotlight" | "banner_bottom" | "versus_split" | "torn_reveal";
  /** AI art as data URI (and optional second slot for versus_split). */
  artSrc: string;
  artSrc2?: string;
  words: string[];
  number?: string;
  badge?: string;
  panelColor?: string;
  accentColor?: string;
  font?: "impact" | "marker" | "bebas" | "serif" | "rounded";
  uppercase?: boolean;
};

const FAM = {
  impact: "'Anton', sans-serif", marker: "'Permanent Marker', cursive",
  bebas: "'Bebas Neue', sans-serif", serif: "'DM Serif Display', serif",
  rounded: "'Fredoka One', sans-serif",
} as const;
const GW = { impact: 0.5, marker: 0.62, bebas: 0.4, serif: 0.52, rounded: 0.58 } as const;

function lum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

export const ThumbTemplate: React.FC<ThumbTemplateProps> = ({
  layout, artSrc, artSrc2, words, number, badge,
  panelColor = "#101018", accentColor = "#ffd400", font = "impact", uppercase = true,
}) => {
  const W = 1280, H = 720;
  const fam = FAM[font] ?? FAM.impact;
  const gw = GW[font] ?? 0.55;
  const panel = panelColor;
  const onPanel = lum(panel) < 0.5 ? "#ffffff" : "#15120e";
  const accent = lum(accentColor) >= 0.38 ? accentColor : "#f2f2f2";
  const onAccent = "#15120e";
  const tt = uppercase ? ("uppercase" as const) : ("none" as const);
  const fit = (t: string, boxPx: number, want: number) =>
    Math.round(Math.min(want, boxPx / (Math.max(1, t.length) * gw)));
  const fonts = (
    <style>{`
      @font-face { font-family:'Anton'; src:url('${staticFile("fonts/Anton.ttf")}'); }
      @font-face { font-family:'Permanent Marker'; src:url('${staticFile("fonts/PermanentMarker.ttf")}'); }
      @font-face { font-family:'Bebas Neue'; src:url('${staticFile("fonts/BebasNeue.ttf")}'); }
      @font-face { font-family:'DM Serif Display'; src:url('${staticFile("fonts/DMSerifDisplay.ttf")}'); }
      @font-face { font-family:'Fredoka One'; src:url('${staticFile("fonts/FredokaOne.ttf")}'); }
    `}</style>
  );
  const badgeEl = badge ? (
    <div style={{ position: "absolute", top: 26, right: 32, fontFamily: fam, fontSize: 22, letterSpacing: "0.18em", color: "#fff", background: "rgba(8,8,14,0.75)", border: `2px solid ${accent}`, borderRadius: 999, padding: "6px 16px", textTransform: "uppercase", zIndex: 9 }}>{badge}</div>
  ) : null;
  const stack = (boxPx: number, big: number, color: string) => (
    <div>
      {number ? <div style={{ fontFamily: fam, fontSize: fit(number, boxPx, big * 1.5), color: accent, lineHeight: 1, textTransform: tt }}>{number}</div> : null}
      {words.slice(0, 3).map((w, i) => (
        <div key={i} style={{ fontFamily: fam, fontSize: fit(w, boxPx, big), color: i === words.length - 1 ? accent : color, lineHeight: 1.08, textTransform: tt, ...(i === words.length - 1 ? { borderBottom: `10px solid ${accent}`, display: "inline-block", paddingBottom: 4 } : {}) }}>{w}</div>
      ))}
    </div>
  );

  if (layout === "diagonal_split") {
    return (
      <AbsoluteFill style={{ background: panel }}>{fonts}
        <div style={{ position: "absolute", left: "34%", top: 0, width: "66%", height: "100%", clipPath: "polygon(12% 0, 100% 0, 100% 100%, 0 100%)" }}>
          <Img src={artSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <div style={{ position: "absolute", left: 0, top: 0, width: "40%", height: "100%", clipPath: "polygon(0 0, 100% 0, 80% 100%, 0 100%)", background: panel, display: "flex", alignItems: "center", paddingLeft: 48 }}>
          {stack(W * 0.32, 96, onPanel)}
        </div>
        <div style={{ position: "absolute", left: "31.5%", top: 0, width: 14, height: "100%", background: accent, transform: "skewX(-9deg)" }} />
        {badgeEl}
      </AbsoluteFill>
    );
  }
  if (layout === "number_burst") {
    return (
      <AbsoluteFill style={{ background: panel }}>{fonts}
        <Img src={artSrc} style={{ position: "absolute", right: 0, width: "62%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", left: 0, top: 0, width: "48%", height: "100%", background: `linear-gradient(90deg, ${panel} 62%, transparent)` }} />
        <div style={{ position: "absolute", left: 40, top: 50, width: "42%" }}>
          <div style={{ position: "absolute", left: -30, top: -30, width: 360, height: 360, background: `radial-gradient(circle, ${accent}44 0%, transparent 70%)` }} />
          {number ? <div style={{ fontFamily: fam, fontSize: fit(number, W * 0.42, 230), color: accent, lineHeight: 0.95, textShadow: "0 10px 40px rgba(0,0,0,0.6)" }}>{number}</div> : null}
          {words.slice(0, 2).map((w, i) => (
            <div key={i} style={{ fontFamily: fam, fontSize: fit(w, W * 0.4, 86), color: "#fff", lineHeight: 1.1, textTransform: tt }}>{w}</div>
          ))}
        </div>
        {badgeEl}
      </AbsoluteFill>
    );
  }
  if (layout === "circle_spotlight") {
    return (
      <AbsoluteFill style={{ background: panel }}>{fonts}
        <div style={{ position: "absolute", right: 56, top: 70, width: 560, height: 560, borderRadius: "50%", overflow: "hidden", border: `14px solid ${accent}`, boxShadow: "0 20px 80px rgba(0,0,0,0.6)" }}>
          <Img src={artSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <div style={{ position: "absolute", left: 52, top: "50%", transform: "translateY(-50%)", width: "44%" }}>
          {stack(W * 0.42, 92, "#ffffff")}
        </div>
        {badgeEl}
      </AbsoluteFill>
    );
  }
  if (layout === "banner_bottom") {
    return (
      <AbsoluteFill>{fonts}
        <Img src={artSrc} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "25%", background: panel, display: "flex", alignItems: "center", paddingLeft: 44, gap: 28, borderTop: `8px solid ${accent}` }}>
          {words.slice(0, 3).map((w, i) => (
            <span key={i} style={{ fontFamily: fam, fontSize: fit(words.join(" "), W * 0.78, 84), color: i % 2 ? accent : onPanel, textTransform: tt }}>{w}</span>
          ))}
        </div>
        <div style={{ position: "absolute", top: 28, left: 32, fontFamily: fam, fontSize: 30, color: onAccent, background: accent, borderRadius: 999, padding: "8px 22px", textTransform: tt }}>{number ?? badge ?? ""}</div>
      </AbsoluteFill>
    );
  }
  if (layout === "versus_split") {
    return (
      <AbsoluteFill style={{ background: panel }}>{fonts}
        <Img src={artSrc} style={{ position: "absolute", left: 0, width: "50%", height: "100%", objectFit: "cover" }} />
        <Img src={artSrc2 ?? artSrc} style={{ position: "absolute", right: 0, width: "50%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", left: "48.5%", top: 0, width: 38, height: "100%", background: accent, transform: "skewX(-6deg)" }} />
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 170, height: 170, borderRadius: "50%", background: panel, border: `10px solid ${accent}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fam, fontSize: 64, color: accent }}>VS</div>
        {words[0] ? <div style={{ position: "absolute", top: 30, left: 30, fontFamily: fam, fontSize: fit(words[0], W * 0.4, 64), color: "#fff", background: "rgba(0,0,0,0.65)", padding: "6px 18px", borderRadius: 8, textTransform: tt }}>{words[0]}</div> : null}
        {words[1] ? <div style={{ position: "absolute", top: 30, right: 30, fontFamily: fam, fontSize: fit(words[1], W * 0.4, 64), color: "#fff", background: "rgba(0,0,0,0.65)", padding: "6px 18px", borderRadius: 8, textTransform: tt }}>{words[1]}</div> : null}
      </AbsoluteFill>
    );
  }
  // torn_reveal
  return (
    <AbsoluteFill style={{ background: panel }}>{fonts}
      <Img src={artSrc} style={{ position: "absolute", right: 0, width: "68%", height: "100%", objectFit: "cover", clipPath: "polygon(6% 0, 100% 0, 100% 100%, 0 100%, 3% 88%, 1% 72%, 5% 55%, 2% 38%, 6% 20%, 3% 8%)" }} />
      <div style={{ position: "absolute", left: 0, top: 0, width: "36%", height: "100%", display: "flex", alignItems: "center", paddingLeft: 44 }}>
        {stack(W * 0.3, 90, onPanel)}
      </div>
      <div style={{ position: "absolute", left: "30%", top: 44, width: 120, height: 34, background: accent, opacity: 0.85, transform: "rotate(-35deg)" }} />
      {badgeEl}
    </AbsoluteFill>
  );
};
