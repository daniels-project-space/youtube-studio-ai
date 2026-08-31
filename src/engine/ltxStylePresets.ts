/**
 * LTX STYLE PRESET REGISTRY — the visual "worlds" the LTX 2.5 render module
 * can speak, plus the prompt-guidance intelligence for each.
 *
 * One pure-data module (no node deps) shared by whatever later wave wires it
 * into the model-agnostic I2V prompt contract (see src/lib/ltxI2vPrompt.ts).
 * That contract assembles a shot's Source-frame anchor / Continuous
 * development / Diegetic soundscape clauses from per-shot data; this
 * registry supplies the per-STYLE defaults those clauses fall back to so a
 * whole render can be pointed at one coherent visual world instead of
 * re-typing the same look into every shot.
 *
 * Mirrors the shape and intent of src/remotion/docuStyles.ts: one const per
 * style, assembled into a Record, with a safe-fallback lookup function.
 * Adding a new LTX look = adding one LtxStyleDef.
 */

/** Prose fragments merged into the shared LTX I2V prompt contract clauses. */
export interface LtxStylePromptGuidance {
  /** Merged into the I2V contract's Source-frame anchor clause (visual/material look). */
  appearance: string;
  /** Merged into Continuous development (color grade, lighting doctrine). */
  lightingColor: string;
  /** Merged into Continuous development (camera movement vocabulary for this world). */
  cameraDoctrine: string;
  /** Default Diegetic soundscape phrasing when a shot doesn't specify its own. */
  soundscapeDefault: string;
}

export interface LtxStyleDef {
  id: string;
  label: string;
  /** Shown to the planner: the visual world to design within. */
  worldDescription: string;
  promptGuidance: LtxStylePromptGuidance;
  /**
   * Pointers into docs/LTX_STYLE_LORA_CANDIDATES.md — not-yet-live LoRA
   * adapter ids this style would eventually pin via ltxCreativeAdapter.ts.
   * Empty-safe: no adapter resolves today, so callers must tolerate an
   * empty or non-resolving list without failing a render.
   */
  candidateAdapterIds: readonly string[];
  /**
   * Film-grain opacity and vignette strength, 0-1 — the SAME numeric scale
   * as DocuTheme.grain/vignette in src/remotion/docuStyles.ts, so an
   * LTX-rendered cinematic shot reads consistently with the deterministic
   * Remotion-rendered documentary look it may sit beside in one assembled
   * video, rather than inventing a second unrelated scale. This is a
   * POST-RENDER finishing pass applied at final ffmpeg assembly (see
   * filmGrainVignetteFilter / applyFilmGrainVignette / composeWithIntro's
   * `filmGrain` option in src/lib/ffmpeg.ts) — it is never baked into the
   * LTX generation prompt itself.
   */
  grain: number;
  vignette: number;
}

/* ----------------------------------------------------- CINEMATIC HEIST NOIR -- */

/**
 * DEFAULT / FALLBACK STYLE. This is a hard backward-compatibility contract:
 * a caller who does not specify a style must get output equivalent to
 * today's current behavior. The "cinematic" family (src/engine/families.ts,
 * archetypeKey: "crime-narrative") has always rendered through this exact
 * look, inherited from the robbery_noir DocuStyleDef in docuStyles.ts — the
 * prose below reuses that established teal-and-amber heist-reconstruction
 * vocabulary rather than inventing a new one.
 */
