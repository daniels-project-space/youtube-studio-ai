import type { CSSProperties } from "react";
import { GOLDEN_MODULES, type GoldenModule } from "@/engine/golden";
import {
  catalogExecutionBinding,
  GOLDEN_PROMOTION_PROOFS,
} from "@/engine/goldenExecution";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { GoldenImages } from "./GoldenImages";

/* ============================ proof data ============================== *
 * Each module shows AT MOST its two best examples (take2). Arrays are
 * ordered best-first; the render slices to two.                          */

const PROOFS: { src: string; alt: string }[] = [
  { src: "drawn.jpg", alt: "The Drawn Past — The Dancing Plague" },
  { src: "stoic_anger.jpg", alt: "The Quiet Stoic — Anger Is Weakness" },
];

const CINEMATIC_PROOFS: { src: string; alt: string }[] = [
  { src: "cinematic/cash.jpg", alt: "Legacy cinematic exploration — visible-face reference, not approved for faceless Casefile" },
  { src: "cinematic/handshake.jpg", alt: "Legacy cinematic exploration — visible-face reference, not approved for faceless Casefile" },
];

const CINEMATIC_IDENTITY_HOLD =
  "Reference hold: these legacy stills contain a distinctive photorealistic face. They are not an approved visual target for source-bound Casefile work. That route requires the reviewed faceless mannequin cast, wardrobe and prop locks, LTX clip review, exact edit binding, and a promoted multi-shot render before it can be shown as Golden evidence.";

interface VideoProof { file: string; poster?: string; device: string; meta: string }

const DOCU_PROOFS: VideoProof[] = [
  { file: "robbery", device: "reference proxy · robbery noir · 720p", meta: "The Vault — the Antwerp diamond heist" },
];

const DOCU_INTEGRITY_HOLD =
  "Integrity hold: the historical Fordlandia proxy failed the black-tail screen (picture drops while narration continues), so it is not shown as Golden evidence. A fresh, attested render and promotion receipt are required before it can return.";

const MOTION_PROOFS: VideoProof[] = [
  { file: "hero", device: "reference proxy · hero_title · 720p", meta: "\"Never fully solved\" — depth-parallax hero render" },
  { file: "stats", device: "reference proxy · data_stats · 720p", meta: "Ten layers · $100M · zero alarms — catalog sample, not a promotion receipt" },
];

const QUIZ_PROOFS: VideoProof[] = [
  { file: "trivia", device: "reference proxy · common-knowledge · 720p", meta: "\"Capital of France?\" — timer and answer-card sample" },
  { file: "flag", device: "reference proxy · flag-guess · 720p", meta: "Flag reveal sample; no executable promotion receipt" },
];

const SPEECH_PROOFS: VideoProof[] = [
  { file: "steve-jobs", device: "reference proxy · motivation-speech · 720p", meta: "Steve Jobs · Stanford 2005 — caption-sync sample" },
];

interface TextProof { device: string; channel: string; line: string; note: string }

const SCRIPT_PROOFS: TextProof[] = [
  { device: "reference · cold_open", channel: "The Drawn Past", line: "Frau Troffea steps into a Strasbourg street and begins to twitch. She will not stop for six days.", note: "sample only · no proof receipt" },
  { device: "reference · myth_snap", channel: "Empires at War", line: "The Roman Empire did not fall in a fiery battle. It bled out over two hundred years of self-inflicted wounds.", note: "sample only · no proof receipt" },
];

const META_PROOFS: TextProof[] = [
  { device: "reference · direct", channel: "The Quiet Stoic", line: "Anger is the ultimate form of self-destruction.", note: "sample only · no proof receipt" },
  { device: "reference · contrarian", channel: "Empires at War", line: "Barbarian Hordes Did Not Destroy the Roman Empire", note: "sample only · no proof receipt" },
];

const TOPIC_PROOFS: TextProof[] = [
  { device: "reference · hero", channel: "Antiquity Files", line: "Eric Cline's perfect storm that ended the Bronze Age", note: "sample only · no proof receipt" },
  { device: "reference · hub", channel: "The Quiet Stoa", line: "Detaching from the opinions of others", note: "sample only · no proof receipt" },
];

const ASSEMBLY_PROOFS: TextProof[] = [
  { device: "preset · documentary", channel: "history / doc", line: "slow cuts · chapter cards · crossfade transitions", note: "16:9 · −14 LUFS" },
  { device: "preset · shorts", channel: "vertical shorts", line: "9:16 · frenetic ~4s cuts · no cards · subject reframe", note: "tail 1s" },
];

