import type { CSSProperties } from "react";
import { GOLDEN_MODULES, GOLDEN_SPINE, type GoldenModule } from "@/engine/golden";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { GoldenImages } from "./GoldenImages";

/** Real banana-engine thumbnails — every one a first-try judge-gated SHIP. */
const PROOFS: { src: string; alt: string }[] = [
  { src: "drawn.jpg", alt: "The Drawn Past — The Dancing Plague" },
  { src: "samurai.jpg", alt: "Steel & Silk — Kyoto Burns" },
  { src: "stoic_anger.jpg", alt: "The Quiet Stoic — Anger Is Weakness" },
  { src: "stoic_still.jpg", alt: "The Quiet Stoic — Stillness Is Power" },
  { src: "stoic_memento.jpg", alt: "The Quiet Stoic — Remember You Must Die" },
  { src: "hannibal.jpg", alt: "Empires at War — Hannibal" },
  { src: "scandal.jpg", alt: "Spotlight Rot — tabloid collage" },
  { src: "rich.jpg", alt: "Gilded Lies — evil." },
];

/** Real cinecraft output — the SAME generated character across four shots (10/10). */
const CINEMATIC_PROOFS: { src: string; alt: string }[] = [
  { src: "cinematic/cash.jpg", alt: "Victor Lustig — counting the cash" },
  { src: "cinematic/handshake.jpg", alt: "Victor Lustig — the handshake" },
  { src: "cinematic/corridor.jpg", alt: "Victor Lustig — walking out" },
  { src: "cinematic/taxi.jpg", alt: "Victor Lustig — the taxi smile" },
];

const DOCU_PROOFS: { file: string; device: string; meta: string }[] = [
  { file: "fordlandia", device: "archival collage · narrated · 1080p", meta: "Fordlandia: The Jungle City — Ford's failed Amazon rubber town" },
  { file: "robbery", device: "robbery noir · depth-parallax · 1080p", meta: "The Vault — the Antwerp diamond heist reconstruction" },
];

/** Real motioncraft renders — one heist script, four beats, four tools the LLM picked itself. */
const MOTION_PROOFS: { file: string; device: string; meta: string }[] = [
  { file: "hero", device: "hero_title · Nano Banana + Remotion · 1080p", meta: "\"Never fully solved\" — a camera flies through a depth-parallax hero render, title overlaid" },
  { file: "map", device: "geo_map · MapLibre · 1080p", meta: "Antwerp diamond district — real OSM streets, a gold target push-in" },
  { file: "stats", device: "data_stats · Remotion · 1080p", meta: "Ten layers · $100M · zero alarms — only the spoken numbers, verbatim" },
  { file: "crew", device: "generative · p5.js · 1080p", meta: "The School of Turin — a drifting intel-network background" },
];

interface TextProof { device: string; channel: string; line: string; note: string }

const SCRIPT_PROOFS: TextProof[] = [
  { device: "myth_snap", channel: "Empires at War", line: "The Roman Empire did not fall in a fiery battle. It bled out over two hundred years of self-inflicted wounds.", note: "facts search-verified" },
  { device: "countdown", channel: "Empires at War", line: "Fifteen days until the snows seal the Alpine passes. Hannibal has thirty-seven elephants and no supply lines.", note: "specificity 10 · curiosity 10" },
  { device: "cold_open", channel: "The Drawn Past", line: "Frau Troffea steps into a Strasbourg street and begins to twitch. She will not stop for six days.", note: "7/7 claims verified" },
  { device: "receipt", channel: "Spotlight Rot", line: "One photo of a shaved head in 2007 generated five hundred thousand dollars in a single hour.", note: "chaos-commentator voice" },
  { device: "the quote", channel: "Seven Quiet Days", line: "Familiarity breeds invisibility. Today, give someone the gift of being seen.", note: "episode takeaway" },
];

const META_PROOFS: TextProof[] = [
  { device: "direct", channel: "The Quiet Stoic", line: "Anger is the ultimate form of self-destruction.", note: "click 9 · direct 9" },
  { device: "contrarian", channel: "Empires at War", line: "Barbarian Hordes Did Not Destroy the Roman Empire", note: "claims grounded in script" },
  { device: "contrarian", channel: "Steel & Silk", line: "Japan's Deadliest War Started Over Nothing", note: "judged vs 10 real titles" },
  { device: "direct", channel: "The Drawn Past", line: "Strasbourg's medical cure killed the dancers", note: "real-feed · avg 48 chars" },
  { device: "direct", channel: "The Takeover Log", line: "The AI takeover is a corporate restructuring.", note: "runner-up stored for swap" },
];

