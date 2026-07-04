/**
 * cutover — the CUTOVER ADAPTER between the live `timeline_assemble` god-block
 * (src/trigger/blocks/narratedBlocks.ts) and the standalone Assembly module
 * (planTimeline + renderTimeline + the ffmpeg RenderBackend).
 *
 * It is the seam the flag-gated branch in narratedBlocks WOULD call:
 *
 *   if (USE_ASSEMBLY_EDL) return assembleViaEdl({ store: ctx.store, params: ctx.params, profile });
 *
 * `buildPlanInput()` is a PURE map from the god-block's `ctx.store` + `ctx.params`
 * shape → the Assembly module's `PlanInput`. It reads EXACTLY the keys the god-block
 * consumes (footageClips, entityClips, narrationLocalPath, narrationDurationSec,
 * introCardPath, introSec, musicKey/musicUrl, sentenceTimings, cutSheet, chapterPlan,
 * channelName, channelAvatarKey, script.closingLine, quoteOverlays, insertOverlays)
 * and the params the god-block reads (aspect, tailSec, fadeOutSec, …, burnCaptions).
 *
 * `assembleViaEdl()` is the live-callable render: resolve params (+ editor directives
 * if a ChannelProfile is given) → planTimeline → renderTimeline(ffmpeg backend) →
 * return the god-block's exact `produces` shape (videoKey, videoLocalPath,
 * videoDurationSec, quotesApplied, insertsApplied, preOverlayKey, preOverlayLocalPath).
 *
 * ADDITIVE ONLY — nothing live imports this yet; the flip is a separate, human-
 * approved edit to narratedBlocks.ts.
 */
import type { ChannelProfile } from "@/engine/channelProfile";
import { captionCuesFromTimings, type QuoteOverlaySpec } from "@/lib/ffmpeg";
import { resolveEditorConfig, editorDirectives } from "@/lib/crew/editor";
import { getCutSheet } from "@/engine/creative/brief";
import { createFfmpegBackend } from "./ffmpegBackend";
import { detectNarrationSilence } from "./silenceProbe";
import {
  planTimeline,
  resolveAssembleParams,
  ASSEMBLE_DEFAULTS,
  type AssembleParams,
  type PlanInput,
} from "./planTimeline";
import { renderTimeline, projectedDurationSec } from "./index";
import type { Overlay } from "./timeline";

/** Loose store/params bags — mirrors `StageContext.store` / `.params` (Record<string, unknown>). */
export type StoreBag = Record<string, unknown>;
export type ParamsBag = Record<string, unknown>;