const CINEMATIC_HEIST_NOIR: LtxStyleDef = {
  id: "cinematic_heist_noir",
  label: "Cinematic Heist Noir",
  worldDescription:
    "a cinematic true-crime channel that reconstructs real robberies and heists: dim bank vaults and jewellery " +
    "counters, getaway cars on wet night streets, security-camera stills, blueprints and floor plans, gloved hands " +
    "and cracked safes — each reconstructed scene given living 2.5D depth so the camera drifts THROUGH the moment.",
  promptGuidance: {
    appearance:
      "cinematic crime-reconstruction frame — moody low-key lighting, deep depth of field with a CLEAR foreground " +
      "subject and a distinctly separated background, fine film grain, tense and filmic; looks like a still from a " +
      "heist thriller or a grainy security reconstruction, never staged or theatrical.",
    lightingColor:
      "teal-and-amber night grade: cold teal shadow fill against warm amber practicals (desk lamps, vault indicator " +
      "lights, streetlight sodium glow), strong tonal separation between subject and surroundings, dramatic single-" +
      "source key light with hard falloff into darkness at the frame edges.",
    cameraDoctrine:
      "the camera moves THROUGH the scene like a reconstruction documentary: slow push_in to enter a space and build " +
      "tension, pull_back to reveal the aftermath or the scale of the job, gentle depth-parallax drift through pinned " +
      "evidence and blueprints; never a snap cut or a whip pan — every move is deliberate, motivated, and unhurried.",
    soundscapeDefault:
      "restrained interior tone: distant traffic or rain on glass, a ticking clock or vault mechanism, gloved " +
      "footsteps on hard flooring, and the low electrical hum of security equipment — no score, no stingers.",
  },
  candidateAdapterIds: ["ltx-creative-heist-noir-grain", "ltx-creative-teal-amber-grade"],
  // Mirrors robbery_noir's DocuTheme (docuStyles.ts) — same heist-reconstruction
  // world, same grade intensity.
  grain: 0.09,
  vignette: 0.74,
};

/* -------------------------------------------------- DOCUMENTARY MANNEQUIN -- */

/**
 * Heist/documentary reconstruction style built on the faceless-mannequin
 * identity-lock vocabulary already established across the cinematic
 * pipeline (src/lib/cinematicClipGate.ts, cinematicTransitionGate.ts,
 * cinematicKeyframeGate.ts, src/trigger/blocks/narratedBlocks.ts,
 * src/engine/cinematicCaseSequenceDraft.ts). Reuses that exact phrasing so
 * this style stays inside the existing content-safety contract instead of
 * drifting into new identity-treatment language.
 */
const DOCUMENTARY_MANNEQUIN: LtxStyleDef = {
  id: "documentary_mannequin",
  label: "Documentary Mannequin Reconstruction",
  worldDescription:
    "a source-bound documentary reconstruction channel: every human figure is a faceless mannequin — anonymous " +
    "identity treatment locked across wardrobe silhouette, material, palette, and key props — moving through " +
    "reviewed real-world scenes with case-file rigor, evidence photographs, and location-accurate staging.",
  promptGuidance: {
    appearance:
      "source-bound faceless mannequin reconstruction: preserve the visible subject's anonymous identity treatment " +
      "(no face, no distinguishing likeness), wardrobe silhouette, material and palette, and key props exactly as " +
      "supplied; unglamorous, evidentiary, real-world staging with no stylization beyond a restrained documentary " +
      "grade.",
    lightingColor:
      "flat, truthful reconstruction lighting: practical location sources only (overhead fluorescents, window " +
      "daylight, desk lamps), minimal grade beyond a light desaturation, no dramatic color push — the lighting " +
      "should read as observed, not designed.",
    cameraDoctrine:
      "the camera behaves like a locked reconstruction rig: steady push_in or hold on the mannequin cast performing " +
      "one coherent action, slow pans across evidence and environment, no handheld shake and no stylistic flourish " +
      "— every move exists to keep the anonymous identity treatment, wardrobe, and prop locks legible.",
    soundscapeDefault:
      "plain location tone only: room ambience, footsteps, cloth and paper handling sounds motivated strictly by the " +
      "visible action — no music, no foley embellishment beyond what the scene would actually produce.",
  },
  candidateAdapterIds: ["ltx-creative-mannequin-identity-lock", "ltx-creative-evidentiary-grade"],
  // Evidentiary case-file rigor, closer to detective_board's DocuTheme than
  // heist_noir's — truthful reconstruction light means a lighter grain and a
  // slightly softer vignette than the stylized heist look.
  grain: 0.08,
  vignette: 0.62,
};

/* ---------------------------------------------------------------- ANIME -- */

