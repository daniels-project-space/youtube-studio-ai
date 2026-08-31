import type { CSSProperties } from "react";

import { PageHeader, SectionTitle } from "@/components/PageHeader";

/**
 * This is an evidence archive, not an alternate renderer control surface.
 * Music-loop execution is owned by the sealed channel route and its final QA;
 * historical Golden media must never silently become a current style target.
 */
const CURRENT_REFERENCE = {
  file: "beachcafe",
  title: "Beach Café",
  label: "Reference media",
  meta:
    "A retained composition reference for a warm, original coastal study scene. It is not a prompt, model preset, or publication-ready thumbnail.",
};

const EXECUTION_RAILS = [
  {
    title: "Original program",
    detail: "Each episode needs its own sealed music-program plan before a loop is made; a decorative visual cannot substitute for episode differentiation.",
  },
  {
    title: "Final-master evidence",
    detail: "Loop continuity, final audio, visual review, and the explicit ambient pacing exemption are evaluated against the exact released bytes.",
  },
  {
    title: "Runtime truth",
    detail: "This archive does not grant rendering authority. Channel readiness independently checks the exact approved runtime and benchmark before any spend.",
  },
];

const ARCHIVE_BOUNDARIES = [
  "Historical samples remain retained for audit, but are excluded from current generation, Golden quality targets, and automatic channel setup.",
  "Third-party studio, franchise, artist, or provider-style labels are never used as a channel style, prompt target, metadata tag, or thumbnail direction.",
  "A reference image informs an original visual grammar only when the applicable route and rights/provenance rules explicitly admit it.",
];

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
  fontFamily: "var(--font-mono)",
  fontSize: "0.66rem",
  letterSpacing: "0.06em",
  color: "var(--color-gold)",
  textTransform: "uppercase",
};
const META: CSSProperties = { fontSize: "0.8rem", lineHeight: 1.45, color: "var(--color-muted)" };

export default function LofiPage() {
  return (
    <>
      <PageHeader
        title="Lofi Visual Archive"
        subtitle="Approved reference media for original ambience—not a preset gallery, third-party style target, or rendering control surface."
      />

      <SectionTitle>Current reference</SectionTitle>
      <section style={GRID} aria-label="Current approved Lofi reference media">
        <article style={CARD}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
            <strong>{CURRENT_REFERENCE.title}</strong>
            <span style={LABEL}>{CURRENT_REFERENCE.label}</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- static immutable audit media */}
          <img
            src={`/golden/lofi/${CURRENT_REFERENCE.file}.jpg`}
            alt={CURRENT_REFERENCE.meta}
            style={{ width: "100%", borderRadius: 8, background: "#000", display: "block" }}
          />
          <span style={META}>{CURRENT_REFERENCE.meta}</span>
        </article>
      </section>

      <div style={{ height: "1.5rem" }} />
      <SectionTitle>What the real route guarantees</SectionTitle>
      <section style={GRID} aria-label="Music-loop execution guarantees">
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
