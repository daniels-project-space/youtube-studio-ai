/**
 * Editor — a per-channel CREW SUB-MODULE (the editor is its own module). It owns
 * cut cadence + transition language + caption styling + overlay density as typed,
 * customizable config — and (critically) it WIRES those into Assembly, closing the
 * dead loop where CutSheet.transitions/captionStyle were produced-and-ignored.
 *
 * The editor is the AUTHORITY on pacing/transitions; Assembly is the renderer that
 * executes them (crew directs → module renders — the Director model in miniature).
 */
import { moduleParams, type ChannelProfile } from "@/engine/channelProfile";
import { resolveKnobs, type KnobValue, type CustomizationSurface } from "@/engine/customization";

export const EDITOR_SURFACE: CustomizationSurface = {
  capabilities: [
    "cut cadence (cuts/min) per channel/video",
    "transition language (drives Assembly)",
    "caption styling intent",
    "overlay density (how many quote/insert cards)",
  ],
  knobs: [
    { id: "cadence", type: "enum", values: ["still", "slow", "measured", "snappy", "frenetic"], default: "measured", describes: "cut rhythm → cuts/min", servesStyles: ["documentary", "shorts"] },
    { id: "transitions", type: "enum", values: ["hardcut", "crossfade", "dip_to_black"], default: "hardcut", describes: "between-shot transition (→ Assembly renderHints)", servesStyles: ["documentary", "hype"] },
    { id: "captionStyle", type: "enum", values: ["none", "minimal", "karaoke", "bold"], default: "minimal", describes: "caption look (→ Assembly caption pass)", servesStyles: ["shorts", "accessibility"] },
    { id: "overlayDensity", type: "enum", values: ["sparse", "standard", "rich"], default: "standard", describes: "how many quote/insert overlays", servesStyles: ["explainer"] },
    { id: "pacingShape", type: "enum", values: ["flat", "accelerate", "frontload"], default: "flat", describes: "cut-pacing CURVE over the body — flat / build-to-climax / front-loaded hook (not one constant cuts/min)", servesStyles: ["hype", "shorts", "documentary"] },
  ],
  presets: {
    documentary: { cadence: "slow", transitions: "crossfade", captionStyle: "minimal", overlayDensity: "rich" },
    essay: { cadence: "measured", transitions: "hardcut", captionStyle: "minimal", overlayDensity: "standard" },
    hype: { cadence: "frenetic", transitions: "hardcut", captionStyle: "bold", overlayDensity: "rich", pacingShape: "accelerate" },
    shorts: { cadence: "frenetic", transitions: "hardcut", captionStyle: "karaoke", overlayDensity: "sparse", pacingShape: "frontload" },
    meditation: { cadence: "still", transitions: "crossfade", captionStyle: "none", overlayDensity: "sparse" },
    lofi: { cadence: "still", transitions: "crossfade", captionStyle: "none", overlayDensity: "sparse" },
  },
};

/** cadence → cuts/min. `measured` is undefined ⇒ Assembly's legacy length-based cadence. */
const CADENCE_CPM: Record<string, number | undefined> = { still: 2, slow: 3, measured: undefined, snappy: 8, frenetic: 15 };

export interface EditorConfig {
  cadence: string;
  /** cuts/min (undefined for `measured` ⇒ legacy length-based). */
  cutsPerMin?: number;
  transitions: string;
  captionStyle: string;
  overlayDensity: string;
  /** Pacing curve shape over the body: flat / accelerate (build) / frontload (hook). */
  pacingShape: string;
}

/** Base cuts/min used to anchor the pacing CURVE (measured → 6 for curve math). */
const CADENCE_BASE: Record<string, number> = { still: 2, slow: 3, measured: 6, snappy: 8, frenetic: 15 };

