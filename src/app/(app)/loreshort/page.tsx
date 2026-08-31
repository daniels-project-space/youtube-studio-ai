import type { CSSProperties } from "react";
import { PageHeader, SectionTitle } from "@/components/PageHeader";

const CURRENT_REFERENCE = {
  file: "smith4k",
  title: "Original blacksmith study",
  label: "REFERENCE MEDIA",
  meta: "An approved original-lore reference still retained to evaluate composition, legibility, and depth—not a reusable story, character, franchise, or renderer preset.",
} as const;

const EXECUTION_RAILS = [
  {
    title: "Route status",
    detail: "Lore Short is not available to the automatic creator yet. It stays blocked until its exact open-weight LTX 2.5 Novita runtime is benchmarked and its route qualification is sealed.",
  },
  {
    title: "Originality boundary",
    detail: "A future route must start from a self-contained original story plan and critic receipt. It cannot adapt named franchises, their characters, worlds, plots, or visual identifiers.",
  },
  {
    title: "Release evidence",
    detail: "A rendered episode must prove its own final master, quality review, timing, and release evidence. Archive media cannot satisfy any of those gates.",
  },
] as const;

const ARCHIVE_BOUNDARIES = [
  "Historical samples remain retained for audit and comparison only; they are never presented as an executable renderer, channel recipe, or release-quality proof.",
  "Named-franchise examples are intentionally excluded from this page and cannot seed a new script, visual prompt, character, or style treatment.",
  "This page does not trigger rendering, provider work, training, or publishing. The automatic creator remains the only route into an admitted production pipeline.",
] as const;

const GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "0.85rem",
  marginTop: "0.5rem",
};
const CARD: CSSProperties = {
  background: "var(--color-surface-solid)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  padding: "0.8rem",
  display: "grid",
  gap: "0.55rem",
};
const LABEL: CSSProperties = {
  color: "var(--color-gold)",
  fontFamily: "var(--font-mono)",
  fontSize: "0.62rem",
  letterSpacing: "0.06em",
};
const META: CSSProperties = { color: "var(--color-muted)", fontSize: "0.82rem", lineHeight: 1.45 };

export default function LoreShortPage() {
  return (
    <>
      <PageHeader
        title="Lore Short Reference Archive"
        subtitle="Reference media and route evidence for original micro-documentary lore—not a franchise gallery or a live renderer control surface."
      />

      <SectionTitle>Current reference</SectionTitle>
      <section style={GRID} aria-label="Current approved Lore Short reference media">
        <article style={CARD}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
            <strong>{CURRENT_REFERENCE.title}</strong>
            <span style={LABEL}>{CURRENT_REFERENCE.label}</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- static immutable audit media */}
          <img
            src={`/golden/loreshort/${CURRENT_REFERENCE.file}.jpg`}
            alt={CURRENT_REFERENCE.meta}
            style={{ width: "100%", borderRadius: 8, background: "#000", display: "block" }}
          />
          <span style={META}>{CURRENT_REFERENCE.meta}</span>
        </article>
      </section>

      <div style={{ height: "1.5rem" }} />
      <SectionTitle>What the future route must prove</SectionTitle>
      <section style={GRID} aria-label="Lore Short route requirements">
        {EXECUTION_RAILS.map((rail) => (
          <article key={rail.title} style={CARD}>
            <strong>{rail.title}</strong>
            <span style={META}>{rail.detail}</span>
          </article>
        ))}
      </section>

      <div style={{ height: "1.5rem" }} />
      <SectionTitle>Archive boundary</SectionTitle>
      <ul style={{ margin: "0.5rem 0 0", padding: 0, listStyle: "none", display: "grid", gap: "0.5rem" }}>
        {ARCHIVE_BOUNDARIES.map((boundary) => (
          <li key={boundary} className="glass" style={{ padding: "0.75rem 0.85rem", color: "var(--color-muted)", fontSize: "0.82rem", lineHeight: 1.45 }}>
            {boundary}
          </li>
        ))}
      </ul>
    </>
  );
}
