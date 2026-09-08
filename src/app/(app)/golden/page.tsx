import { OwnerLockBadge } from "@/components/OwnerLockBadge";
import Link from "next/link";
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
import { ProductionRouteQualificationCard } from "@/components/ProductionRouteQualificationCard";
import { GoldenImages } from "./GoldenImages";
import styles from "./golden.module.css";

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
  referenceImage("thumbnail-hannibal-image", "Rome's Worst Nightmare"),
  referenceImage("thumbnail-rich-image", "How the Rich Hide Money"),
  referenceImage("thumbnail-samurai-image", "Kyoto Burns"),
  referenceImage("thumbnail-scandal-image", "Sold for Lies"),
  referenceImage("thumbnail-stoic-anger-image", "The Quiet Stoic — Anger Is Weakness"),
  referenceImage("thumbnail-stoic-memento-image", "The Quiet Stoic — Memento Mori"),
];

const CINEMATIC_PROOFS: ImageProof[] = [
  contextImage("cinematic-cash-image", "Legacy cinematic exploration — visible-face reference, not approved for faceless Casefile"),
  contextImage("cinematic-handshake-image", "Legacy cinematic exploration — visible-face reference, not approved for faceless Casefile"),
];

const CINEMATIC_IDENTITY_HOLD =
  "Reference hold: these legacy stills contain a distinctive photorealistic face. They are not an approved visual target for source-bound Casefile work. That route requires the reviewed faceless mannequin cast, wardrobe and prop locks, LTX clip review, exact edit binding, and a promoted multi-shot render before it can be shown as Golden evidence.";

interface VideoProof { media: GoldenProofMediaPresentation; poster?: GoldenProofMediaPresentation; device: string; meta: string }

