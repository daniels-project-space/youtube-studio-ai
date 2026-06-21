import type { CSSProperties } from "react";
import { PageHeader, SectionTitle } from "@/components/PageHeader";

/**
 * Lofi Loop — the standalone module's studio page: the scene catalogue, the two
 * cost/quality lanes, the inputs it needs, and the rules that protect its output.
 * Mirrors the LOFI_MODULE contract in src/lib/lofi.ts.
 */

const SCENES = [
  { file: "meadow", kind: "video" as const, title: "Hillside Meadow", device: "ghibli meadow · 2×15s seamless · de-warbled · 1080p", meta: "Grass, clouds, birds and the host's hair all move on a locked camera — the loop seam invisible." },
  { file: "beachcafe", kind: "image" as const, title: "Beach Cafe", device: "scene · sunny shore", meta: "A cosy terrace over a sparkling turquoise bay — host + cat, parasol, sailboats, lanterns." },
  { file: "seasideroom", kind: "image" as const, title: "Seaside Room", device: "scene · open windows", meta: "Curtains billowing in the sea breeze, the host relaxed on the bed with feet dangling off the edge." },
  { file: "sunsetpier", kind: "image" as const, title: "Sunset Pier", device: "scene · asian lake", meta: "Golden-hour over a mirror-still mountain lake — lanterns, fireflies, misty peaks." },
  { file: "samurai", kind: "image" as const, title: "Samurai Night Rain", device: "scene · old asia · indoor", meta: "A samurai on dry tatami watching the rain in the garden — it never rains inside, only beyond the open screen." },
  { file: "cyber", kind: "image" as const, title: "Cyberpunk Penthouse", device: "scene · neon city · indoor", meta: "A covered wood-and-glass balcony over a rainy neon megacity — fire pit, couches, dry interior, rain only outside the glass." },
];

const PATHS = [
  { name: "Standard", spec: "Nano Banana Pro + Kling 2×15s + de-warble, native 1080p", cost: "~$1 / render", note: "No upscale baked in. The default lane." },
  { name: "Premium", spec: "Topaz 4K pass on the 30s loop unit → 3840×2160", cost: "~$3 / render", note: "Separate Topaz pass on the short unit only, then re-assembled at 4K." },
];

const INPUTS = [
  { k: "scene", v: "beachcafe | seasideroom | sunsetpier | meadow" },
  { k: "channel", v: "on-screen channel name (deblur intro)" },
  { k: "title", v: "on-screen lofi title" },
  { k: "music", v: "local path to the lofi music bed" },
  { k: "slug", v: "unique id — names the output + published file" },
];

const RULES = [
  "Seamless loop = 2×15s: clip A animates freely, clip B animates BACK to the origin frame → the 30s unit's last frame == first frame → a plain stream_loop is invisible. Never a crossfade, never a boomerang.",
  "Motion is ENSURED, not hoped: each scene declares ranked animation priorities + forbidden motion + spatial rules, and a Gemini-Vision pass writes the motion prompt grounded in the actual painting (≥5 moving element types).",
  "Static camera is locked at the source — a hard tripod-lock clause on every Kling prompt: the wind moves the SUBJECTS, never the viewpoint.",
  "It never rains inside — covered/indoor scenes get a hard no-rain-inside clause on the still and the Kling prompt; rain falls only outside the glass, the interior stays bone dry.",
  "Camera shake is also removed in post — a motion-aware temporal de-warble cleans AI shimmer from the loop unit, with the seam preserved.",
  "NO upscale is baked in — the render is native resolution; Topaz 4K is a separate, optional pass on the short loop unit only.",
  "Every stage caches to output/lofi/<slug>/ → fully resumable.",
];

const GRID: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "0.85rem", marginTop: "0.5rem" };
const CARD: CSSProperties = { background: "var(--color-surface-solid)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "0.7rem 0.8rem", display: "grid", gap: "0.4rem" };
const DEVICE: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.6rem", letterSpacing: "0.04em", color: "var(--color-gold)", textTransform: "uppercase" };
const META: CSSProperties = { fontSize: "0.78rem", lineHeight: 1.4, color: "var(--color-muted)" };

export default function LofiPage() {
  return (
    <>
      <PageHeader
        title="Lofi Loop"
        subtitle="Seamless hours-loopable Ghibli sunny-seaside lofi — a painting brought to life on a locked camera, standalone and golden."
      />

      <SectionTitle>The scene world</SectionTitle>
      <div style={GRID}>
        {SCENES.map((v) => (
          <div key={v.file} style={CARD}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.92rem", fontWeight: 600 }}>{v.title}</span>
              <span className="golden-chip">★ GOLDEN</span>
            </div>
            <span style={DEVICE}>{v.device}</span>
            {v.kind === "video" ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption -- example render
              <video controls preload="none" poster={`/golden/lofi/${v.file}.jpg`} src={`/golden/lofi/${v.file}.mp4`} style={{ width: "100%", borderRadius: 8, background: "#000" }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- static scene still
              <img src={`/golden/lofi/${v.file}.jpg`} alt={v.meta} style={{ width: "100%", borderRadius: 8, background: "#000", display: "block" }} />
            )}
            <span style={META}>{v.meta}</span>
          </div>
        ))}
      </div>

      <div style={{ height: "1.5rem" }} />
      <SectionTitle>Two lanes — pick cost vs quality</SectionTitle>
      <div style={{ ...GRID, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {PATHS.map((p) => (
          <div key={p.name} className="glass" style={{ padding: "0.9rem 1rem", display: "grid", gap: "0.35rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: "0.95rem", fontWeight: 600 }}>{p.name}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--color-gold)" }}>{p.cost}</span>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--color-secondary)" }}>{p.spec}</span>
            <span style={META}>{p.note}</span>
          </div>
        ))}
      </div>

      <div style={{ height: "1.5rem" }} />
      <SectionTitle>What it needs</SectionTitle>
      <div style={{ ...GRID, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {INPUTS.map((i) => (
          <div key={i.k} style={CARD}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--color-gold)" }}>{i.k}</span>
            <span style={META}>{i.v}</span>
          </div>
        ))}
      </div>

      <div style={{ height: "1.5rem" }} />
      <SectionTitle>The rules</SectionTitle>
      <ul style={{ margin: "0.4rem 0 0", padding: 0, listStyle: "none", display: "grid", gap: "0.45rem" }}>
        {RULES.map((r, i) => (
          <li key={i} style={{ display: "flex", gap: "0.55rem", alignItems: "baseline", fontSize: "0.82rem", lineHeight: 1.4, color: "var(--color-muted)" }}>
            <span style={{ color: "var(--color-gold)", flex: "0 0 auto" }}>▪</span>
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
