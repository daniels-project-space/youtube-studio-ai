/**
 * Thumbnail art-direction formula — researched YouTube CTR best practices baked
 * into per-archetype style presets + the Style-DNA style builder, so EVERY
 * channel gets an on-brand, consistent look. Pure data; no I/O. Consumed by the
 * banana engine surfaces (thumbnail_gen real-scene path + the week-ahead
 * planner) as scene/look grounding for the design brief.
 *
 * The formula (high-CTR thumbnail fundamentals):
 *  1. ONE dominant focal subject — no clutter; the eye lands instantly.
 *  2. Human/emotional element — a face, figure or evocative subject; gaze and
 *     expression pull clicks.
 *  3. High contrast + dramatic lighting — subject pops off the background
 *     (rim light, chiaroscuro), readable as a tiny mobile tile.
 *  4. Off-center composition (rule of thirds) — leaves clean NEGATIVE SPACE for
 *     the title; subject and text never fight.
 *  5. Bold minimal text — 3-5 words MAX, huge, heavy outline + drop shadow,
 *     legible at ~120px wide. Text ADDS curiosity, never just repeats the title.
 *  6. Limited palette + ONE accent pop — cohesive brand color with a single
 *     high-energy accent (amber/gold/red) for stopping power.
 *  7. Depth & atmosphere — haze, smoke, bokeh, particles add cinematic richness.
 *  8. Brand consistency — same subject family, palette and font per channel so
 *     viewers recognize the channel at a glance.
 *  9. Generate the art TEXT-FREE (image models botch lettering); overlay clean,
 *     controlled text afterward.
 */

export interface ThumbnailStyle {
  /** Human label. */
  label: string;
  /** Art-direction phrase injected into the (text-free) Flux base prompt. */
  art: string;
  /** Palette / accent guidance. */
  palette: string;
  /** Title overlay style — font family + casing + accent. */
  title: {
    /** 'serif' | 'sans' — resolved to a concrete cloud font in ffmpeg. */
    font: "serif" | "sans";
    uppercase: boolean;
    /** Hex accent for an optional highlighted keyword (or null = all white). */
    accent: string | null;
  };
}

/**
 * Per-archetype style presets. `default` is the general formula any new channel
 * inherits; the others specialise it. Keyed by archetype key OR template letter.
 */
export const THUMBNAIL_STYLES: Record<string, ThumbnailStyle> = {
  // A — narrated essay (philosophy / stoicism): the look Daniel approved.
  // (The old left-two-thirds negative-space contract is gone — the banana
  // engine owns text layout and that contract caused the timid look.)
  "narrated-essay": {
    label: "Stoic sculpture",
    art:
      "A pristine ancient Greco-Roman marble bust of a bearded stoic philosopher, luminous " +
      "light-grey and white marble glowing softly against a near-black void, volumetric god " +
      "rays and floating light dust, cinematic chiaroscuro depth.",
    palette: "near-black background, bright light-grey / white marble, warm volumetric god-ray glow, amber accent",
    title: { font: "serif", uppercase: true, accent: null },
  },
  // B — crime / mystery.
  "crime-narrative": {
    label: "Noir mystery",
    art:
      "A tense cinematic crime-mystery scene: a single ominous subject (a lone " +
      "silhouetted figure, an empty car at night, a half-open door) under harsh " +
      "directional light, deep fog and shadow, gritty noir atmosphere, unsettling mood.",
    palette: "cold desaturated blues and blacks with one harsh blood-red accent",
    title: { font: "sans", uppercase: true, accent: "#ff3b30" },
  },
  // E — meditation / sleep.
  meditation: {
    label: "Serene dawn",
    art:
      "A serene calming landscape at soft dawn or dusk: gentle mist over still water " +
      "or rolling hills, a tiny lone figure for scale, dreamy soft light, airy and " +
      "peaceful, lots of open sky.",
    palette: "soft pastel dawn tones, lavender and warm gold, gentle low contrast",
    title: { font: "serif", uppercase: false, accent: null },
  },
  // C — lofi / ambient music (art carries it; text stays small).
  "lofi-ambient": {
    label: "Cozy lofi",
    art:
      "A cozy illustrated anime/lofi scene: a warm-lit interior with a rainy " +
      "neon-soaked city window, soft bokeh, nostalgic and calm, hand-painted feel.",
    palette: "warm interior glow against cool neon blues and pinks, soft bokeh",
    title: { font: "sans", uppercase: false, accent: "#2ee6ff" },
  },
  // D — shorts (vertical, extreme simplicity).
  shorts: {
    label: "Punchy short",
    art:
      "An extreme close-up of a single bold subject, vivid saturated color, simple " +
      "uncluttered background, maximum stopping power.",
    palette: "one vivid saturated hero color against a clean contrasting background",
    title: { font: "sans", uppercase: true, accent: "#ffd400" },
  },
  // Generic fallback — the formula applied to whatever the topic is.
  default: {
    label: "Cinematic default",
    art:
      "A single striking subject that captures the essence of the topic, dramatic " +
      "cinematic lighting, rich atmosphere, premium high-production-value look.",
    palette: "cohesive limited palette with one high-energy accent color",
    title: { font: "sans", uppercase: true, accent: "#ffd400" },
  },
};