/** Read a non-empty string store/params value, else undefined (mirrors narratedBlocks `opt`). */
function optStr(bag: StoreBag, key: string): string | undefined {
  const v = bag[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Read a string[] store value (footageClips/entityClips), defaulting to []. */
function strArr(bag: StoreBag, key: string): string[] {
  const v = bag[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Map the live god-block's `quoteOverlays` / `insertOverlays` (QuoteOverlaySpec[])
 * back into the typed EDL `Overlay[]`. This is the inverse of
 * `overlays.ts::overlaysToCuesAndSpecs` for the quote/insert path: a QuoteOverlaySpec
 * carries an already-rendered alpha card at `.path` + a `.startSec` + `.durSec`, so we
 * round-trip it as an Overlay whose `src` is that path and whose re-render fields
 * (text/highlights/width/height/noBlur) ride in `.data` — so the renderer's
 * `overlaysToCuesAndSpecs` reproduces the identical spec. `endSec = startSec + durSec`.
 */
export function quoteSpecsToOverlays(specs: QuoteOverlaySpec[] | undefined, kind: "quote" | "insert"): Overlay[] {
  if (!Array.isArray(specs)) return [];
  return specs
    .filter((s) => s && typeof s.path === "string" && s.path.length > 0)
    .map((s) => {
      const data: Record<string, unknown> = {};
      if (typeof s.text === "string") data.text = s.text;
      if (Array.isArray(s.highlights)) data.highlights = s.highlights;
      if (typeof s.width === "number") data.width = s.width;
      if (typeof s.height === "number") data.height = s.height;
      if (typeof s.noBlur === "boolean") data.noBlur = s.noBlur;
      const o: Overlay = {
        kind,
        startSec: Math.max(0, s.startSec),
        endSec: Math.max(0, s.startSec) + Math.max(0.001, s.durSec),
        src: s.path,
      };
      if (typeof s.text === "string") o.text = s.text;
      if (Object.keys(data).length) o.data = data;
      return o;
    });
}

/**
 * PURE map: the god-block's `ctx.store` + `ctx.params` → Assembly `PlanInput`.
 *
 * Mirrors the exact reads in narratedBlocks.ts::timeline_assemble:
 *   footageClips / entityClips                       → footageClips / entityClips
 *   narrationLocalPath / narrationDurationSec        → narrationSrc / narrationDurationSec
 *   musicKey ?? musicUrl                             → musicSrc            (R2 copy wins, URL fallback)
 *   introCardPath                                    → introCardSrc        ("" ⇒ no intro card, introSec → 0)
 *   sentenceTimings ({end})                          → sentenceTimings     (drives onBeat)
 *   cutSheet / chapterPlan                           → cutSheet / chapterPlan
 *   script.closingLine                               → closingLine
 *   channelName                                      → channelName
 *   channelAvatarKey                                 → cardBgSrc           (brand card bg)
 *   quoteOverlays + insertOverlays (QuoteOverlaySpec) → overlays[]          (as Overlay[])
 *
 * `editor` directives are NOT pulled from store here — they come from the
 * ChannelProfile in assembleViaEdl (a profile-derived wire, not a store key).
 */
export function buildPlanInput(store: StoreBag, params: ParamsBag = {}): PlanInput {
  const footageClips = strArr(store, "footageClips");
  const entityClips = strArr(store, "entityClips");

  const script = store["script"] as { closingLine?: string } | undefined;
  const fullTimings = store["sentenceTimings"] as { text: string; start: number; end: number }[] | undefined;
  const sentenceTimings = fullTimings?.map((s) => ({ end: s.end }));
  const cutSheet = getCutSheet(store);
  const chapterPlan = store["chapterPlan"] as
    | { kind: "footage" | "card"; durSec: number; heading?: string }[]
    | undefined;

  const overlays: Overlay[] = [
    ...quoteSpecsToOverlays(store["quoteOverlays"] as QuoteOverlaySpec[] | undefined, "quote"),
    ...quoteSpecsToOverlays(store["insertOverlays"] as QuoteOverlaySpec[] | undefined, "insert"),
  ];

  // CAPTIONS (god-block parity — finishFromComposed burned these; without this
  // the EDL flip silently shipped caption-less videos while captions:true).
  // Cues come from the ground-truth sentenceTimings, offset by the intro, and
  // are HIDDEN during quote/insert windows and chapter-heading reads exactly
  // like the god-block's blocked-window logic.
  if (params["burnCaptions"] !== false && fullTimings?.length) {
    const introCardSrc = optStr(store, "introCardPath");
    const introSec = introCardSrc ? Number(store["introSec"] ?? 5) : 0;
    const pad = 0.2;
    const qWindows = overlays.map((o) => [o.startSec - pad, o.endSec + pad] as [number, number]);
    const preGap = Number(params["chapterPreSec"] ?? 3);
    const postGap = Number(params["chapterPostSec"] ?? 3);
    const cWindows: [number, number][] = [];
    if (chapterPlan?.length) {
      let t = introSec;
      for (const w of chapterPlan) {
        if (w.kind === "card") {
          const a = t + preGap - 0.3;
          const b = Math.max(t + preGap, t + w.durSec - postGap) + 0.3;
          if (b > a) cWindows.push([a, b]);
        }
        t += w.durSec;
      }
    }
    const blocked = [...qWindows, ...cWindows];
    const cues = captionCuesFromTimings(fullTimings, introSec).filter(
      (c) => !blocked.some(([a, b]) => c.endSec > a && c.startSec < b),
    );
    overlays.push(...cues.map((c) => ({ kind: "caption" as const, startSec: c.startSec, endSec: c.endSec, text: c.text })));
  }

  return {
    footageClips,
    entityClips,
    narrationSrc: optStr(store, "narrationLocalPath"),
    narrationDurationSec: Number(store["narrationDurationSec"] ?? 0) || 60,
    musicSrc: optStr(store, "musicKey") ?? optStr(store, "musicUrl"),
    introCardSrc: optStr(store, "introCardPath"),
    sentenceTimings,
    cutSheet,
    chapterPlan,
    closingLine: script?.closingLine,
    channelName: optStr(store, "channelName"),
    cardBgSrc: optStr(store, "channelAvatarKey"),
    overlays,
  };
}

/**
 * Resolve AssembleParams from `ctx.params` WITHOUT a ChannelProfile (the parity /
 * no-profile path). Starts from the god-block defaults and overlays only the raw
 * numeric/string params the god-block reads directly off `ctx.params`. This makes the
 * EDL plan length/cadence math match the god-block for the default essay path.
 */
export function paramsToAssemble(params: ParamsBag): AssembleParams {
  const num = (key: string, d: number): number => {
    const v = params[key];
    return typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? NaN) || d;
  };
  const aspect = params["aspect"] === "9:16" ? "9:16" : params["aspect"] === "1:1" ? "1:1" : "16:9";
  const fadeOutSec = num("fadeOutSec", ASSEMBLE_DEFAULTS.fadeOutSec);
  return {
    ...ASSEMBLE_DEFAULTS,
    aspect,
    introSec: num("introSec", ASSEMBLE_DEFAULTS.introSec),
    tailSec: num("tailSec", ASSEMBLE_DEFAULTS.tailSec),
    fadeOutSec,
    audioFadeOutSec: num("audioFadeOutSec", fadeOutSec),
    minSeconds: num("minSeconds", 0),
    maxSeconds: num("maxSeconds", 0),
    introMusicVol: num("introMusicVol", ASSEMBLE_DEFAULTS.introMusicVol),
    bodyMusicVol: num("bodyMusicVol", ASSEMBLE_DEFAULTS.bodyMusicVol),
    musicDuckRampSec: num("musicDuckRampSec", ASSEMBLE_DEFAULTS.musicDuckRampSec),
    captions: params["burnCaptions"] !== false,
    reframe: aspect === "16:9" ? "none" : (ASSEMBLE_DEFAULTS.reframe ?? "none"),
  };
}

/** The god-block's `produces` shape — the parity contract for the return value. */
export interface AssembleProduces {
  videoKey: string;
  videoLocalPath: string;
  videoDurationSec: number;
  quotesApplied: number;
  insertsApplied: number;
  preOverlayKey: string;
  preOverlayLocalPath: string;
}

export interface AssembleViaEdlArgs {
  store: StoreBag;
  params: ParamsBag;
  /** Optional ChannelProfile — when present, resolves per-account params + Editor directives. */
  profile?: ChannelProfile;
  /** Run id + R2 key prefix for the ffmpeg backend (mirrors StageContext.runId / .keyPrefix). */
  runId?: string;
  keyPrefix?: string;
  /** Local cache root fallback when no R2 creds (hermetic). */
  localFallbackDir?: string;
}

/**
 * The flag-gated branch's body: build the plan from the live store/params (+ profile),
 * render it through the real ffmpeg backend, and return the god-block's `produces` shape.
 *
 * Deterministic plan math is identical regardless of `profile`: with a profile we
 * resolve per-account AssembleParams + wire the Editor's directives (cadence →
 * cuts/min, transitions → renderHints, captionStyle, overlayDensity) into planTimeline;
 * without one we fall back to god-block defaults overlaid by raw `ctx.params`.
 */
export async function assembleViaEdl(args: AssembleViaEdlArgs): Promise<AssembleProduces> {
  const { store, params, profile } = args;

  const planInput = buildPlanInput(store, params);
  const assembleParams = profile ? resolveAssembleParams(profile) : paramsToAssemble(params);
  if (profile) {
    planInput.editor = editorDirectives(resolveEditorConfig(profile));
  }

  // Editor silence-trim: when the profile's editor asks for it, probe the (local)
  // narration for dead air now so the PURE planner can carve it. Fail-soft: a probe
  // miss just leaves silenceIntervals unset ⇒ no trim (planTimeline = parity).
  if (planInput.editor?.trim && planInput.narrationSrc) {
    planInput.silenceIntervals = await detectNarrationSilence(planInput.narrationSrc, {
      durationSec: planInput.narrationDurationSec,
    });
  }

  const timeline = planTimeline(planInput, assembleParams);

  const backend = createFfmpegBackend({
    runId: args.runId ?? "cutover",
    keyPrefix: args.keyPrefix ?? "assembly/",
    localFallbackDir: args.localFallbackDir,
  });

  const receipt = await renderTimeline(timeline, backend);

  // NO SILENT SKIPS across the boundary: the Receipt's typed warnings must not
  // evaporate here — surface every one (the god-block logs its degradations too).
  for (const w of receipt.warnings) console.warn(`assembleViaEdl: ${w}`);

  // Map the module's Receipt → the god-block's produces shape. Applied counts are
  // HONEST: if the finishing pass composited nothing (receipt.overlaysApplied 0),
  // report 0 so the feature-presence QA gate fires — planned counts previously
  // masked a total overlay failure.
  const overlays = timeline.overlays;
  const nothingApplied = overlays.length > 0 && receipt.overlaysApplied === 0;
  const quotesApplied = nothingApplied ? 0 : overlays.filter((o) => o.kind === "quote").length;
  const insertsApplied = nothingApplied ? 0 : overlays.filter((o) => o.kind === "insert").length;

  return {
    videoKey: receipt.videoKey,
    videoLocalPath: receipt.videoLocalPath ?? "",
    // Projected runtime == god-block's videoSec (introSec + narrationSec + tailSec);
    // receipt.durationSec is the probed real length (≈ same, within encode rounding).
    videoDurationSec: receipt.durationSec || projectedDurationSec(timeline),
    quotesApplied,
    insertsApplied,
    // BLANK pre-overlay pointers: the backend persists its checkpoint under a
    // content-addressed cache key, NOT this path — advertising a key whose object
    // doesn't exist makes rehydrate hard-fail the whole block on resume. Blank =
    // "surgical heal does a full rebuild" (safe, same as the god-block's own
    // degrade when its pre-overlay upload fails).
    preOverlayKey: "",
    preOverlayLocalPath: "",
  };
}
