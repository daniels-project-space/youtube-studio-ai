import type { CSSProperties } from "react";
import { GOLDEN_MODULES, type GoldenModule } from "@/engine/golden";
import {
  catalogExecutionAvailability,
  catalogExecutionBinding,
  GOLDEN_PROMOTION_PROOFS,
} from "@/engine/goldenExecution";
import { certifiedFamilyAdmission } from "@/engine/certifiedFamilyAdmission";
import { FAMILIES, FAMILY_KEYS } from "@/engine/families";
import { MINIMUM_VIDEO_FOUNDATION_TEMPLATE } from "@/engine/minimumVideoFoundation";
import {
  goldenProofMediaExclusion,
  goldenProofMediaInventorySummary,
  goldenProofMediaPresentation,
  goldenProofMediaSuccessorQueue,
  type GoldenProofMediaKind,
  type GoldenProofMediaPresentation,
  type GoldenProofMediaSuccessorRequirement,
} from "@/engine/goldenProofMedia";
import { PageHeader } from "@/components/PageHeader";
import { ProductionRouteQualificationCard } from "@/components/ProductionRouteQualificationCard";
import { GoldenImages } from "./GoldenImages";

/* ============================ proof data ============================== *
 * Each module shows AT MOST its two best examples (take2). Arrays are
 * ordered best-first; the render slices to two.                          */

type ImageProof = {
  id: string;
  src: string;
  alt: string;
  status: GoldenProofMediaPresentation["status"];
  sha256: string;
};

function referenceMedia(id: string, kind: GoldenProofMediaKind): GoldenProofMediaPresentation {
  return goldenProofMediaPresentation(id, "reference", kind);
}

function contextMedia(id: string, kind: GoldenProofMediaKind): GoldenProofMediaPresentation {
  return goldenProofMediaPresentation(id, "context", kind);
}

function referenceImage(id: string, alt: string): ImageProof {
  const media = referenceMedia(id, "image");
  return { id: media.id, src: media.url, alt, status: media.status, sha256: media.sha256 };
}

function contextImage(id: string, alt: string): ImageProof {
  const media = contextMedia(id, "image");
  return { id: media.id, src: media.url, alt, status: media.status, sha256: media.sha256 };
}

const PROOFS: ImageProof[] = [
  referenceImage("thumbnail-drawn-image", "The Drawn Past — The Dancing Plague"),
  referenceImage("thumbnail-stoic-anger-image", "The Quiet Stoic — Anger Is Weakness"),
];

const CINEMATIC_PROOFS: ImageProof[] = [
  contextImage("cinematic-cash-image", "Legacy cinematic exploration — visible-face reference, not approved for faceless Casefile"),
  contextImage("cinematic-handshake-image", "Legacy cinematic exploration — visible-face reference, not approved for faceless Casefile"),
];

const CINEMATIC_IDENTITY_HOLD =
  "Reference hold: these legacy stills contain a distinctive photorealistic face. They are not an approved visual target for source-bound Casefile work. That route requires the reviewed faceless mannequin cast, wardrobe and prop locks, LTX clip review, exact edit binding, and a promoted multi-shot render before it can be shown as Golden evidence.";

interface VideoProof { media: GoldenProofMediaPresentation; poster?: GoldenProofMediaPresentation; device: string; meta: string }

function videoProof(mediaId: string, posterId: string, device: string, meta: string): VideoProof {
  return {
    media: referenceMedia(mediaId, "video"),
    poster: referenceMedia(posterId, "image"),
    device,
    meta,
  };
}

function contextClipProof(mediaId: string, posterId: string, device: string, meta: string): VideoProof {
  return {
    media: contextMedia(mediaId, "video"),
    poster: referenceMedia(posterId, "image"),
    device,
    meta,
  };
}

const DOCU_PROOFS: VideoProof[] = [
  videoProof("documotion-robbery-video", "documotion-robbery-image", "reference proxy · robbery noir · 720p", "The Vault — the Antwerp diamond heist"),
];