/**
 * Build the channel's thumbnail style FROM ITS STYLE DNA — the research-
 * distilled per-channel spec. This is the ONE source of truth for every
 * thumbnail surface (render pipeline AND the week-ahead planner): when a
 * channel has a DNA thumbnail subject, the template-letter preset must never
 * win (template-A leakage put Greek marble busts on a finance channel's
 * entire content plan).
 */
export function styleFromDNA(dna?: {
  thumbnail?: { composition?: string; textRule?: string; palette?: string[]; subject?: string };
  palette?: string[];
  recurringSubject?: string;
  setting?: string;
  colorGrade?: string;
} | null): ThumbnailStyle | null {
  const t = dna?.thumbnail;
  const subject = t?.subject || dna?.recurringSubject;
  if (!subject) return null;
  const palette = (t?.palette?.length ? t.palette : dna?.palette) ?? [];
  return {
    label: "Style DNA",
    art:
      `${subject}. ` +
      (t?.composition ? `${t.composition}. ` : "") +
      (dna?.setting ? `World/mood: ${dna.setting}. ` : "") +
      (dna?.colorGrade ? `Grade: ${dna.colorGrade}.` : ""),
    palette: palette.length ? palette.join(", ") : THUMBNAIL_STYLES.default.palette,
    title: { font: "sans", uppercase: true, accent: palette[1] ?? null },
  };
}

/** Resolve a style preset from an explicit key, archetype, or template letter. */
export function resolveThumbnailStyle(key?: string): ThumbnailStyle {
  if (!key) return THUMBNAIL_STYLES.default;
  if (THUMBNAIL_STYLES[key]) return THUMBNAIL_STYLES[key];
  const byTemplate: Record<string, string> = {
    A: "narrated-essay",
    B: "crime-narrative",
    C: "lofi-ambient",
    D: "shorts",
    E: "meditation",
  };
  const mapped = byTemplate[key.toUpperCase()];
  return (mapped && THUMBNAIL_STYLES[mapped]) || THUMBNAIL_STYLES.default;
}

/** Punchy 3-4 word fallback title derived from the full video title. */
export function shortTitleFallback(fullTitle: string): string {
  const stop = new Set([
    "the", "a", "an", "to", "of", "and", "or", "for", "in", "on", "with", "your",
    "you", "how", "why", "what", "is", "are", "this", "that", "from", "at", "by",
  ]);
  const words = fullTitle.replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !stop.has(w.toLowerCase()));
  const pick = (kept.length >= 2 ? kept : words).slice(0, 4);
  return pick.join(" ") || fullTitle.slice(0, 24);
}
