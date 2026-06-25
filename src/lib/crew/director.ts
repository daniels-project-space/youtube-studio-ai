/**
 * Director — a per-channel CREW SUB-MODULE. The director owns the STORY: hook style,
 * narrative arc, pacing, beat count, and whether beats become on-screen chapters.
 * It WIRES the structure into Assembly — turning the director's beat map (each beat's
 * intended seconds) into a chapterPlan, closing the dead loop where StructureBrief.beats
 * `intentSec` was dropped. (Beats already inform the script; intentSec now drives chapters.)
 */
import { moduleParams, type ChannelProfile } from "@/engine/channelProfile";
import { resolveKnobs, type KnobValue, type CustomizationSurface } from "@/engine/customization";

export const DIRECTOR_SURFACE: CustomizationSurface = {
  capabilities: [
    "hook style (cold-open / question / bold-claim / in-media-res)",
    "narrative arc (essay / chronological / problem-solution / listicle / mystery)",
    "pacing + beat count (shapes the structure brief)",
    "beats → on-screen chapters (intentSec → Assembly chapter windows)",
  ],
  knobs: [
    { id: "hookStyle", type: "enum", values: ["cold_open", "question", "bold_claim", "in_media_res"], default: "cold_open", describes: "the opening device", servesStyles: ["shorts", "hype"] },
    { id: "narrativeArc", type: "enum", values: ["essay", "chronological", "problem_solution", "listicle", "mystery"], default: "essay", describes: "beat-map shape", servesStyles: ["documentary", "explainer"] },
    { id: "pacing", type: "enum", values: ["slow", "steady", "brisk"], default: "steady", describes: "narrative pace (hint to the brief)", servesStyles: ["meditation", "shorts"] },
    { id: "beatCount", type: "number", range: [3, 12], default: 6, describes: "how many story beats", servesStyles: ["documentary", "shorts"] },
    { id: "useChapters", type: "boolean", default: false, describes: "render beats as on-screen chapter cards (→ Assembly)", servesStyles: ["documentary", "explainer"] },
  ],
  presets: {
    documentary: { narrativeArc: "chronological", pacing: "slow", beatCount: 8, useChapters: true, hookStyle: "cold_open" },
    essay: { narrativeArc: "essay", pacing: "steady", useChapters: false },
    hype: { hookStyle: "bold_claim", pacing: "brisk", beatCount: 5 },
    shorts: { hookStyle: "in_media_res", pacing: "brisk", beatCount: 3, useChapters: false },
    meditation: { narrativeArc: "essay", pacing: "slow", beatCount: 4, useChapters: false },
    lofi: { beatCount: 3, useChapters: false },
  },
};

export interface DirectorConfig {
  hookStyle: string;
  narrativeArc: string;
  pacing: string;
  beatCount: number;
  useChapters: boolean;
}

export const DIRECTOR_BLOCK = "director_brief";

export function resolveDirectorConfig(profile: ChannelProfile, block = DIRECTOR_BLOCK): DirectorConfig {
  const raw = moduleParams(profile, block);
  const preset = typeof raw["preset"] === "string" ? (raw["preset"] as string) : undefined;
  const overrides: Record<string, KnobValue> = {};
  for (const k of DIRECTOR_SURFACE.knobs) {
    const v = raw[k.id];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") overrides[k.id] = v;
  }
  const r = resolveKnobs(DIRECTOR_SURFACE, preset, overrides);
  if (!r.ok) throw new Error(`resolveDirectorConfig: ${r.errors.join("; ")}`);
  const k = r.values;
  return {
    hookStyle: String(k.hookStyle),
    narrativeArc: String(k.narrativeArc),
    pacing: String(k.pacing),
    beatCount: Number(k.beatCount),
    useChapters: Boolean(k.useChapters),
  };
}

/** A story beat from the director's StructureBrief. */
export interface StructureBeat {
  name: string;
  intentSec: number;
  note?: string;
}

/** A planTimeline-shaped chapter window. */
export interface ChapterWindow {
  kind: "footage" | "card";
  durSec: number;
  heading?: string;
}

/**
 * Turn the director's beat map into an Assembly chapterPlan — THE wire that closes the
 * dead `intentSec`: each beat becomes a heading card (cardSec) + a footage window of the
 * beat's intended seconds. Returns undefined when chapters are off (Assembly stays in
 * beat-body mode). Pure.
 */
export function directorChapterPlan(beats: StructureBeat[], cfg: DirectorConfig, cardSec = 4): ChapterWindow[] | undefined {
  if (!cfg.useChapters || !beats || beats.length === 0) return undefined;
  const plan: ChapterWindow[] = [];
  for (const b of beats) {
    if (!b?.name) continue;
    plan.push({ kind: "card", durSec: Math.max(2, cardSec), heading: b.name });
    plan.push({ kind: "footage", durSec: Math.max(1, Math.round(b.intentSec || 0)) });
  }
  return plan.length ? plan : undefined;
}

export const DIRECTOR_MODULE = {
  key: "director_brief",
  title: "Crew · Director",
  stage: "brief",
  does:
    "The director owns story structure: hook style, narrative arc, pacing, beat count, and whether the beat " +
    "map becomes on-screen chapters. Beats feed the script; with chapters on, each beat's intended seconds " +
    "drive an Assembly chapter window (closing the dead intentSec loop).",
  produces: { kind: "director_config", file: "n/a", returns: "DirectorConfig + directorChapterPlan(beats) → Assembly chapterPlan" },
  requires: { channelProfile: "ChannelProfile — supplies director preset + overrides (moduleConfig['director_brief'])" },
  optional: {},
  needs: { secrets: [] as string[], tools: [], note: "Pure resolver + chapterPlan builder; the structure brief itself is authored by the director LLM." },
  customization: DIRECTOR_SURFACE,
  rules: [
    "DIRECTOR OWNS STRUCTURE: hook/arc/pacing/beatCount shape the brief; useChapters → beats become Assembly chapters.",
    "intentSec WIRED: beat intended-seconds → chapter footage-window durations (was dropped).",
    "PER-ACCOUNT: all structure choices come from moduleConfig['director_brief'] (preset + overrides).",
  ],
} as const;