const ANIME: LtxStyleDef = {
  id: "anime",
  label: "Anime / Cel-Shaded",
  worldDescription:
    "a cel-shaded 2D animation world: flat saturated color fields separated by bold clean linework, stylized " +
    "non-photoreal lighting rendered as hard-edged shade shapes rather than gradients, and dynamic motion-accent " +
    "framing that leans into speed lines, impact frames, and exaggerated poses.",
  promptGuidance: {
    appearance:
      "cel-shaded anime illustration — flat saturated color fields with crisp bold outline linework, simplified " +
      "facial and material shading rendered as discrete shade shapes (not photoreal gradients), clean vector-like " +
      "edges, no photographic grain or lens artifacts.",
    lightingColor:
      "stylized non-photoreal lighting: high-saturation flat color blocks for base tones, a single hard-edged " +
      "highlight shape and a single hard-edged shadow shape per surface (two-tone cel shading), vivid complementary " +
      "accent colors for rim light and mood washes rather than naturalistic color temperature.",
    cameraDoctrine:
      "dynamic motion-accent framing: quick push_in on impact beats with a held impact-frame pause, whip-pan or " +
      "speed-line-accompanied redirects on action turns, dramatic low-angle or Dutch-tilt holds for tension — camera " +
      "moves read as deliberately exaggerated, not naturalistic.",
    soundscapeDefault:
      "stylized foley-forward soundscape: crisp exaggerated footsteps, fabric snaps, and impact hits motivated by the " +
      "visible action, with an anime-style ambient room tone underneath — no score, no dialogue.",
  },
  candidateAdapterIds: ["ltx-creative-anime-ic", "ltx-creative-cel-shading"],
  // Flat cel-shaded color fields read as broken/dirty under photographic film
  // grain — keep both very light, just enough vignette to frame the action.
  grain: 0.02,
  vignette: 0.15,
};

/* ------------------------------------------------------- PHOTOREALISTIC -- */

const PHOTOREALISTIC: LtxStyleDef = {
  id: "photorealistic",
  label: "Photorealistic",
  worldDescription:
    "a naturalistic photographic-realism world: accurate skin and material shading under real-world light behavior, " +
    "true optical lens characteristics, and documentary-grade lighting truthfulness — the image should be " +
    "indistinguishable from an actual photograph or unstaged video capture.",
  promptGuidance: {
    appearance:
      "naturalistic photographic realism — accurate skin subsurface scattering and pore-level material detail, " +
      "true-to-life fabric weave and surface texture, correct real-world proportions and physics; no illustrative, " +
      "painterly, or stylized rendering of any kind.",
    lightingColor:
      "documentary-grade lighting truthfulness: light behaves exactly as its visible sources would predict (soft " +
      "window light wraps correctly, practicals fall off at physically correct rates), natural uncorrected color " +
      "temperature per source, no artificial color grade push beyond what a real camera sensor would capture.",
    cameraDoctrine:
      "real-world lens behavior governs every move: natural depth of field with physically plausible bokeh falloff, " +
      "handheld micro-shake or tripod-locked stillness as the scene warrants, focus racks that follow actual subject " +
      "movement — no impossible camera paths or unmotivated speed changes.",
    soundscapeDefault:
      "true ambient location recording: room tone, distant traffic or nature sound appropriate to the setting, and " +
      "physical sound effects exactly matched to the visible action — nothing embellished or added for effect.",
  },
  candidateAdapterIds: ["ltx-creative-photoreal-skin", "ltx-creative-natural-lens"],
  // Documentary-grade truthfulness — a real camera sensor's own noise floor,
  // no stylized push. Subtle grain, light natural lens vignette only.
  grain: 0.04,
  vignette: 0.22,
};

/* ------------------------------------------------------------ WATERCOLOR -- */