const FORDLANDIA_EXCLUSION = goldenProofMediaExclusion("documotion-fordlandia-video");
const DOCU_INTEGRITY_HOLD =
  `Integrity hold: ${FORDLANDIA_EXCLUSION.statusReason} It is not shown as Golden evidence. A fresh, attested render and promotion receipt are required before it can return.`;

const MOTION_PROOFS: VideoProof[] = [
  videoProof("motioncraft-hero-video", "motioncraft-hero-image", "reference proxy · hero_title · 720p", "\"Never fully solved\" — depth-parallax hero render"),
  videoProof("motioncraft-stats-video", "motioncraft-stats-image", "reference proxy · data_stats · 720p", "Ten layers · $100M · zero alarms — catalog sample, not a promotion receipt"),
];

const QUIZ_PROOFS: VideoProof[] = [
  contextClipProof("quiz-trivia-video", "quiz-trivia-image", "context-only visual design · mix below production floor", "Timer and answer-card layout is retained for visual context only; a reviewed audible mix is required before it can be Golden reference evidence"),
  contextClipProof("quiz-flag-video", "quiz-flag-image", "context-only visual design · silent mix excluded", "Flag reveal layout is retained for visual context only; a reviewed audible mix is required before it can be Golden reference evidence"),
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
  { device: "render parity · title/body", channel: "narrated essay", line: "hard cut · crossfade · dip to black", note: "real FFmpeg renders match the legacy composer byte-for-byte" },
];

const STUDIO_ASSET_PROOFS: TextProof[] = [
  { device: "owner-scoped record", channel: "compatible channel only", line: "camera / motion / prompt / treatment / presentation recipe", note: "treatment binds storyboard, motion, continuity and review locks; reuse requires matching approved evidence" },
  { device: "quality control", channel: "LTX / Comfy", line: "standard LoRA vs IC-LoRA control", note: "IC controls remain unavailable until exact workflow, guide, source bytes, licence, and benchmark agree" },
];

const CREW_PROOFS: TextProof[] = [
  { device: "preset · documentary", channel: "full crew", line: "director · DP · editor · composer · critic", note: "strict critic · slow cadence" },
  { device: "preset · lofi", channel: "minimal", line: "director · composer only", note: "no editor / critic" },
];

const VOICE_PROOFS: { media: GoldenProofMediaPresentation; device: string; meta: string }[] = [
  { media: referenceMedia("voice-stoic-audio", "audio"), device: "quiet-mentor · 0.95x", meta: "Brian — deep neutral-US" },
  { media: referenceMedia("voice-history-audio", "audio"), device: "narrator · 1.0x", meta: "George — storyteller" },
];

const LORESHORT_PROOFS: VideoProof[] = [
  videoProof("loreshort-smith4k-video", "loreshort-smith4k-image", "reference proxy · premium-lane source · 720p", "The smith forges the ring — proxy does not prove a 4K master"),
];

const NOVITA_PROOFS: VideoProof[] = [
  videoProof("novita-shot001-video", "novita-still001-image", "validation sample · image→i2v · 960×544 · not a promotion receipt", "Single 3.71-second camera-move sample from the Novita render farm — not channel-level production proof"),
];

