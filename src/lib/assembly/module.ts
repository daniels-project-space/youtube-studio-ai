/**
 * ASSEMBLY_MODULE — the self-describing contract (mirrors LOFI_MODULE / LORESHORT_MODULE)
 * PLUS a CustomizationSurface so the Pipeline Architect + Director configure it from data.
 * Runs standalone AND inside a pipeline; the planner reads this card to compose with it.
 */
import type { CustomizationSurface } from "@/engine/customization";

/** The per-account customization surface for Assembly: knobs + style presets + capabilities. */
export const ASSEMBLY_SURFACE: CustomizationSurface = {
  capabilities: [
    "beat- & narration-aware cutting",
    "variable cut energy (still → frenetic)",
    "chapter cards",
    "intro / outro cards",
    "music duck + LUFS loudness normalize",
    "vertical / social reframe",
    "idempotent + heal-aware render",
  ],
  knobs: [
    { id: "aspect", type: "enum", values: ["16:9", "9:16", "1:1"], default: "16:9", describes: "output canvas", servesStyles: ["shorts", "social"] },
    { id: "cutEnergy", type: "enum", values: ["still", "slow", "steady", "dynamic", "frenetic"], default: "steady", describes: "pacing → cuts/min → per-clip screen time", servesStyles: ["meditation", "documentary", "essay", "hype", "shorts"] },
    { id: "introStyle", type: "enum", values: ["none", "title_card", "cold_open", "logo_sting"], default: "title_card", describes: "opener treatment", servesStyles: ["branding", "shorts"] },
    { id: "outroStyle", type: "enum", values: ["none", "closing_card", "subscribe_card"], default: "closing_card", describes: "ending treatment", servesStyles: ["retention", "shorts"] },
    { id: "chapterCards", type: "boolean", default: false, describes: "splice heading cards on chapter beats", servesStyles: ["documentary", "essay"] },
    { id: "musicDuckProfile", type: "enum", values: ["none", "gentle", "standard", "aggressive"], default: "standard", describes: "how hard music ducks under the voice", servesStyles: ["asmr", "meditation", "hype"] },
    { id: "targetLufs", type: "number", range: [-23, -12], default: -14, describes: "integrated loudness target", servesStyles: ["platform"] },
    // default "crossfade" DESCRIBES PRODUCTION: the live god-block passes no
    // crossfadeSec to composeWithIntro, whose default is 0.8s — so a channel that
    // never touches this knob gets a title→body dissolve today. `hardcut` here
    // used to misreport that (and forced crossfadeSec 0 on the EDL path). The
    // `hype` preset still opts into a straight cut explicitly.
    { id: "transitions", type: "enum", values: ["hardcut", "crossfade", "dip_to_black"], default: "crossfade", describes: "between-shot transition", servesStyles: ["documentary", "hype"] },
    { id: "reframe", type: "enum", values: ["none", "center", "subject_track"], default: "none", describes: "repurpose horizontal → vertical", servesStyles: ["shorts", "social"] },
    { id: "tailSec", type: "number", range: [0, 8], default: 3, describes: "silent fade-out tail", servesStyles: ["shorts", "ambient"] },
    // These three are read by the assemble block and were offered by the
    // onboarding catalog, but had no knob here — so setting them validated
    // against nothing and was dropped on write. Ranges mirror the catalog
    // exactly, so the UI can never send a value this surface rejects.
    { id: "fadeOutSec", type: "number", range: [0, 6], default: 0, describes: "video fade to black at the end, in seconds", servesStyles: ["documentary", "ambient"] },
    { id: "audioFadeOutSec", type: "number", range: [0, 30], default: 0, describes: "music fade-out length, in seconds", servesStyles: ["ambient", "meditation"] },
    { id: "burnCaptions", type: "boolean", default: false, describes: "burn captions into the picture rather than shipping them as a track", servesStyles: ["shorts", "social"] },
    { id: "captions", type: "boolean", default: true, describes: "burn word-level captions over the video (toggle off to ship caption-free)", servesStyles: ["accessibility", "shorts", "social"] },
    // ────────────────────────────────────────────────────────────────────────
    // OPERATOR-ONLY CUTOVER SWITCH — NOT a creative knob. DEFAULT false.
    //
    // `true` makes the live `timeline_assemble` block compose through THIS
    // module (cutover.assembleViaEdl) instead of the god-block's own inline
    // compose/heal code. Render parity is proven for the narrated essay
    // profiles exercised by scripts/assembly-render-parity.ts, including
    // captions, loudness, title cards, hard cuts, and dips to black. It stays
    // an OPERATOR decision on ONE channel at a time—not an engineering default
    // or an implicit preset change.
    //
    // Deliberately absent from every preset below, so no preset — and no
    // Architect pass that picks a preset — can turn it on implicitly. The only
    // way it becomes true is an explicit per-channel
    // `setModuleConfig(channelId, "timeline_assemble", { useAssemblyEdl: true })`.
    // `servesStyles: []` marks it as serving no channel style at all.
    // ────────────────────────────────────────────────────────────────────────
    { id: "useAssemblyEdl", type: "boolean", default: false, describes: "OPERATOR CUTOVER SWITCH: compose via the standalone Assembly EDL module instead of the legacy inline god-block path. Leave off unless this channel is deliberately adopting the render-tested essay cutover.", servesStyles: [] },
  ],
  presets: {
    documentary: { cutEnergy: "slow", chapterCards: true, transitions: "crossfade", introStyle: "title_card", outroStyle: "closing_card", musicDuckProfile: "standard", aspect: "16:9", targetLufs: -14 },
    essay: { cutEnergy: "steady", chapterCards: false, introStyle: "title_card", outroStyle: "closing_card", musicDuckProfile: "standard" },
    hype: { cutEnergy: "dynamic", transitions: "hardcut", musicDuckProfile: "aggressive", introStyle: "cold_open" },
    shorts: { aspect: "9:16", cutEnergy: "frenetic", introStyle: "none", outroStyle: "none", reframe: "subject_track", tailSec: 1, chapterCards: false },
    meditation: { cutEnergy: "still", transitions: "crossfade", musicDuckProfile: "gentle", tailSec: 6, targetLufs: -16, captions: false },
    lofi: { cutEnergy: "still", musicDuckProfile: "none", introStyle: "title_card", outroStyle: "none", captions: false },
  },
};