const WATERCOLOR: LtxStyleDef = {
  id: "watercolor",
  label: "Watercolor",
  worldDescription:
    "a painterly translucent-medium world: soft bled pigment edges pooling into visible paper grain, a muted " +
    "natural palette built from glaze-layered washes, and a gentle organic stillness — this world reads as a living " +
    "painting, not a photograph pretending to move.",
  promptGuidance: {
    appearance:
      "watercolor painting on textured paper — soft bled pigment edges where colors feather into one another, " +
      "visible paper/canvas grain showing through thin washes, glaze-layered translucent color builds depth instead " +
      "of opaque coverage; no hard photographic edges, no crisp outlines, everything reads as painted.",
    lightingColor:
      "muted natural palette with glaze-layered color: light is suggested through overlapping translucent washes " +
      "rather than rendered highlights, soft desaturated earth and pastel tones, warmth built up in thin layers " +
      "rather than a single bright highlight — no hard specular light of any kind.",
    cameraDoctrine:
      "gentle organic camera drift only — no snap motion, no whip pans, no fast pushes; this medium reads as static " +
      "or slowly painted, so every move is a slow drift, a barely-perceptible pan, or a soft settle, as if the " +
      "painting itself is breathing rather than being filmed.",
    soundscapeDefault:
      "soft ambient texture: gentle wind, distant birdsong, or quiet water sound appropriate to the scene, kept " +
      "faint and unobtrusive to match the medium's quiet stillness — no music, no sharp foley hits.",
  },
  candidateAdapterIds: ["ltx-creative-watercolor-bleed", "ltx-creative-paper-grain"],
  // The medium's own paper grain and soft edges already carry the texture —
  // a photographic film-grain/vignette pass would fight the painted look, so
  // both stay near-zero.
  grain: 0.01,
  vignette: 0.1,
};

/* ------------------------------------------------------ MUSIC VIDEO CINEMATIC -- */

const MUSIC_VIDEO_CINEMATIC: LtxStyleDef = {
  id: "music_video_cinematic",
  label: "Music Video Cinematic",
  worldDescription:
    "a rhythmic, high-production music-video world: anamorphic lens flare streaking across high-contrast stylized " +
    "grades, glossy commercial-grade lighting, and camera choreography that reads as beat-synced — every push, " +
    "pull, and whip lands like it is cut to a track even without one.",
  promptGuidance: {
    appearance:
      "high-production music-video cinematography — anamorphic lens flare and horizontal streak artifacts off " +
      "practical light sources, glossy commercial-grade surface sheen (skin, metal, wet street), crisp high-detail " +
      "rendering that reads as a premium production, not a documentary capture.",
    lightingColor:
      "high-contrast stylized color grade: deep crushed blacks against saturated punchy highlights, bold single-hue " +
      "color washes (magenta/cyan/amber gel lighting), glossy commercial lighting with hard rim light separating " +
      "subject from background — dramatic and deliberately unnatural in the best way.",
    cameraDoctrine:
      "beat-synced camera choreography: rhythmic push/pull that lands like it's hitting a downbeat, sharp whip-pans " +
      "that snap to the next beat, orbiting or crash-zoom moves timed to feel musical even in a single continuous " +
      "take — every move is confident, fast, and deliberately performative.",
    soundscapeDefault:
      "glossy production-adjacent ambience: crowd murmur, fabric and jewelry movement, footsteps on a reflective " +
      "surface, kept tight and rhythmic in feel — no score, no lyrics; final music is mixed separately.",
  },
  candidateAdapterIds: ["ltx-creative-anamorphic-flare", "ltx-creative-music-video-grade"],
  // Glossy commercial production is the opposite of gritty film grain, but
  // the high-contrast grade still wants a moderate vignette to focus the
  // frame around the subject.
  grain: 0.03,
  vignette: 0.35,
};

export const LTX_STYLES: Record<string, LtxStyleDef> = {
  cinematic_heist_noir: CINEMATIC_HEIST_NOIR,
  documentary_mannequin: DOCUMENTARY_MANNEQUIN,
  anime: ANIME,
  photorealistic: PHOTOREALISTIC,
  watercolor: WATERCOLOR,
  music_video_cinematic: MUSIC_VIDEO_CINEMATIC,
};

export const DEFAULT_LTX_STYLE_ID = "cinematic_heist_noir";