const LOFI_PROOFS: { media: GoldenProofMediaPresentation; poster?: GoldenProofMediaPresentation; device: string; meta: string }[] = [
  { media: referenceMedia("lofi-beachcafe-image", "image"), device: "scene · beach cafe", meta: "Sunny terrace over a turquoise bay — host + cat, parasol, sailboats" },
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
  thumbnail: "Visual", "package-opening-proof": "Visual", visuals: "Visual", "studio-assets": "Visual", motioncraft: "Visual", inserts: "Visual", "imagecraft-novita": "Visual",
  narration: "Audio",
  layer: "Post-production", assemble: "Post-production", metadata: "Post-production", verify: "Post-production", "final-master-story-coverage": "Post-production", ship: "Post-production", "quiz-short-private-release": "Post-production",
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

function catalogStatusRank(status: GoldenModule["status"]): number {
  if (status === "reference") return 0;
  if (status === "registered") return 1;
  return 2;
}

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
  const media = goldenProofMediaInventorySummary();
  const mediaSuccessorQueue = goldenProofMediaSuccessorQueue();
  const admissions = FAMILY_KEYS.map((family) => certifiedFamilyAdmission(family));
  const automaticAdmissions = admissions.filter((admission) => admission.mode === "automatic");
  const supervisedAdmissions = admissions.filter((admission) => admission.mode === "supervised");
  const blockedAdmissions = admissions.filter((admission) => admission.mode === "blocked");
  const notPresentableMedia = media.historical + media.quarantined + media.duplicate;
  return (
    <>
      <PageHeader
        title="Golden Module Catalog"
        subtitle={`${GOLDEN_MODULES.length} modules · ${referenceCount} references · ${executableCount} executable bindings · ${receiptCount} promotion proofs. Evidence, execution, and creator admission remain separate.`}
      />
      <GoldenTruthOverview
        automatic={automaticAdmissions}
        supervised={supervisedAdmissions}
        blocked={blockedAdmissions}
        promotionProofCount={receiptCount}
        referenceMediaCount={media.reference}
        contextMediaCount={media.context}
        excludedMediaCount={notPresentableMedia}
        mediaSuccessorQueue={mediaSuccessorQueue}
      />
      <MinimumVideoFoundationOverview />
      {CATEGORY_ORDER.map((cat) => {
        const mods = GOLDEN_MODULES
          .filter((m) => (CATEGORY[m.key] ?? "Post-production") === cat)
          .sort((a, b) => catalogStatusRank(a.status) - catalogStatusRank(b.status));
        if (!mods.length) return null;
        const references = mods.filter((m) => m.status === "reference").length;
        return (
          <details
            key={cat}
            className="golden-category"
            aria-label={`${cat} Golden modules`}
          >
            <summary className="golden-category-summary">
              <span className="golden-category-copy">
                <strong>{cat}</strong>
                <span>{CATEGORY_BLURB[cat]}</span>
              </span>
              <span className="golden-category-count">
                {mods.length} modules · {references} references
              </span>
            </summary>
            <div className="golden-category-body">
              <div style={GRID}>
                {mods.map((m) => <ModuleCard key={m.key} module={m} />)}
              </div>
            </div>
          </details>
        );
      })}
    </>
  );
}

type FamilyAdmission = ReturnType<typeof certifiedFamilyAdmission>;