export const ASSEMBLY_MODULE = {
  key: "assemble",
  title: "Assembly",
  stage: "build",
  does:
    "Turns a typed edit-plan (Timeline / EDL) into a finished video: beat- & narration-aware cuts, " +
    "intro/chapter/outro cards, caption/quote/insert overlays, a ducked music bed at broadcast loudness, " +
    "and optional vertical reframe. PLAN and RENDER are separate — the render is deterministic, " +
    "content-addressed (idempotent), and resumable. Standalone and composable.",
  produces: {
    kind: "assembled_video",
    file: "mp4 — H.264, format.w×h, music muxed, overlays burned, faded tail",
    returns: "Receipt { videoKey, videoLocalPath?, durationSec, segmentsRendered, cardsRendered, overlaysApplied, warnings[], cacheHits }",
  },
  requires: {
    timeline: "Timeline — the validated edit-plan: format + segments + audio + overlays + lengthBand + checkpoints",
  },
  optional: {
    "checkpoints.preOverlaySec": "declared heal point — overlay-class defects re-render from here instead of a full rebuild",
    reframe: "{ aspect: '16:9' | '9:16' | '1:1' } — vertical/social reframe",
    "audio.targetLufs": "integrated-loudness target (e.g. -14 LUFS for YouTube)",
  },
  needs: {
    secrets: [] as string[],
    tools: ["ffmpeg", "ffprobe"],
    note: "Motion-graphic cards render via Remotion to transparent assets, then enter the EDL as normal clips. Heavy render runs as a Trigger.dev durable task.",
  },
  /** Per-account customization — the Architect/Director configure Assembly from this. */
  customization: ASSEMBLY_SURFACE,
  rules: [
    "PLAN ≠ RENDER: planTimeline emits a typed, inspectable Timeline (cheap); renderTimeline executes it deterministically. No edit decisions inside the renderer.",
    "VALIDATE BEFORE SPEND: a Timeline is checked (length band, overlay windows in range, body coverage, heal-checkpoint sanity) BEFORE any encode — fail loud, never render an off-length or dead-air video.",
    "IDEMPOTENT: render is content-addressed (hash of Timeline + tool versions); a retry re-uses cached segments and never double-renders.",
    "NO SILENT SKIPS: a dropped card/overlay is a typed Receipt.warning the verify stage can gate on — never a swallowed log line.",
    "PER-ACCOUNT: every style choice comes from the CustomizationSurface (preset + overrides on the ChannelProfile) → resolveAssembleParams → planTimeline. Zero hardcoded channel defaults; the 'essay' preset == the legacy god-block behavior (parity).",
    "HEAL = re-render from a DECLARED checkpoint (checkpoints.preOverlaySec), not a regex match on heal hints.",
    "ONE MODEL for narrated AND lofi assembly — the duplicate paths collapse onto one renderTimeline.",
  ],
} as const;