function videoProof(mediaId: string, posterId: string | undefined, device: string, meta: string): VideoProof {
  return {
    media: referenceMedia(mediaId, "video"),
    poster: posterId ? referenceMedia(posterId, "image") : undefined,
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
  // The paired still was explicitly rejected as thumbnail craft evidence. The
  // video remains a reference, but must render without promoting that still as
  // its poster.
  videoProof("documotion-robbery-video", undefined, "reference proxy · robbery noir · 720p", "The Vault — the Antwerp diamond heist"),
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

/** Short "what it does" line — first sentence of the honest `how`. */
function blurb(how: string): string {
  const first = how.split(/\.\s/)[0].trim();
  return first.endsWith(".") ? first : first + ".";
}

/** Keep implementation audit notes available in source, not in the operator's visual scan. */
function compactHow(how: string): string {
  const clean = how.replace(/\s+/g, " ").trim();
  const withoutAuditNotes = clean.split(/\s(?:P\d+-\d+|NOTE \()/)[0].trim();
  const sentences = withoutAuditNotes.split(/(?<=\.)\s+/).filter(Boolean).slice(0, 2).join(" ");
  if (sentences.length <= 360) return sentences;
  return `${sentences.slice(0, 356).trimEnd()}…`;
}

function compactPoint(value: string, max = 94): string {
  const clean = value.replace(/^[\s•→↳-]+/, "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function modulePowerPoints(module: GoldenModule): string[] {
  const lead = blurb(module.how)
    .split(/:\s|\s—\s|;\s|,\s(?=where|then|before|while)/i)[0]
    .replace(/\.$/, "");
  return [...new Set([
    compactPoint(lead, 76),
    ...module.gates.slice(0, 1).map((gate) => compactPoint(gate, 76)),
  ])].slice(0, 2);
}
function take2<T>(xs: readonly T[]): T[] { return xs.slice(0, 2); }

type ModuleDestination = { href: string; label: string };
type ModuleCover = { src: string; alt: string; status: "reference" | "context" };

const MODULE_DESTINATIONS: Readonly<Record<string, ModuleDestination>> = {
  "novita-render-farm": { href: "/novita-render", label: "Open render fleet" },
  "imagecraft-novita": { href: "/novita-render", label: "Open render fleet" },
  "videocraft-novita": { href: "/novita-render", label: "Open render fleet" },
  lofi: { href: "/lofi", label: "Open music references" },
  loreshort: { href: "/loreshort", label: "Open lore references" },
  "studio-assets": { href: "/studio-assets", label: "Open Studio assets" },
  cinematic: { href: "/casefile", label: "Open Casefile desk" },
  "casefile-documentary": { href: "/casefile", label: "Open Casefile desk" },
  "casefile-evidence-shot-map": { href: "/casefile", label: "Open Casefile desk" },
  "editorial-evidence-packet": { href: "/editorial-evidence", label: "Open evidence desk" },
  "source-bound-story-spine": { href: "/editorial-evidence", label: "Open evidence desk" },
  "topic-intel": { href: "/seo", label: "Open packaging research" },
  metadata: { href: "/seo", label: "Open packaging research" },
};

const MODULES_WITH_PROOF = new Set([
  "channel-planner",
  "topic-intel",
  "show-bible",
  "script",
  "loreshort",
  "novita-render-farm",
  "quiz",
  "cinematic",
  "documotion",
  "speech-tv",
  "shorts",
  "lofi",
  "whiteboard",
  "comic",
  "thumbnail",
  "studio-assets",
  "package-opening-proof",
  "motioncraft",
  "narration",
  "assemble",
  "metadata",
  "final-master-story-coverage",
]);

function moduleCover(moduleKey: string): ModuleCover | undefined {
  const cover = (() => {
    if (moduleKey === "thumbnail") return PROOFS[0];
    if (moduleKey === "cinematic") return CINEMATIC_PROOFS[0];
    if (moduleKey === "loreshort") return LORESHORT_PROOFS[0]?.poster;
    if (moduleKey === "quiz") return QUIZ_PROOFS[0]?.poster;
    if (moduleKey === "motioncraft") return MOTION_PROOFS[0]?.poster;
    if (["novita-render-farm", "imagecraft-novita", "videocraft-novita"].includes(moduleKey)) {
      return NOVITA_PROOFS[0]?.poster;
    }
    if (moduleKey === "lofi") return LOFI_PROOFS[0]?.media;
    if (moduleKey === "whiteboard") return contextMedia("whiteboard-chiquita-image", "image");
    if (moduleKey === "comic") return contextMedia("comic-comic3d-image", "image");
    return undefined;
  })();
  if (!cover) return undefined;
  if ("src" in cover) {
    return { src: cover.src, alt: cover.alt, status: cover.status };
  }
  if (cover.kind === "video" || cover.kind === "audio") return undefined;
  return {
    src: cover.url,
    alt: cover.id,
    status: cover.status,
  };
}

function moduleEvidenceLabel(moduleKey: string): string {
  if (["loreshort", "quiz", "motioncraft", "novita-render-farm", "documotion", "whiteboard", "comic"].includes(moduleKey)) return "Video evidence";
  if (["thumbnail", "lofi", "cinematic"].includes(moduleKey)) return "Visual references";
  if (moduleKey === "narration") return "Voice references";
  if (["package-opening-proof", "final-master-story-coverage"].includes(moduleKey)) return "Evidence flow";
  if (["channel-planner", "topic-intel", "show-bible", "script", "shorts", "studio-assets", "assemble", "metadata"].includes(moduleKey)) return "Working specimens";
  return "Contract & gates";
}

function moduleGlyph(moduleKey: string): string {
  if (/research|evidence|source/.test(moduleKey)) return "⌕";
  if (/positioning|bible|context/.test(moduleKey)) return "◫";
  if (/seo|metadata|topic/.test(moduleKey)) return "◎";
  if (/voice|narration|speech|music|lofi/.test(moduleKey)) return "∿";
  if (/avatar|banner|thumbnail|image|visual/.test(moduleKey)) return "◇";
  if (/pipeline|graph|sequence|assemble/.test(moduleKey)) return "⌁";
  if (/probe|readiness|safety|guard|verify|proof|release/.test(moduleKey)) return "✓";
  if (/script|story|documentary/.test(moduleKey)) return "¶";
  if (/planner|plan/.test(moduleKey)) return "▦";
  if (/render|video|scene|motion|comic|whiteboard|short/.test(moduleKey)) return "▶";
  if (/asset|layer|insert|caption|overlay/.test(moduleKey)) return "▧";
  if (/ship|upload/.test(moduleKey)) return "↑";
  return "G";
}

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
    <main className={styles.page}>
      <header className={styles.catalogHeader}>
        <div className={styles.catalogTitle}>
          <p className={styles.eyebrow}>Production standards</p>
          <h1>Golden modules</h1>
        </div>
        <div className={styles.catalogStats} aria-label="Golden catalog summary">
          <HeroMetric label="Catalog" value={GOLDEN_MODULES.length} note="modules" />
          <HeroMetric label="Runnable" value={executableCount} note="bound" />
          <HeroMetric label="Reference" value={referenceCount} note="candidates" />
          <HeroMetric label="Promoted" value={receiptCount} note="proofs" />
        </div>
      </header>
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
      <div className={styles.chapters}>
      {CATEGORY_ORDER.map((cat, categoryIndex) => {
        const mods = GOLDEN_MODULES
          .filter((m) => (CATEGORY[m.key] ?? "Post-production") === cat)
          .sort((a, b) => catalogStatusRank(a.status) - catalogStatusRank(b.status));
        if (!mods.length) return null;
        const references = mods.filter((m) => m.status === "reference").length;
        return (
          <details
            key={cat}
            className={styles.chapter}
            aria-label={`${cat} Golden modules`}
            open={categoryIndex === 0}
          >
            <summary className={styles.chapterSummary}>
              <span className={styles.chapterIndex}>{String(categoryIndex + 1).padStart(2, "0")}</span>
              <span className={styles.chapterCopy}>
                <span role="heading" aria-level={2}>{cat}</span>
              </span>
              <span className={styles.chapterMeter} aria-hidden="true">
                <i style={{ width: `${Math.max(8, Math.round((references / mods.length) * 100))}%` }} />
              </span>
              <span className={styles.chapterCount}>{mods.length} modules · {references} references</span>
              <span className={styles.chapterToggle} aria-hidden="true">+</span>
            </summary>
            <div className={styles.chapterBody}>
              <div className={styles.moduleGrid}>
                {mods.map((m) => <ModuleCard key={m.key} module={m} />)}
              </div>
            </div>
          </details>
        );
      })}
      </div>
    </main>
  );
}

function HeroMetric({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className={styles.heroMetric}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
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
    <details aria-label="Golden evidence and channel admission truth" className={styles.truthDesk}>
      <summary className={styles.truthSummary}>
        <span className={styles.truthMark} aria-hidden="true">✓</span>
        <div>
          <small>Catalog truth</small>
          <strong>Evidence & admission</strong>
        </div>
        <span className={styles.truthPills}>
          <b>{automatic.length} automatic</b>
          <b>{supervised.length} supervised</b>
          <b>{blocked.length} blocked</b>
        </span>
        <i aria-hidden="true">+</i>
      </summary>

      <div className={styles.truthBody}>
        <div className={styles.truthLead}>
          <strong>{promotionProofCount === 0 ? "No Golden promotions recorded" : `${promotionProofCount} promotion proof${promotionProofCount === 1 ? "" : "s"} recorded`}</strong>
          <span>Reference media, executable bindings, and creator admission stay separate.</span>
        </div>

        <div className={styles.truthMetrics}>
          <TruthMetric label="Promotion proofs" value={promotionProofCount} note="Required for Golden status" tone="warning" />
          <TruthMetric label="Reference media" value={referenceMediaCount} note="Inspectable candidates" tone="gold" />
          <TruthMetric label="Context only" value={contextMediaCount} note="Limited-use references" tone="neutral" />
          <TruthMetric label="Excluded" value={excludedMediaCount} note="Quarantined or duplicate" tone="neutral" />
        </div>

        <GoldenMediaSuccessorQueue items={mediaSuccessorQueue} />

        <div className={styles.admissionDesk}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.label}>Live catalog evaluation</span>
            <h3>Creator channel admission</h3>
          </div>
          <small>Certified family policy · not a route receipt</small>
        </div>
        <div className={styles.admissionGrid}>
          <AdmissionGroup mode="automatic" title="Automatic" admissions={automatic} />
          <AdmissionGroup mode="supervised" title="Supervised / private" admissions={supervised} />
          <AdmissionGroup mode="blocked" title="Blocked" admissions={blocked} />
        </div>
        <div className={styles.qualificationWrap}>
          <ProductionRouteQualificationCard
            unavailableMessage="No persisted per-channel qualification receipt is connected to the Golden catalog. The family-admission groups above are live catalog policy, not a live route qualification."
          />
        </div>
        </div>
      </div>
    </details>
  );
}

function GoldenMediaSuccessorQueue({ items }: { items: readonly GoldenProofMediaSuccessorRequirement[] }) {
  return (
    <details className={styles.successorQueue}>
      <summary className={styles.successorSummary}>
        <span className={styles.queueSymbol} aria-hidden="true">↻</span>
        <span>
          <strong>Legacy video successor queue</strong>
          <small>CATALOG AUDIT · NO YOUTUBE REPLACEMENT ACTION</small>
        </span>
        <b>{items.length}</b>
        <span className={styles.queueToggle} aria-hidden="true">+</span>
      </summary>
      <div className={styles.successorBody}>
        <p>
          Retained context or quarantined samples need a repaired successor render before they can become Golden evidence. Archive bytes remain preserved; no existing upload is changed here.
        </p>
        <div className={styles.successorGrid}>
          {items.map((item) => (
            <article key={item.id} data-status={item.status}>
              <span className={styles.queueStatus}>
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
      className={styles.foundation}
    >
      <summary className={styles.foundationSummary}>
        <span className={styles.foundationMark} aria-hidden="true">08</span>
        <span className={styles.foundationCopy}>
          <small>Universal video foundation · engine-enforced</small>
          <strong>Universal video foundation</strong>
        </span>
        <b>{MINIMUM_VIDEO_FOUNDATION_TEMPLATE.length} NON-NEGOTIABLE STAGES</b>
        <span className={styles.foundationToggle} aria-hidden="true">+</span>
      </summary>
      <div className={styles.foundationBody}>
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
  return (
    <div className={styles.truthMetric} data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
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
  const emptyMessage = mode === "supervised" ? "No private-review family is registered." : mode === "blocked" ? "No families are blocked." : "No automatic family is admitted.";
  return (
    <details className={styles.admissionGroup} data-mode={mode}>
      <summary className={styles.admissionHead}>
        <span>{title}</span>
        <strong>{admissions.length}</strong>
        <i aria-hidden="true">+</i>
      </summary>
      <div className={styles.admissionBody}>
        {admissions.length === 0 ? (
          <span className={styles.emptyAdmission}>{emptyMessage}</span>
        ) : (
          <div className={styles.admissionList}>
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
                <div key={admission.family} title={detail}>
                  <span>{family.label}</span>
                  <small>{detail}</small>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

/* ----------------------------- module card ----------------------------- */

function ModuleCard({ module: m }: { module: GoldenModule }) {
  const isReference = m.status === "reference";
  const isRegistered = m.status === "registered";
  const execution = catalogExecutionBinding(m.key);
  const availability = catalogExecutionAvailability(execution);
  const promotionProof = GOLDEN_PROMOTION_PROOFS[m.key];
  const executionIsWarning = execution.kind === "catalog-only" || execution.kind === "registered-private-release";
  const destination = MODULE_DESTINATIONS[m.key];
  const cover = moduleCover(m.key);
  const binding = execution.kind === "pipeline-module"
    ? `Executable · ${execution.executableIds.join(" · ")}`
    : execution.kind === "registered-private-release"
      ? `Private-release block · ${execution.executableIds.join(" · ")}`
      : execution.kind === "external-task"
        ? `External task · ${execution.executableIds.join(" · ")}`
        : "Catalog only · no compiler binding";
  return (
    <details
      className={styles.moduleCard}
      data-reference={isReference}
      data-module-key={m.key}
    >
      <summary className={styles.moduleSummary}>
        <span className={styles.moduleVisual} data-has-cover={cover ? "true" : "false"}>
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- manifest-resolved card cover
            <img src={cover.src} alt="" loading="lazy" />
          ) : (
            <span aria-hidden="true">{moduleGlyph(m.key)}</span>
          )}
          {cover?.status === "context" ? <small>Context</small> : null}
        </span>
        <span className={styles.moduleSummaryCopy}>
          <small>{m.stage}</small>
          <span role="heading" aria-level={3}>{m.title}</span>
          <ul className={styles.modulePowerPoints}>
            {modulePowerPoints(m).map((point) => <li key={point}>{point}</li>)}
          </ul>
        </span>
        <span className={styles.moduleSummaryMeta}>
          {isReference
            ? <span className={styles.moduleStatus} data-tone="reference">REFERENCE</span>
            : isRegistered
              ? <span className={styles.moduleStatus} data-tone="registered">REGISTERED</span>
              : <span className={styles.moduleStatus} data-tone="active">ACTIVE</span>}
          <small>{moduleEvidenceLabel(m.key)}</small>
        </span>
        <span className={styles.moduleToggle} aria-hidden="true">+</span>
      </summary>

      <div className={styles.moduleBody}>
        <div className={styles.moduleToolbar}>
          <span className={styles.moduleProtection}>
            <small>AI edit protection</small>
            {/* Every catalog module is lockable and starts unlocked; the key IS the lock id. */}
            <OwnerLockBadge kind="module" moduleId={m.key} label={m.title} size="sm" />
          </span>
          {destination ? <Link href={destination.href}>{destination.label}<span aria-hidden="true">↗</span></Link> : null}
        </div>
        <div className={styles.moduleFacts}>
          <div data-warning={executionIsWarning}>
            <small>Runtime binding</small>
            <strong>{binding}</strong>
            <span>{executionIsWarning ? "Not route-executable" : "Connected to the production compiler"}</span>
          </div>
          <div data-state={availability.state}>
            <small>Availability</small>
            <strong>{availability.label}</strong>
            <span>{availability.detail}</span>
          </div>
          <div data-proof={promotionProof ? "true" : "false"}>
            <small>Promotion</small>
            <strong>{promotionProof ? `Recorded ${promotionProof.verifiedAt}` : "Not promoted"}</strong>
            <span>{promotionProof ? "Immutable production proof is registered" : "No production-promotion receipt recorded"}</span>
          </div>
        </div>
        <div className={styles.moduleDoctrine}>
          <div>
            <small>What it controls</small>
            <strong>{compactHow(m.how)}</strong>
          </div>
          <ul className={styles.gates}>
            {m.gates.slice(0, 4).map((gate) => (
              <li key={gate}>
                <span aria-hidden="true">↳</span>
                <span>{gate}</span>
              </li>
            ))}
          </ul>
        </div>
        {MODULES_WITH_PROOF.has(m.key) ? (
          <section className={styles.moduleEvidence} aria-label={`${m.title} evidence`}>
            <header><span>Evidence</span><small>{moduleEvidenceLabel(m.key)}</small></header>
            <ProofStrip moduleKey={m.key} />
          </section>
        ) : null}
      </div>
    </details>
  );
}

/* ----------------------------- proof strips ---------------------------- */

function textStrip(items: TextProof[]) {
  return (
    <div className={styles.proofStrip}>
      {take2(items).map((p, i) => (
        <div key={i} className={styles.proofCard}>
          <span className={styles.proofDevice}>{p.device}</span>
          <span className={styles.proofLine}>{p.line}</span>
          <span className={styles.proofMeta}>{p.channel} · {p.note}</span>
        </div>
      ))}
    </div>
  );
}

function MediaArtifactLabel({ media }: { media: GoldenProofMediaPresentation }) {
  const label = media.status === "context" ? "CONTEXT ONLY" : "MANIFEST REFERENCE";
  return (
    <span className={styles.artifactLabel} data-context={media.status === "context"}>
      {label} · {media.id} · SHA-256 {media.sha256.slice(0, 12)}…
    </span>
  );
}

function videoStrip(items: readonly VideoProof[]) {
  return (
    <div className={styles.proofStrip}>
      {take2(items).map((p) => (
        <div key={p.media.id} className={styles.proofCard}>
          <span className={styles.proofDevice}>{p.device}</span>
          { }
          <video controls preload="none" poster={p.poster?.url} src={p.media.url} className={styles.proofMedia} />
          <MediaArtifactLabel media={p.media} />
          <span className={styles.proofMeta}>{p.meta}</span>
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
    <div aria-label="Structural package-to-opening evidence flow; not semantic equivalence proof" className={styles.proofFlow}>
      {stages.map((stage, index) => (
        <div key={stage.label} className={styles.flowStage}>
          <span className={styles.proofDevice}>{stage.label}</span>
          <div>
            <span aria-hidden="true">{index + 1}</span>
            <strong>{stage.title}</strong>
          </div>
          <span className={styles.proofLine}>{stage.detail}</span>
          <span className={styles.proofMeta}>{index === 2 ? "STRUCTURAL WITNESS · NOT A SEMANTIC JUDGE" : "CONTENT-ADDRESSED RECEIPT"}</span>
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
    <div aria-label="Final-master narrated-story coverage evidence flow; not visual shot-realization proof" className={styles.proofFlow}>
      {stages.map((stage, index) => (
        <div key={stage.label} className={styles.flowStage}>
          <span className={styles.proofDevice}>{stage.label}</span>
          <div>
            <span aria-hidden="true">{index + 1}</span>
            <strong>{stage.title}</strong>
          </div>
          <span className={styles.proofLine}>{stage.detail}</span>
          <span className={styles.proofMeta}>{stage.note}</span>
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
        <p role="status" className={styles.holdLabel}>
          CONTEXT ONLY · NOT GOLDEN EVIDENCE
        </p>
        <GoldenImages images={take2(CINEMATIC_PROOFS)} />
        <p role="status" className={styles.holdCopy}>
          {CINEMATIC_IDENTITY_HOLD}
        </p>
      </>
    );
    case "documotion":
      return (
        <>
          {videoStrip(DOCU_PROOFS)}
          <p role="status" className={styles.holdCopy}>
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
        <div className={styles.proofStrip}>
          {take2(LOFI_PROOFS).map((p) => (
            <div key={p.media.id} className={styles.proofCard}>
              <span className={styles.proofDevice}>{p.device}</span>
              {p.media.kind === "video" ? (

                <video controls preload="none" poster={p.poster?.url} src={p.media.url} className={styles.proofMedia} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- static proof still
                <img src={p.media.url} alt={p.meta} className={styles.proofMedia} />
              )}
              <MediaArtifactLabel media={p.media} />
              <span className={styles.proofMeta}>{p.meta}</span>
            </div>
          ))}
        </div>
      );
    case "whiteboard": {
      const clip = referenceMedia("whiteboard-chiquita-video", "video");
      const poster = contextMedia("whiteboard-chiquita-image", "image");
      return (
        <div className={styles.proofStrip}>
          <div className={`${styles.proofCard} ${styles.proofCardWide}`}>
            <span className={styles.proofDevice}>reference proxy · drawn cinema · 720p</span>
            { }
            <video controls preload="none" poster={poster.url} src={clip.url} className={styles.proofMedia} />
            <MediaArtifactLabel media={clip} />
            <span className={styles.proofMeta}>Chiquita and the Banana Republic — every beat drawn in time with the voice</span>
          </div>
        </div>
      );
    }
    case "comic": {
      const clip = contextMedia("comic-comic3d-video", "video");
      const poster = contextMedia("comic-comic3d-image", "image");
      return (
        <div className={styles.proofStrip}>
          <div className={`${styles.proofCard} ${styles.proofCardWide}`}>
            <span className={`${styles.proofDevice} ${styles.warningText}`}>context-only · retained 3D drawn comic · 1080p</span>
            { }
            <video controls preload="none" poster={poster.url} src={clip.url} className={styles.proofMedia} />
            <MediaArtifactLabel media={clip} />
            <span className={`${styles.proofMeta} ${styles.warningText}`}>Legacy sample retained for craft context only: its blank opening disqualifies it as Golden proof until a fresh reviewed master replaces it.</span>
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
        <div className={styles.proofStrip}>
          {take2(VOICE_PROOFS).map((p) => (
            <div key={p.media.id} className={styles.proofCard}>
              <span className={styles.proofDevice}>{p.device}</span>
              { }
              <audio controls preload="none" src={p.media.url} className={styles.proofAudio} />
              <MediaArtifactLabel media={p.media} />
              <span className={styles.proofMeta}>{p.meta}</span>
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