const TOPIC_PROOFS: TextProof[] = [
  { device: "hero · search", channel: "War Annals: East", line: "The real history behind a Battle of Red Cliffs movie", note: "demand 9" },
  { device: "help · search", channel: "Cutaway Critique", line: "Why Davy Jones CGI still beats modern VFX", note: "demand 9" },
  { device: "help · search", channel: "Plain Money", line: "The real difference between index funds vs ETFs", note: "verbatim query" },
  { device: "hero · search", channel: "Antiquity Files", line: "Eric Cline's perfect storm that ended the Bronze Age", note: "demand 9" },
  { device: "hub · identity", channel: "The Quiet Stoa", line: "Detaching from the opinions of others", note: "fresh 9 · zero repeats" },
];

const VOICE_PROOFS: { file: string; device: string; meta: string }[] = [
  { file: "stoic.mp3", device: "quiet-mentor · 0.95x", meta: "Brian — deep neutral-US" },
  { file: "meditation.mp3", device: "gentle-guide · 0.85x", meta: "Autumn Veil — mature female" },
  { file: "social.mp3", device: "chaos · 1.15x", meta: "Jessica — young female" },
  { file: "finance.mp3", device: "advisor · 1.1x", meta: "Bill — wise male" },
  { file: "history.mp3", device: "narrator · 1.0x", meta: "George — storyteller" },
];

/**
 * Golden Pipeline — a static render of the GOLDEN_MODULES registry: a pipeline
 * progress bar of the spine, then compact tiles (golden first), each with a
 * side-by-side proof strip. The engine + this page share one source of truth.
 */
export default function GoldenPipelinePage() {
  const golden = GOLDEN_MODULES.filter((m) => m.status === "golden");
  const active = GOLDEN_MODULES.filter((m) => m.status !== "golden");
  const stageOrder = GOLDEN_SPINE.map((s) => s.stage);
  const goldenStages = new Set(golden.map((m) => m.stage));

  return (
    <>
      <PageHeader
        title="Golden Pipeline"
        subtitle="The template every channel inherits — refine a module once, lift every channel."
      />

      <PipelineBar stages={stageOrder} goldenStages={goldenStages} />

      <SectionTitle>
        Certified golden — {golden.length} of {GOLDEN_MODULES.length}
      </SectionTitle>
      <div style={GRID}>
        {golden.map((m) => (
          <ModuleCard key={m.key} module={m} hero />
        ))}
      </div>

      <div style={{ height: "1.75rem" }} />
      <SectionTitle>Active — the rest of the spine</SectionTitle>
      <div style={GRID}>
        {active.map((m) => (
          <ModuleCard key={m.key} module={m} hero={m.key === "whiteboard"} stageIndex={stageOrder.indexOf(m.stage) + 1} />
        ))}
      </div>
    </>
  );
}

const GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
  gap: "0.85rem",
  marginTop: "0.5rem",
};

/* ---------------------------- pipeline bar ----------------------------- */