const CREW_PROOFS: TextProof[] = [
  { device: "preset · documentary", channel: "full crew", line: "director · DP · editor · composer · critic", note: "strict critic · slow cadence" },
  { device: "preset · lofi", channel: "minimal", line: "director · composer only", note: "no editor / critic" },
];

const VOICE_PROOFS: { file: string; device: string; meta: string }[] = [
  { file: "stoic.mp3", device: "quiet-mentor · 0.95x", meta: "Brian — deep neutral-US" },
  { file: "history.mp3", device: "narrator · 1.0x", meta: "George — storyteller" },
];

const LORESHORT_PROOFS: VideoProof[] = [
  { file: "lotr", device: "reference proxy · watercolour+pencil · 720p", meta: "The Rings of Power — first-person loremaster sample" },
  { file: "smith4k", device: "reference proxy · premium-lane source · 720p", meta: "The smith forges the ring — proxy does not prove a 4K master" },
];

const NOVITA_PROOFS: VideoProof[] = [
  {
    file: "shot001",
    poster: "still001",
    device: "validation sample · image→i2v · 960×544 · not a promotion receipt",
    meta: "Single 3.71-second camera-move sample from the Novita render farm — not channel-level production proof",
  },
];

const LOFI_PROOFS: { file: string; kind: "video" | "image"; device: string; meta: string }[] = [
  { file: "meadow", kind: "video", device: "reference proxy · ghibli meadow · 720p/24s", meta: "Hillside meadow sample — proxy does not prove the declared 30s seamless-loop gate" },
  { file: "beachcafe", kind: "image", device: "scene · beach cafe", meta: "Sunny terrace over a turquoise bay — host + cat, parasol, sailboats" },
];

/* ---- net-new modules (no render proof yet — honest text examples) ---- */

const PLANNER_PROOFS: TextProof[] = [
  { device: "plan-week · pre-built", channel: "next 5 videos", line: "Topic + thumbnail + description staged into the board — generating → ready → used", note: "built before the slot" },
  { device: "scheduled · native", channel: "fixed calendar", line: "A pinned scheduledAt becomes the YouTube native publish date — the channel releases on schedule", note: "scheduler consumes next ready item" },
];

const SHORTS_PROOFS: TextProof[] = [
  { device: "pipeline · EXISTS", channel: "template D · 9:16", line: "<50s script → hook → originality+compliance → 9:16 footage → ~4s cuts + karaoke captions", note: "end-to-end, runs today" },
  { device: "promotion gaps", channel: "reference only", line: "Needs a validated render, verified subject-track reframe, and the longform→Short repurposer enabled", note: "then it can request a promotion receipt" },
];

/* ============================ categories ============================= */

const CATEGORY: Record<string, string> = {
  "channel-planner": "Pre-production", "topic-intel": "Pre-production", "show-bible": "Pre-production", script: "Pre-production", guard: "Pre-production",
  loreshort: "Video Engines", lofi: "Video Engines", quiz: "Video Engines", cinematic: "Video Engines", documotion: "Video Engines", "speech-tv": "Video Engines", whiteboard: "Video Engines", comic: "Video Engines", shorts: "Video Engines", "videocraft-novita": "Video Engines",
  thumbnail: "Visual", visuals: "Visual", motioncraft: "Visual", inserts: "Visual", "imagecraft-novita": "Visual",
  narration: "Audio",
  layer: "Post-production", assemble: "Post-production", metadata: "Post-production", verify: "Post-production", ship: "Post-production",
};
const CATEGORY_ORDER = ["Pre-production", "Video Engines", "Visual", "Audio", "Post-production"];
const CATEGORY_BLURB: Record<string, string> = {
  "Pre-production": "Plan the channel, pick the topic, write and clear the script.",
  "Video Engines": "The standalone formats — each one a complete kind of video.",
  Visual: "The visual layers laid into every video.",
  Audio: "The narrated voice.",
  "Post-production": "Assemble, caption, label, QA, and ship.",
};

/** Short "what it does" line — first sentence of the honest `how`. */
function blurb(how: string): string {
  const first = how.split(/\.\s/)[0].trim();
  return first.endsWith(".") ? first : first + ".";
}
function take2<T>(xs: readonly T[]): T[] { return xs.slice(0, 2); }

/**
 * Golden Pipeline — a compact, clustered render of the GOLDEN_MODULES registry.
 * Each module: a short description, how-it-works bullets, and up to two of its
 * best examples. The engine and this page share one source of truth.
 */