function GoldenTruthOverview({
  automatic,
  supervised,
  blocked,
  promotionProofCount,
  referenceMediaCount,
  contextMediaCount,
  excludedMediaCount,
  mediaSuccessorQueue,
}: {
  automatic: readonly FamilyAdmission[];
  supervised: readonly FamilyAdmission[];
  blocked: readonly FamilyAdmission[];
  promotionProofCount: number;
  referenceMediaCount: number;
  contextMediaCount: number;
  excludedMediaCount: number;
  mediaSuccessorQueue: readonly GoldenProofMediaSuccessorRequirement[];
}) {
  return (
    <section aria-label="Golden evidence and channel admission truth" className="glass" style={{ marginTop: "1.1rem", padding: "0.95rem" }}>
      <div style={{ display: "flex", gap: "0.65rem", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: "0.2rem", maxWidth: 690 }}>
          <span style={{ ...DEVICE, color: "var(--color-gold)" }}>TRUTH LAYER · EVIDENCE ≠ EXECUTION ≠ CHANNEL ADMISSION</span>
          <strong style={{ fontSize: "0.92rem", letterSpacing: "-0.015em" }}>What can be seen, what can run, and what a creator can actually start.</strong>
          <span style={{ fontSize: "0.74rem", lineHeight: 1.38, color: "var(--color-muted)" }}>
            Media below is manifest-bound reference or context material. A module earns Golden status only from a separate immutable promotion proof; a registered executable then still needs an admitted channel route.
          </span>
        </div>
        <span className="status-chip" style={{ whiteSpace: "nowrap" }}>{promotionProofCount === 0 ? "NO GOLDEN PROMOTIONS RECORDED" : `${promotionProofCount} PROMOTION PROOF${promotionProofCount === 1 ? "" : "S"} RECORDED`}</span>
      </div>

      <div style={TRUTH_METRIC_GRID}>
        <TruthMetric label="Promotion proof records" value={promotionProofCount} note="Required before a module may be called Golden" tone="warning" />
        <TruthMetric label="Manifest reference media" value={referenceMediaCount} note="Inspectable samples, never a promotion receipt" tone="gold" />
        <TruthMetric label="Context-only media" value={contextMediaCount} note="Visible with an explicit use limitation" tone="neutral" />
        <TruthMetric label="Not presentable" value={excludedMediaCount} note="Historical, quarantined, or duplicate bytes stay out of proof views" tone="neutral" />
      </div>

      <GoldenMediaSuccessorQueue items={mediaSuccessorQueue} />

      <div style={{ marginTop: "0.9rem", paddingTop: "0.8rem", borderTop: "1px solid var(--color-border)", display: "grid", gap: "0.55rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "baseline", flexWrap: "wrap" }}>
          <strong style={{ fontSize: "0.8rem" }}>Creator channel admission</strong>
          <span style={{ ...METAT, fontSize: "0.58rem" }}>CERTIFIED FAMILY ADMISSION · LIVE CATALOG EVALUATION</span>
        </div>
        <div style={ADMISSION_GRID}>
          <AdmissionGroup mode="automatic" title="Automatic" admissions={automatic} />
          <AdmissionGroup mode="supervised" title="Supervised / private" admissions={supervised} />
          <AdmissionGroup mode="blocked" title="Blocked" admissions={blocked} />
        </div>
        <ProductionRouteQualificationCard
          unavailableMessage="No persisted per-channel qualification receipt is connected to the Golden catalog. The family-admission groups above are live catalog policy, not a live route qualification."
        />
      </div>
    </section>
  );
}

function GoldenMediaSuccessorQueue({ items }: { items: readonly GoldenProofMediaSuccessorRequirement[] }) {
  return (
    <details className="golden-audit-disclosure">
      <summary>
        <span>
          <strong>Legacy video successor queue</strong>
          <small>CATALOG AUDIT · NO YOUTUBE REPLACEMENT ACTION</small>
        </span>
        <b>{items.length}</b>
      </summary>
      <div className="golden-audit-body">
        <p>
          Retained context or quarantined samples need a repaired successor render before they can become Golden evidence. Archive bytes remain preserved; no existing upload is changed here.
        </p>
        <div className="golden-audit-grid">
          {items.map((item) => (
            <article key={item.id}>
              <span style={{ ...DEVICE, color: item.status === "quarantined" ? "var(--color-danger)" : "var(--color-gold)" }}>
                {item.status.toUpperCase()} · {item.family}
              </span>
              <strong>{item.id}</strong>
              <span>{item.reason}</span>
              <span>{item.requiredOutcome}</span>
              <small>SHA-256 {item.sha256.slice(0, 12)}</small>
            </article>
          ))}
        </div>
      </div>
    </details>
  );
}

/**
 * This is intentionally sourced from the exact engine registry that designers
 * and runtime admission validate. Golden modules can extend this baseline, but
 * they can never substitute for it.
 */
function MinimumVideoFoundationOverview() {
  return (
    <details
      aria-label="Universal video foundation"
      className="glass golden-foundation"
    >
      <summary className="golden-foundation-summary">
        <span>
          <small>Universal video foundation · engine-enforced</small>
          <strong>The baseline every automatic channel must keep</strong>
        </span>
        <b>{MINIMUM_VIDEO_FOUNDATION_TEMPLATE.length} NON-NEGOTIABLE STAGES</b>
      </summary>
      <div className="golden-foundation-body">
        <p>
          A format can add its own craft—storyboard, references, animation, music,
          evidence, or visual treatment—but it cannot omit this shared production core.
        </p>
        <ol>
          {MINIMUM_VIDEO_FOUNDATION_TEMPLATE.map((stage, index) => (
            <li key={stage.key}>
              <span aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{stage.title}</strong>
                <small>{stage.requirement}</small>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

function TruthMetric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number;
  note: string;
  tone: "gold" | "warning" | "neutral";
}) {
  const color = tone === "gold" ? "var(--color-gold)" : tone === "warning" ? "var(--color-warning)" : "var(--color-secondary)";
  return (
    <div style={{ ...CARD, minHeight: 91, borderColor: tone === "warning" ? "rgba(245,158,11,0.36)" : undefined }}>
      <span style={{ ...DEVICE, color }}>{label}</span>
      <strong style={{ fontSize: "1.18rem", lineHeight: 1, color }}>{value}</strong>
      <span style={{ fontSize: "0.66rem", lineHeight: 1.35, color: "var(--color-muted)" }}>{note}</span>
    </div>
  );
}

function AdmissionGroup({
  mode,
  title,
  admissions,
}: {
  mode: FamilyAdmission["mode"];
  title: string;
  admissions: readonly FamilyAdmission[];
}) {
  const tone = mode === "automatic" ? "var(--color-ok)" : mode === "supervised" ? "var(--color-gold)" : "var(--color-warning)";
  const emptyMessage = mode === "supervised" ? "No private-review family is registered." : mode === "blocked" ? "No families are blocked." : "No automatic family is admitted.";
  return (
    <div style={{ ...CARD, gap: "0.45rem", alignContent: "start", borderColor: `color-mix(in srgb, ${tone} 40%, var(--color-border))` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.4rem" }}>
        <span style={{ ...DEVICE, color: tone }}>{title}</span>
        <strong style={{ fontSize: "0.88rem", color: tone }}>{admissions.length}</strong>
      </div>
      {admissions.length === 0 ? (
        <span style={{ fontSize: "0.68rem", color: "var(--color-muted)" }}>{emptyMessage}</span>
      ) : (
        <div style={{ display: "grid", gap: "0.38rem" }}>
          {admissions.map((admission) => {
            const family = FAMILIES[admission.family];
            const detail = mode === "automatic"
              ? `${admission.routeKeys.length} certified route${admission.routeKeys.length === 1 ? "" : "s"}`
              : mode === "supervised"
                ? admission.reviewScope === "private_human_child_editor_review_only"
                  ? "Private child-editor review only"
                  : "Private human review only"
                : admission.blockers[0] ?? "Automatic admission is not registered.";
            return (
              <div key={admission.family} title={detail} style={{ display: "grid", gap: "0.1rem", paddingTop: "0.35rem", borderTop: "1px solid var(--color-border)" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--color-fg)" }}>{family.label}</span>
                <span style={{ ...METAT, lineHeight: 1.32, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{detail}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
  gap: "0.7rem",
  marginTop: "0.5rem",
};

const TRUTH_METRIC_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
  gap: "0.5rem",
  marginTop: "0.75rem",
};

const ADMISSION_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: "0.5rem",
};

/* ----------------------------- module card ----------------------------- */

function ModuleCard({ module: m }: { module: GoldenModule }) {
  const isReference = m.status === "reference";
  const isRegistered = m.status === "registered";
  const execution = catalogExecutionBinding(m.key);
  const availability = catalogExecutionAvailability(execution);
  const promotionProof = GOLDEN_PROMOTION_PROOFS[m.key];
  const executionIsWarning = execution.kind === "catalog-only" || execution.kind === "registered-private-release";
  return (
    <article className={`glass lift${isReference ? " golden-glow" : ""}`} style={{ padding: "0.8rem 0.9rem", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.4rem", marginBottom: "0.35rem" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.56rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-faint)" }}>{m.stage}</span>
        {isReference
          ? <span className="golden-chip">REFERENCE CANDIDATE</span>
          : isRegistered
            ? <span className="status-chip">REGISTERED · NO INTAKE</span>
            : <span className="status-chip">ACTIVE</span>}
      </div>

      <h3 style={{ margin: 0, fontSize: "0.96rem", fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.2 }}>{m.title}</h3>
      <div style={{ marginTop: "0.25rem", fontFamily: "var(--font-mono)", fontSize: "0.56rem", color: executionIsWarning ? "var(--color-warning)" : "var(--color-secondary)" }}>
        {execution.kind === "pipeline-module"
          ? `EXECUTABLE BINDING · ${execution.executableIds.join(" · ")} · NOT PROMOTED`
          : execution.kind === "registered-private-release"
            ? `REGISTERED PRIVATE-RELEASE BLOCK · ${execution.executableIds.join(" · ")} · NO OWNER INTAKE · NOT ROUTE-EXECUTABLE`
            : execution.kind === "external-task"
              ? `EXTERNAL TASK · ${execution.executableIds.join(" · ")} · NOT PROMOTED`
            : "CATALOG ONLY · NOT COMPILER-EXECUTABLE · NOT PROMOTED"}
      </div>
      <div style={{ marginTop: "0.25rem", display: "grid", gap: "0.13rem", padding: "0.35rem 0.45rem", borderRadius: 6, background: "var(--color-surface-solid)", border: "1px solid var(--color-border)" }}>
        <span style={{ ...DEVICE, color: availability.state === "blocked" ? "var(--color-warning)" : availability.state === "private-review-only" ? "var(--color-gold)" : "var(--color-secondary)" }}>{availability.label}</span>
        <span style={{ fontSize: "0.64rem", lineHeight: 1.32, color: "var(--color-muted)" }}>{availability.detail}</span>
        <span style={{ ...METAT, marginTop: "0.04rem" }}>
          PROMOTION EVIDENCE · {promotionProof ? `RECORD ${promotionProof.verifiedAt}` : "NO PRODUCTION-PROMOTION RECEIPT RECORDED"}
        </span>
      </div>
      <p style={{ margin: "0.3rem 0 0.5rem", fontSize: "0.78rem", lineHeight: 1.4, color: "var(--color-secondary)" }}>{blurb(m.how)}</p>

      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "0.22rem" }}>
        {m.gates.slice(0, 3).map((g) => (
          <li key={g} style={{ display: "flex", gap: "0.4rem", alignItems: "baseline", fontSize: "0.7rem", lineHeight: 1.3, color: "var(--color-muted)" }}>
            <span style={{ color: isReference || isRegistered ? "var(--color-gold)" : "var(--color-secondary)", fontSize: "0.62rem", flex: "0 0 auto" }}>▪</span>
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

function MediaArtifactLabel({ media }: { media: GoldenProofMediaPresentation }) {
  const label = media.status === "context" ? "CONTEXT ONLY" : "MANIFEST REFERENCE";
  return (
    <span style={{ ...METAT, color: media.status === "context" ? "var(--color-warning)" : "var(--color-faint)" }}>
      {label} · {media.id} · SHA-256 {media.sha256.slice(0, 12)}…
    </span>
  );
}

function videoStrip(items: readonly VideoProof[]) {
  return (
    <div style={STRIP}>
      {take2(items).map((p) => (
        <div key={p.media.id} style={CARD}>
          <span style={DEVICE}>{p.device}</span>
          { }
          <video controls preload="none" poster={p.poster?.url} src={p.media.url} style={MEDIA} />
          <MediaArtifactLabel media={p.media} />
          <span style={METAT}>{p.meta}</span>
        </div>
      ))}
    </div>
  );
}

function PackageOpeningEvidenceStrip() {
  const stages = [
    {
      label: "01 · PACKAGE",
      title: "Plan sealed",
      detail: "Title · cover brief · topic · route · declared opening anchor",
    },
    {
      label: "02 · COVER",
      title: "Bytes locked",
      detail: "Cover request carries the plan fingerprint; retry verification re-hashes the uploaded image",
    },
    {
      label: "03 · OPENING",
      title: "Master witnessed",
      detail: "Final master + retained opening review frame bind to the same plan",
    },
  ];
  return (
    <div aria-label="Structural package-to-opening evidence flow; not semantic equivalence proof" style={STRIP}>
      {stages.map((stage, index) => (
        <div key={stage.label} style={{ ...CARD, position: "relative", overflow: "hidden", minHeight: 106 }}>
          <span style={DEVICE}>{stage.label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.38rem", minHeight: 35 }}>
            <span aria-hidden="true" style={{ display: "grid", width: 28, height: 28, placeItems: "center", borderRadius: 999, color: "#071018", background: "var(--color-gold)", fontFamily: "var(--font-mono)", fontSize: "0.66rem", fontWeight: 700 }}>
              {index + 1}
            </span>
            <strong style={{ fontSize: "0.76rem", letterSpacing: "-0.01em" }}>{stage.title}</strong>
          </div>
          <span style={LINE3}>{stage.detail}</span>
          <span style={METAT}>{index === 2 ? "STRUCTURAL WITNESS · NOT A SEMANTIC JUDGE" : "CONTENT-ADDRESSED RECEIPT"}</span>
        </div>
      ))}
    </div>
  );
}

function NarratedStoryCoverageStrip() {
  const stages = [
    {
      label: "01 · PLAN",
      title: "Story Spine",
      detail: "Validated beats, sentences, timing and planned shot lineage",
      note: "PLAN PROVENANCE",
    },
    {
      label: "02 · MASTER",
      title: "Every word",
      detail: "Timestamped final-master narration audit bound to the reviewed video",
      note: "MASTER-BOUND AUDIT",
    },
    {
      label: "03 · COVERAGE",
      title: "85% / 95% floors",
      detail: "Each beat calibrated; duration-weighted story delivery must clear the total floor",
      note: "NARRATION-SEMANTIC ONLY",
    },
    {
      label: "04 · RELEASE",
      title: "Retry-safe sidecar",
      detail: "Content-addressed audit retained and revalidated with the release certificate",
      note: "NOT VISUAL-SHOT PROOF",
    },
  ];
  return (
    <div aria-label="Final-master narrated-story coverage evidence flow; not visual shot-realization proof" style={STRIP}>
      {stages.map((stage, index) => (
        <div key={stage.label} style={{ ...CARD, position: "relative", overflow: "hidden", minHeight: 106 }}>
          <span style={DEVICE}>{stage.label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.38rem", minHeight: 35 }}>
            <span aria-hidden="true" style={{ display: "grid", width: 28, height: 28, placeItems: "center", borderRadius: 999, color: "#071018", background: "var(--color-gold)", fontFamily: "var(--font-mono)", fontSize: "0.66rem", fontWeight: 700 }}>
              {index + 1}
            </span>
            <strong style={{ fontSize: "0.76rem", letterSpacing: "-0.01em" }}>{stage.title}</strong>
          </div>
          <span style={LINE3}>{stage.detail}</span>
          <span style={METAT}>{stage.note}</span>
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
    case "loreshort": return videoStrip(LORESHORT_PROOFS);
    case "novita-render-farm": return videoStrip(NOVITA_PROOFS);
    case "quiz": return videoStrip(QUIZ_PROOFS);
    case "cinematic": return (
      <>
        <p role="status" style={{ margin: "0.5rem 0 0", fontFamily: "var(--font-mono)", fontSize: "0.56rem", letterSpacing: "0.06em", color: "var(--color-warning)" }}>
          CONTEXT ONLY · NOT GOLDEN EVIDENCE
        </p>
        <GoldenImages images={take2(CINEMATIC_PROOFS)} />
        <p role="status" style={{ margin: "0.5rem 0 0", fontSize: "0.68rem", lineHeight: 1.35, color: "var(--color-warning)" }}>
          {CINEMATIC_IDENTITY_HOLD}
        </p>
      </>
    );
    case "documotion":
      return (
        <>
          {videoStrip(DOCU_PROOFS)}
          <p role="status" style={{ margin: "0.5rem 0 0", fontSize: "0.68rem", lineHeight: 1.35, color: "var(--color-warning)" }}>
            {DOCU_INTEGRITY_HOLD}
          </p>
        </>
      );
    case "speech-tv":
      return textStrip([
        {
          device: "historical source excluded",
          channel: "Speech / archival",
          line: "No current Golden video proof",
          note: "Retained archival-footage sample has no rights-bound release receipt; a current speech lane requires independently licensed source media and final-master evidence.",
        },
      ]);
    case "shorts": return textStrip(SHORTS_PROOFS);
    case "lofi":
      return (
        <div style={STRIP}>
          {take2(LOFI_PROOFS).map((p) => (
            <div key={p.media.id} style={CARD}>
              <span style={DEVICE}>{p.device}</span>
              {p.media.kind === "video" ? (

                <video controls preload="none" poster={p.poster?.url} src={p.media.url} style={MEDIA} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- static proof still
                <img src={p.media.url} alt={p.meta} style={{ ...MEDIA, display: "block" }} />
              )}
              <MediaArtifactLabel media={p.media} />
              <span style={METAT}>{p.meta}</span>
            </div>
          ))}
        </div>
      );
    case "whiteboard": {
      const clip = referenceMedia("whiteboard-chiquita-video", "video");
      const poster = referenceMedia("whiteboard-chiquita-image", "image");
      return (
        <div style={STRIP}>
          <div style={{ ...CARD, gridColumn: "1 / -1" }}>
            <span style={DEVICE}>reference proxy · drawn cinema · 720p</span>
            { }
            <video controls preload="none" poster={poster.url} src={clip.url} style={MEDIA} />
            <MediaArtifactLabel media={clip} />
            <span style={METAT}>Chiquita and the Banana Republic — every beat drawn in time with the voice</span>
          </div>
        </div>
      );
    }
    case "comic": {
      const clip = contextMedia("comic-comic3d-video", "video");
      const poster = contextMedia("comic-comic3d-image", "image");
      return (
        <div style={STRIP}>
          <div style={{ ...CARD, gridColumn: "1 / -1" }}>
            <span style={{ ...DEVICE, color: "var(--color-warning)" }}>context-only · retained 3D drawn comic · 1080p</span>
            { }
            <video controls preload="none" poster={poster.url} src={clip.url} style={MEDIA} />
            <MediaArtifactLabel media={clip} />
            <span style={{ ...METAT, color: "var(--color-warning)" }}>Legacy sample retained for craft context only: its blank opening disqualifies it as Golden proof until a fresh reviewed master replaces it.</span>
          </div>
        </div>
      );
    }
    // visual
    case "thumbnail": return <GoldenImages images={take2(PROOFS)} />;
    case "studio-assets": return textStrip(STUDIO_ASSET_PROOFS);
    case "package-opening-proof": return <PackageOpeningEvidenceStrip />;
    case "motioncraft": return videoStrip(MOTION_PROOFS);
    // audio
    case "narration":
      return (
        <div style={STRIP}>
          {take2(VOICE_PROOFS).map((p) => (
            <div key={p.media.id} style={CARD}>
              <span style={DEVICE}>{p.device}</span>
              { }
              <audio controls preload="none" src={p.media.url} style={{ width: "100%", height: 30 }} />
              <MediaArtifactLabel media={p.media} />
              <span style={METAT}>{p.meta}</span>
            </div>
          ))}
        </div>
      );
    // post-production
    case "assemble": return textStrip(ASSEMBLY_PROOFS);
    case "metadata": return textStrip(META_PROOFS);
    case "final-master-story-coverage": return <NarratedStoryCoverageStrip />;
    default: return null;
  }
}
