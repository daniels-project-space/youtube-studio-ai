import type { CSSProperties } from "react";
import { PageHeader, SectionTitle } from "@/components/PageHeader";

/**
 * Lore Short — the standalone module's studio page: example renders, the two
 * cost/quality lanes, the inputs it needs, and the rules that protect it.
 * Mirrors the LORESHORT_MODULE contract in src/lib/loreshort.ts.
 */

const VIDEOS = [
  { file: "lotr", title: "The Rings of Power", device: "watercolour + pencil · Seedance → 4K · narrated", meta: "First-person elven loremaster — the forging of the rings, depth-led 3D camera." },
  { file: "starwars", title: "The Empire", device: "cinematic concept-art · 2K · narrated", meta: "How the old order fell — title card, intensity-aware motion, genuine parallax." },
  { file: "smith4k", title: "One beat · true 4K", device: "premium lane · Seedance 480p → Real-ESRGAN 4K", meta: "The smith forges the ring — figure detail recovered at 3888×2160." },
];

const PATHS = [
  { name: "Budget", spec: "LTX-distilled + free ffmpeg 2K", cost: "~$0.40 / video", note: "Fastest, lowest cost. Softer figures, 2K." },
  { name: "Premium", spec: "Seedance-1-lite 480p → Real-ESRGAN 4K", cost: "~$1.35 / video", note: "Richest figures, true 4K. The default lane." },
];

const INPUTS = [
  { k: "topic", v: "the history / subject to narrate" },
  { k: "narrator", v: "WHO narrates, first person — identity + tone" },
  { k: "title", v: "title-card headline" },
  { k: "kicker", v: "title-card subtitle" },
  { k: "slug", v: "unique id — names the output + published file" },
];

const RULES = [
  "De-brand the visuals — SCENE art uses only generic, non-trademarked terms (the image model refuses IP); narration text may be freer.",
  "The DEPTH camera move is the core and always leads; subject/particle motion is added only where a vision pass finds it, scaled to honest intensity — never forced onto still objects.",
  "A title card plays BEFORE the narration starts.",
  "No cross-engine fallback — a failed clip retries the SAME engine, then fails loud; content-policy refusals are fixed at the art source.",
  "Render is nginx-independent (Replicate inputs are base64 data URIs); every stage caches → fully resumable.",
  "Two lanes: budget (free ffmpeg 2K) and premium (Seedance 480p → Real-ESRGAN 4K).",
];

const GRID: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "0.85rem", marginTop: "0.5rem" };
const CARD: CSSProperties = { background: "var(--color-surface-solid)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "0.7rem 0.8rem", display: "grid", gap: "0.4rem" };
const DEVICE: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.6rem", letterSpacing: "0.04em", color: "var(--color-gold)", textTransform: "uppercase" };
const META: CSSProperties = { fontSize: "0.78rem", lineHeight: 1.4, color: "var(--color-muted)" };

export default function LoreShortPage() {
  return (
    <>
      <PageHeader
        title="Lore Short"
        subtitle="First-person ‘Histories & Lore’ micro-docs with genuine 3D AI camera moves — standalone, golden."
      />

      <SectionTitle>Example renders</SectionTitle>
      <div style={GRID}>
        {VIDEOS.map((v) => (
          <div key={v.file} style={CARD}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.92rem", fontWeight: 600 }}>{v.title}</span>
              <span className="golden-chip">★ GOLDEN</span>
            </div>
            <span style={DEVICE}>{v.device}</span>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- example render */}
            <video controls preload="none" poster={`/golden/loreshort/${v.file}.jpg`} src={`/golden/loreshort/${v.file}.mp4`} style={{ width: "100%", borderRadius: 8, background: "#000" }} />
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
