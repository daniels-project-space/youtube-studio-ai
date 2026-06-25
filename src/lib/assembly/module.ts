/**
 * ASSEMBLY_MODULE — the self-describing contract (mirrors LOFI_MODULE / LORESHORT_MODULE).
 * What it NEEDS, DOES, PRODUCES, and the RULES that protect its output. Runs standalone
 * AND inside a pipeline; the future Pipeline Architect reads this card to compose with it.
 */
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
  rules: [
    "PLAN ≠ RENDER: planTimeline emits a typed, inspectable Timeline (cheap); renderTimeline executes it deterministically. No edit decisions inside the renderer.",
    "VALIDATE BEFORE SPEND: a Timeline is checked (length band, overlay windows in range, body coverage, heal-checkpoint sanity) BEFORE any encode — fail loud, never render an off-length or dead-air video.",
    "IDEMPOTENT: render is content-addressed (hash of Timeline + tool versions); a retry re-uses cached segments and never double-renders.",
    "NO SILENT SKIPS: a dropped card/overlay is a typed Receipt.warning the verify stage can gate on — never a swallowed log line.",
    "PER-ACCOUNT: all pacing / format / duck levels / intro-outro style come from the ChannelProfile via planTimeline — zero hardcoded channel defaults.",
    "HEAL = re-render from a DECLARED checkpoint (checkpoints.preOverlaySec), not a regex match on heal hints.",
    "ONE MODEL for narrated AND lofi assembly — the duplicate paths collapse onto one renderTimeline.",
  ],
} as const;