export function getLtxStyle(id?: string): LtxStyleDef {
  return LTX_STYLES[id ?? DEFAULT_LTX_STYLE_ID] ?? LTX_STYLES[DEFAULT_LTX_STYLE_ID]!;
}

export interface LtxChannelStyleSelectionInput {
  /** Persisted selection from an earlier stage/retry. Unknown values never become a style. */
  explicitStyleId?: unknown;
  /** Family-owned safe fallback — normally cinematic_heist_noir for the current LTX lane. */
  familyDefaultStyleId?: string;
  styleDNA?: {
    colorGrade?: string;
    composition?: string;
    motifs?: readonly string[];
    motionDiscipline?: string;
    visualAvoid?: readonly string[];
  } | null;
  visualBrief?: {
    promptStyle?: string;
    look?: string;
    setting?: string;
    world?: string;
  } | null;
}

export interface LtxChannelStyleSelection {
  styleId: string;
  /** Where the selection came from; retained with the render for audit/retry truthfulness. */
  source: "persisted" | "channel_identity" | "family_default";
  /** The bounded signals that made an identity-derived treatment unambiguous. */
  matchedSignals: readonly string[];
}

const STYLE_SIGNAL_RULES: Readonly<Record<string, readonly RegExp[]>> = {
  anime: [/\banime\b/i, /\bmanga\b/i, /\bcel[ -]?shad/i, /\bspeed lines?\b/i],
  watercolor: [/\bwatercolou?r\b/i, /\bpencil(?:[ -]?(?:sketch|linework))?\b/i, /\bpaint(?:ed|erly)?\b/i, /\bink wash\b/i],
  music_video_cinematic: [/\bmusic[ -]?video\b/i, /\bperformance\b/i, /\bbeat[ -]?sync/i, /\banamorphic flare\b/i],
  documentary_mannequin: [/\bdocumentary\b/i, /\bevidentiar/i, /\bforensic\b/i, /\bcase[ -]?file\b/i, /\barchive\b/i, /\bmannequin\b/i],
  photorealistic: [/\bphoto(?:graphic|realistic)?\b/i, /\bnaturalistic\b/i, /\blive[ -]?action\b/i, /\breal[ -]?world\b/i],
};

function knownLtxStyleId(value: unknown): string | undefined {
  return typeof value === "string" && Object.hasOwn(LTX_STYLES, value) ? value : undefined;
}

/**
 * Choose a channel's LTX visual treatment only when its sealed identity gives
 * one clear answer. Ambiguous or ungrounded DNA deliberately keeps the family
 * default instead of guessing a new aesthetic into a production render.
 */
export function selectLtxStyleForChannel(input: LtxChannelStyleSelectionInput): LtxChannelStyleSelection {
  const persisted = knownLtxStyleId(input.explicitStyleId);
  if (persisted) return { styleId: persisted, source: "persisted", matchedSignals: [] };

  const signals = [
    input.styleDNA?.colorGrade,
    input.styleDNA?.composition,
    input.styleDNA?.motionDiscipline,
    ...(input.styleDNA?.motifs ?? []),
    ...(input.styleDNA?.visualAvoid ?? []),
    input.visualBrief?.promptStyle,
    input.visualBrief?.look,
    input.visualBrief?.setting,
    input.visualBrief?.world,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 24);

  const matches = Object.entries(STYLE_SIGNAL_RULES).map(([styleId, rules]) => ({
    styleId,
    matchedSignals: signals.filter((signal) => rules.some((rule) => rule.test(signal))).slice(0, 4),
  })).filter((candidate) => candidate.matchedSignals.length > 0);
  const highest = Math.max(0, ...matches.map((candidate) => candidate.matchedSignals.length));
  const winners = matches.filter((candidate) => candidate.matchedSignals.length === highest);
  if (highest > 0 && winners.length === 1) {
    return {
      styleId: winners[0]!.styleId,
      source: "channel_identity",
      matchedSignals: winners[0]!.matchedSignals,
    };
  }

  return {
    styleId: knownLtxStyleId(input.familyDefaultStyleId) ?? DEFAULT_LTX_STYLE_ID,
    source: "family_default",
    matchedSignals: [],
  };
}