function PipelineBar({ stages, goldenStages }: { stages: string[]; goldenStages: Set<string> }) {
  return (
    <div style={{ margin: "0.25rem 0 1.9rem" }}>
      <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 4 }}>
        {stages.map((s, i) => {
          const gold = goldenStages.has(s);
          return (
            <div key={s} style={{ flex: "1 1 0", minWidth: 56, display: "grid", gap: 5 }}>
              <div
                style={{
                  height: 4,
                  borderRadius: 999,
                  background: gold ? "var(--color-gold)" : "var(--color-border-strong)",
                  boxShadow: gold ? "0 0 8px rgba(212,160,23,0.4)" : "none",
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.6rem",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: gold ? "var(--color-gold)" : "var(--color-faint)",
                  whiteSpace: "nowrap",
                }}
              >
                {i + 1} {s}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- module card ----------------------------- */

function ModuleCard({ module: m, hero = false, stageIndex }: { module: GoldenModule; hero?: boolean; stageIndex?: number }) {
  const isGolden = m.status === "golden";
  return (
    <article className={`glass lift${isGolden ? " golden-glow" : ""}`} style={{ padding: "1rem 1.1rem", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-faint)" }}>
          {stageIndex ? `${stageIndex} · ` : ""}{m.stage}
        </span>
        {isGolden ? <span className="golden-chip">★ GOLDEN</span> : <span className="status-chip">ACTIVE</span>}
      </div>

      <h3 style={{ margin: 0, fontSize: "1.04rem", fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.25 }}>{m.title}</h3>
      <p style={{ margin: "0.3rem 0 0.7rem", fontFamily: "var(--font-mono)", fontSize: "0.68rem", lineHeight: 1.4, color: isGolden ? "var(--color-gold)" : "var(--color-secondary)" }}>
        {m.engine.split(" — ")[0]}
      </p>

      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.3rem" }}>
        {m.gates.slice(0, 4).map((g) => (
          <li key={g} style={{ display: "flex", gap: "0.45rem", alignItems: "baseline", fontSize: "0.76rem", lineHeight: 1.35, color: "var(--color-muted)" }}>
            <span style={{ color: isGolden ? "var(--color-gold)" : "var(--color-secondary)", fontSize: "0.7rem", flex: "0 0 auto" }}>▪</span>
            <span>{g}</span>
          </li>
        ))}
      </ul>

      {hero && <ProofStrip moduleKey={m.key} />}
    </article>
  );
}

/* ----------------------------- proof strips ---------------------------- */

const STRIP: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.5rem", marginTop: "0.9rem", paddingTop: "0.85rem", borderTop: "1px solid var(--color-border)" };
const CARD: CSSProperties = { background: "var(--color-surface-solid)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "0.5rem 0.6rem", display: "grid", gap: "0.25rem" };
const DEVICE: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.58rem", letterSpacing: "0.04em", color: "var(--color-gold)", textTransform: "uppercase" };
const LINE3: CSSProperties = { fontSize: "0.74rem", lineHeight: 1.32, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" };
const METAT: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.58rem", color: "var(--color-faint)" };

function imageStrip(srcs: { src: string; alt: string }[]) {
  return <GoldenImages images={srcs} />;
}

function textStrip(items: TextProof[]) {
  return (
    <div style={STRIP}>
      {items.map((p, i) => (
        <div key={i} style={CARD}>
          <span style={DEVICE}>{p.device}</span>
          <span style={LINE3}>{p.line}</span>
          <span style={METAT}>{p.channel} · {p.note}</span>
        </div>
      ))}
    </div>
  );
}

function ProofStrip({ moduleKey }: { moduleKey: string }) {
  switch (moduleKey) {
    case "thumbnail": return imageStrip(PROOFS);
    case "cinematic": return imageStrip(CINEMATIC_PROOFS);
    case "script": return textStrip(SCRIPT_PROOFS);
    case "metadata": return textStrip(META_PROOFS);
    case "topic-intel": return textStrip(TOPIC_PROOFS);
    case "narration":
      return (
        <div style={STRIP}>
          {VOICE_PROOFS.map((p) => (
            <div key={p.file} style={CARD}>
              <span style={DEVICE}>{p.device}</span>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- proof clip */}
              <audio controls preload="none" src={`/golden/voice/${p.file}`} style={{ width: "100%", height: 30 }} />
              <span style={METAT}>{p.meta}</span>
            </div>
          ))}
        </div>
      );
    case "documotion":
      return (
        <div style={{ ...STRIP, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {DOCU_PROOFS.map((p) => (
            <div key={p.file} style={CARD}>
              <span style={DEVICE}>{p.device}</span>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- proof clip */}
              <video controls preload="none" poster={`/golden/documotion/${p.file}.jpg`} src={`/golden/documotion/${p.file}.mp4`} style={{ width: "100%", borderRadius: 6, background: "#000" }} />
              <span style={METAT}>{p.meta}</span>
            </div>
          ))}
        </div>
      );
    case "motioncraft":
      return (
        <div style={{ ...STRIP, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
          {MOTION_PROOFS.map((p) => (
            <div key={p.file} style={CARD}>
              <span style={DEVICE}>{p.device}</span>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- proof clip */}
              <video controls preload="none" poster={`/golden/motioncraft/${p.file}.jpg`} src={`/golden/motioncraft/${p.file}.mp4`} style={{ width: "100%", borderRadius: 6, background: "#000" }} />
              <span style={METAT}>{p.meta}</span>
            </div>
          ))}
        </div>
      );
    case "whiteboard":
      return (
        <div style={STRIP}>
          <div style={{ ...CARD, gridColumn: "1 / -1" }}>
            <span style={DEVICE}>drawn cinema · narration-synced · 2K · $0 render</span>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- proof clip */}
            <video controls preload="none" poster="/golden/whiteboard/chiquita.jpg" src="/golden/whiteboard/chiquita.mp4" style={{ width: "100%", borderRadius: 6, background: "#000" }} />
            <span style={METAT}>Chiquita and the Banana Republic — every beat drawn in time with the voice</span>
          </div>
        </div>
      );
    case "comic":
      return (
        <div style={STRIP}>
          <div style={{ ...CARD, gridColumn: "1 / -1" }}>
            <span style={DEVICE}>3D drawn comic · real camera · multi-voice · 1080p · $0 render</span>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- proof clip */}
            <video controls preload="none" poster="/golden/comic/comic3d.jpg" src="/golden/comic/comic3d.mp4" style={{ width: "100%", borderRadius: 6, background: "#000" }} />
            <span style={METAT}>The Silent Night — the comic draws itself out in 3D, the page turns, every line voiced</span>
          </div>
        </div>
      );
    default: return null;
  }
}