/** Build a pacing curve ({atFrac,cutsPerMin}[]) from a base cuts/min + a shape. `flat` ⇒ undefined (Assembly keeps its constant cadence = parity). */
export function buildPacingCurve(shape: string, baseCpm: number): { atFrac: number; cutsPerMin: number }[] | undefined {
  const b = Math.max(1, baseCpm);
  if (shape === "accelerate") return [{ atFrac: 0, cutsPerMin: b }, { atFrac: 1, cutsPerMin: Math.round(b * 1.6) }]; // build to climax
  if (shape === "frontload") return [{ atFrac: 0, cutsPerMin: Math.round(b * 1.6) }, { atFrac: 0.15, cutsPerMin: Math.round(b * 1.6) }, { atFrac: 0.22, cutsPerMin: b }, { atFrac: 1, cutsPerMin: b }]; // fast hook, settle
  return undefined; // flat
}

export const EDITOR_BLOCK = "editor_brief";

/** Resolve the editor's per-channel config from the ChannelProfile (preset + overrides). Pure. */
export function resolveEditorConfig(profile: ChannelProfile, block = EDITOR_BLOCK): EditorConfig {
  const raw = moduleParams(profile, block);
  const preset = typeof raw["preset"] === "string" ? (raw["preset"] as string) : undefined;
  const overrides: Record<string, KnobValue> = {};
  for (const k of EDITOR_SURFACE.knobs) {
    const v = raw[k.id];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") overrides[k.id] = v;
  }
  const r = resolveKnobs(EDITOR_SURFACE, preset, overrides);
  if (!r.ok) throw new Error(`resolveEditorConfig: ${r.errors.join("; ")}`);
  const k = r.values;
  return {
    cadence: String(k.cadence),
    cutsPerMin: CADENCE_CPM[String(k.cadence)],
    transitions: String(k.transitions),
    captionStyle: String(k.captionStyle),
    overlayDensity: String(k.overlayDensity),
    pacingShape: String(k.pacingShape),
  };
}

/** The editor's structured directives for Assembly's planTimeline — the WIRE that closes the dead loop. */
export interface EditorDirectives {
  transitions?: string;
  cutsPerMin?: number;
  captionStyle?: string;
  overlayDensity?: string;
  /** Pacing CURVE (0–1 body position → cuts/min). Present only when pacingShape != flat. */
  pacingCurve?: { atFrac: number; cutsPerMin: number }[];
}

/** Map an EditorConfig to the directives Assembly's planTimeline consumes. */
export function editorDirectives(cfg: EditorConfig): EditorDirectives {
  const baseCpm = cfg.cutsPerMin ?? CADENCE_BASE[cfg.cadence] ?? 6;
  return {
    transitions: cfg.transitions,
    cutsPerMin: cfg.cutsPerMin,
    captionStyle: cfg.captionStyle,
    overlayDensity: cfg.overlayDensity,
    pacingCurve: buildPacingCurve(cfg.pacingShape, baseCpm),
  };
}

export const EDITOR_MODULE = {
  key: "editor_brief",
  title: "Crew · Editor",
  stage: "brief",
  does:
    "The editor owns cut cadence + transition language + caption styling + overlay density as typed config, " +
    "and feeds them into Assembly (transitions → renderHints, cadence → cuts/min, captionStyle → caption pass). " +
    "Crew directs, Assembly renders.",
  produces: { kind: "editor_config", file: "n/a", returns: "EditorConfig { cadence, cutsPerMin, transitions, captionStyle, overlayDensity }" },
  requires: { channelProfile: "ChannelProfile — supplies editor preset + overrides (moduleConfig['editor_brief'])" },
  optional: {},
  needs: { secrets: [] as string[], tools: [], note: "Pure resolver; the editor LLM brief refines per-video, the structured config drives the render deterministically." },
  customization: EDITOR_SURFACE,
  rules: [
    "EDITOR DIRECTS ASSEMBLY: transitions + cadence + captionStyle flow editor → planTimeline (no longer dead).",
    "PER-ACCOUNT: all editor choices come from moduleConfig['editor_brief'] (preset + overrides).",
    "`measured` cadence ⇒ Assembly's legacy length-based cut timing (parity).",
  ],
} as const;