export default function GoldenPipelinePage() {
  const referenceCount = GOLDEN_MODULES.filter((m) => m.status === "reference").length;
  const executableCount = GOLDEN_MODULES.filter(
    (m) => catalogExecutionBinding(m.key).kind === "pipeline-module",
  ).length;
  const receiptCount = Object.keys(GOLDEN_PROMOTION_PROOFS).length;
  return (
    <>
      <PageHeader
        title="Golden Module Catalog"
        subtitle={`${referenceCount} reference entries · ${executableCount} executable bindings · ${receiptCount} production-promotion receipts. Reference media is not certification.`}
      />
      {CATEGORY_ORDER.map((cat) => {
        const mods = GOLDEN_MODULES
          .filter((m) => (CATEGORY[m.key] ?? "Post-production") === cat)
          .sort((a, b) => (a.status === b.status ? 0 : a.status === "reference" ? -1 : 1));
        if (!mods.length) return null;
        const references = mods.filter((m) => m.status === "reference").length;
        return (
          <section key={cat} style={{ marginTop: "1.4rem" }}>
            <SectionTitle>
              {cat}{" "}
              <span style={{ color: "var(--color-faint)", fontWeight: 400 }}>
                · {references}/{mods.length} reference samples · {CATEGORY_BLURB[cat]}
              </span>
            </SectionTitle>
            <div style={GRID}>
              {mods.map((m) => <ModuleCard key={m.key} module={m} />)}
            </div>
          </section>
        );
      })}
    </>
  );
}

const GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
  gap: "0.7rem",
  marginTop: "0.5rem",
};

/* ----------------------------- module card ----------------------------- */

function ModuleCard({ module: m }: { module: GoldenModule }) {
  const isReference = m.status === "reference";
  const execution = catalogExecutionBinding(m.key);
  return (
    <article className={`glass lift${isReference ? " golden-glow" : ""}`} style={{ padding: "0.8rem 0.9rem", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4rem", marginBottom: "0.35rem" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.56rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-faint)" }}>{m.stage}</span>
        {isReference ? <span className="golden-chip">REFERENCE PROOF</span> : <span className="status-chip">ACTIVE</span>}
      </div>

      <h3 style={{ margin: 0, fontSize: "0.96rem", fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.2 }}>{m.title}</h3>
      <div style={{ marginTop: "0.25rem", fontFamily: "var(--font-mono)", fontSize: "0.56rem", color: execution.kind === "catalog-only" ? "var(--color-warning)" : "var(--color-secondary)" }}>
        {execution.kind === "pipeline-module"
          ? `EXECUTABLE BINDING · ${execution.executableIds.join(" · ")} · NOT PROMOTED`
          : execution.kind === "external-task"
            ? `EXTERNAL TASK · ${execution.executableIds.join(" · ")} · NOT PROMOTED`
            : "CATALOG ONLY · NOT COMPILER-EXECUTABLE · NOT PROMOTED"}
      </div>
      <p style={{ margin: "0.3rem 0 0.5rem", fontSize: "0.78rem", lineHeight: 1.4, color: "var(--color-secondary)" }}>{blurb(m.how)}</p>

      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.22rem" }}>
        {m.gates.slice(0, 3).map((g) => (
          <li key={g} style={{ display: "flex", gap: "0.4rem", alignItems: "baseline", fontSize: "0.7rem", lineHeight: 1.3, color: "var(--color-muted)" }}>
            <span style={{ color: isReference ? "var(--color-gold)" : "var(--color-secondary)", fontSize: "0.62rem", flex: "0 0 auto" }}>▪</span>
            <span>{g}</span>
          </li>
        ))}
      </ul>

      <ProofStrip moduleKey={m.key} />
    </article>
  );
}

/* ----------------------------- proof strips ---------------------------- */

