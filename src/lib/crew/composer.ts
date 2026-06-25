/**
 * Composer — a per-channel CREW SUB-MODULE. The composer owns the music mix: how hard
 * the bed ducks under narration, the master loudness target, and a narration voice FX.
 * It WIRES those into Assembly's audio — closing the dead loop where AudioBrief.duckDb /
 * bedLufs were produced-and-ignored. (duckDepth → Assembly duck level; loudness →
 * Assembly's now-live loudnorm target.)
 */
import { moduleParams, type ChannelProfile } from "@/engine/channelProfile";
import { resolveKnobs, type KnobValue, type CustomizationSurface } from "@/engine/customization";

export const COMPOSER_SURFACE: CustomizationSurface = {
  capabilities: [
    "music-bed duck depth under narration (→ Assembly duck level)",
    "master loudness target LUFS (→ Assembly loudnorm)",
    "narration voice FX (radio / warm / telephone)",
    "music mood hint (→ the music prompt)",
  ],
  knobs: [
    { id: "musicMood", type: "enum", values: ["calm", "warm", "neutral", "tense", "uplifting"], default: "neutral", describes: "emotional palette of the score (hint to the music prompt)", servesStyles: ["meditation", "hype"] },
    { id: "duckDepth", type: "enum", values: ["none", "gentle", "standard", "deep"], default: "standard", describes: "how far the music bed ducks under the voice", servesStyles: ["lofi", "documentary", "asmr"] },
    { id: "loudness", type: "number", range: [-23, -12], default: -14, describes: "master integrated-loudness target (LUFS) → Assembly loudnorm", servesStyles: ["platform"] },
    { id: "voiceFx", type: "enum", values: ["none", "radio", "warm", "telephone"], default: "none", describes: "narration filter", servesStyles: ["noir", "vintage"] },
  ],
  presets: {
    documentary: { musicMood: "neutral", duckDepth: "standard", loudness: -14, voiceFx: "none" },
    essay: { duckDepth: "standard", loudness: -14 },
    hype: { musicMood: "uplifting", duckDepth: "gentle", loudness: -13 },
    shorts: { musicMood: "uplifting", duckDepth: "gentle", loudness: -12, voiceFx: "none" },
    meditation: { musicMood: "calm", duckDepth: "gentle", loudness: -16, voiceFx: "warm" },
    lofi: { musicMood: "calm", duckDepth: "none", loudness: -14 }, // music-forward, no duck
  },
};

/** duckDepth → body music volume (linear). `standard` == the legacy Assembly default (parity). */
const DUCK_DEPTH_VOL: Record<string, number> = { none: 1.0, gentle: 0.25, standard: 0.1026, deep: 0.04 };

export interface ComposerConfig {
  musicMood: string;
  /** Body music volume (linear) the bed ducks to under narration. */
  bodyMusicVol: number;
  /** Master loudness target (LUFS) → Assembly loudnorm. */
  targetLufs: number;
  voiceFx: string;
}

export const COMPOSER_BLOCK = "composer_brief";

/** Resolve the composer's per-channel config from the ChannelProfile (preset + overrides). Pure. */
export function resolveComposerConfig(profile: ChannelProfile, block = COMPOSER_BLOCK): ComposerConfig {
  const raw = moduleParams(profile, block);
  const preset = typeof raw["preset"] === "string" ? (raw["preset"] as string) : undefined;
  const overrides: Record<string, KnobValue> = {};
  for (const k of COMPOSER_SURFACE.knobs) {
    const v = raw[k.id];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") overrides[k.id] = v;
  }
  const r = resolveKnobs(COMPOSER_SURFACE, preset, overrides);
  if (!r.ok) throw new Error(`resolveComposerConfig: ${r.errors.join("; ")}`);
  const k = r.values;
  return {
    musicMood: String(k.musicMood),
    bodyMusicVol: DUCK_DEPTH_VOL[String(k.duckDepth)] ?? DUCK_DEPTH_VOL.standard,
    targetLufs: Number(k.loudness),
    voiceFx: String(k.voiceFx),
  };
}

/** The composer's directives for Assembly's planTimeline — closes the duckDb/bedLufs dead loop. */
export interface ComposerDirectives {
  bodyMusicVol?: number;
  targetLufs?: number;
  voiceFx?: string;
}

export function composerDirectives(cfg: ComposerConfig): ComposerDirectives {
  return { bodyMusicVol: cfg.bodyMusicVol, targetLufs: cfg.targetLufs, voiceFx: cfg.voiceFx === "none" ? undefined : cfg.voiceFx };
}

export const COMPOSER_MODULE = {
  key: "composer_brief",
  title: "Crew · Composer",
  stage: "brief",
  does:
    "The composer owns the music mix: duck depth under narration → Assembly's duck level, master loudness " +
    "target → Assembly's loudnorm pass, and a narration voice FX. Closes the duckDb/bedLufs dead loop.",
  produces: { kind: "composer_config", file: "n/a", returns: "ComposerConfig { musicMood, bodyMusicVol, targetLufs, voiceFx }" },
  requires: { channelProfile: "ChannelProfile — supplies composer preset + overrides (moduleConfig['composer_brief'])" },
  optional: {},
  needs: { secrets: [] as string[], tools: [], note: "Pure resolver; the music prompt + voice FX are realised downstream (music block + Assembly audio)." },
  customization: COMPOSER_SURFACE,
  rules: [
    "COMPOSER DIRECTS THE MIX: duckDepth → Assembly duck level; loudness → Assembly loudnorm target (both now LIVE).",
    "PER-ACCOUNT: all mix choices come from moduleConfig['composer_brief'] (preset + overrides).",
    "`standard` duck == the legacy Assembly body-music volume (parity).",
  ],
} as const;