const STRIP: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.4rem", marginTop: "0.65rem", paddingTop: "0.6rem", borderTop: "1px solid var(--color-border)" };
const CARD: CSSProperties = { background: "var(--color-surface-solid)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "0.4rem 0.5rem", display: "grid", gap: "0.2rem" };
const DEVICE: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.54rem", letterSpacing: "0.04em", color: "var(--color-gold)", textTransform: "uppercase" };
const LINE3: CSSProperties = { fontSize: "0.7rem", lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" };
const METAT: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.54rem", color: "var(--color-faint)" };
const MEDIA: CSSProperties = { width: "100%", borderRadius: 5, background: "#000" };

function textStrip(items: TextProof[]) {
  return (
    <div style={STRIP}>
      {take2(items).map((p, i) => (
        <div key={i} style={CARD}>
          <span style={DEVICE}>{p.device}</span>
          <span style={LINE3}>{p.line}</span>
          <span style={METAT}>{p.channel} · {p.note}</span>
        </div>
      ))}
    </div>
  );
}

function videoStrip(base: string, items: readonly VideoProof[]) {
  return (
    <div style={STRIP}>
      {take2(items).map((p) => (
        <div key={p.file} style={CARD}>
          <span style={DEVICE}>{p.device}</span>
          { }
          <video controls preload="none" poster={`/golden/${base}/${p.poster ?? p.file}.jpg`} src={`/golden/${base}/${p.file}.mp4`} style={MEDIA} />
          <span style={METAT}>{p.meta}</span>
        </div>
      ))}
    </div>
  );
}

function ProofStrip({ moduleKey }: { moduleKey: string }) {
  switch (moduleKey) {
    // pre-production
    case "channel-planner": return textStrip(PLANNER_PROOFS);
    case "topic-intel": return textStrip(TOPIC_PROOFS);
    case "show-bible": return textStrip(CREW_PROOFS);
    case "script": return textStrip(SCRIPT_PROOFS);
    // video engines
    case "loreshort": return videoStrip("loreshort", LORESHORT_PROOFS);
    case "novita-render-farm": return videoStrip("novita-render-farm", NOVITA_PROOFS);
    case "quiz": return videoStrip("quiz", QUIZ_PROOFS);
    case "cinematic": return (
      <>
        <GoldenImages images={take2(CINEMATIC_PROOFS)} />
        <p role="status" style={{ margin: "0.5rem 0 0", fontSize: "0.68rem", lineHeight: 1.35, color: "var(--color-warning)" }}>
          {CINEMATIC_IDENTITY_HOLD}
        </p>
      </>
    );
    case "documotion":
      return (
        <>
          {videoStrip("documotion", DOCU_PROOFS)}
          <p role="status" style={{ margin: "0.5rem 0 0", fontSize: "0.68rem", lineHeight: 1.35, color: "var(--color-warning)" }}>
            {DOCU_INTEGRITY_HOLD}
          </p>
        </>
      );
    case "speech-tv": return videoStrip("speech", SPEECH_PROOFS);
    case "shorts": return textStrip(SHORTS_PROOFS);
    case "lofi":
      return (
        <div style={STRIP}>
          {take2(LOFI_PROOFS).map((p) => (
            <div key={p.file} style={CARD}>
              <span style={DEVICE}>{p.device}</span>
              {p.kind === "video" ? (

                <video controls preload="none" poster={`/golden/lofi/${p.file}.jpg`} src={`/golden/lofi/${p.file}.mp4`} style={MEDIA} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- static proof still
                <img src={`/golden/lofi/${p.file}.jpg`} alt={p.meta} style={{ ...MEDIA, display: "block" }} />
              )}
              <span style={METAT}>{p.meta}</span>
            </div>
          ))}
        </div>
      );
    case "whiteboard":
      return (
        <div style={STRIP}>
          <div style={{ ...CARD, gridColumn: "1 / -1" }}>
            <span style={DEVICE}>reference proxy · drawn cinema · 720p</span>
            { }
            <video controls preload="none" poster="/golden/whiteboard/chiquita.jpg" src="/golden/whiteboard/chiquita.mp4" style={MEDIA} />
            <span style={METAT}>Chiquita and the Banana Republic — every beat drawn in time with the voice</span>
          </div>
        </div>
      );
    case "comic":
      return (
        <div style={STRIP}>
          <div style={{ ...CARD, gridColumn: "1 / -1" }}>
            <span style={DEVICE}>reference proxy · 3D drawn comic · 1080p</span>
            { }
            <video controls preload="none" poster="/golden/comic/comic3d.jpg" src="/golden/comic/comic3d.mp4" style={MEDIA} />
            <span style={METAT}>The Silent Night — the comic draws itself out in 3D, the page turns, every line voiced</span>
          </div>
        </div>
      );
    // visual
    case "thumbnail": return <GoldenImages images={take2(PROOFS)} />;
    case "motioncraft": return videoStrip("motioncraft", MOTION_PROOFS);
    // audio
    case "narration":
      return (
        <div style={STRIP}>
          {take2(VOICE_PROOFS).map((p) => (
            <div key={p.file} style={CARD}>
              <span style={DEVICE}>{p.device}</span>
              { }
              <audio controls preload="none" src={`/golden/voice/${p.file}`} style={{ width: "100%", height: 30 }} />
              <span style={METAT}>{p.meta}</span>
            </div>
          ))}
        </div>
      );
    // post-production
    case "assemble": return textStrip(ASSEMBLY_PROOFS);
    case "metadata": return textStrip(META_PROOFS);
    default: return null;
  }
}
