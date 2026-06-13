/**
 * DOCUMOTION STYLE REGISTRY — the channel "worlds" the motion engine can
 * speak, plus the image-prompting intelligence for each.
 *
 * One pure-data module shared by BOTH the planner (src/lib/documotion.ts —
 * picks shot kinds, writes asset prompts) and the renderer
 * (src/remotion/DocuMotion.tsx — reads the visual theme via context). No node
 * deps, so it bundles into the Remotion serve URL cleanly.
 *
 * Adding a channel look = adding one DocuStyleDef. A channel's pipeline picks a
 * style by id; the engine then knows which graphics are possible, how to prompt
 * every still, and how to theme the render.
 */

export type DocuShotKind =
  | "parallax_portrait"
  | "map_zoom"
  | "photo_slide"
  | "matte_sequence"
  | "collage_pan"
  | "evidence_board"
  | "object_drop"
  | "quote_card";

export type DocuAssetRole = "bg" | "fg" | "image" | "cutout";

/** Visual theme consumed by the renderer (colors / fonts / grade strength). */
export interface DocuTheme {
  /** Page base behind everything. */
  base: string;
  /** Light "material" color — headline + paper. */
  paper: string;
  /** Dark ink — text on light chips. */
  ink: string;
  /** Highlight / accent (boxes, threads, payoff words). */
  accent: string;
  /** Secondary accent (rings, dividers). */
  accent2: string;
  /** Big headline font-family stack. */
  fontDisplay: string;
  /** Avg glyph width as a fraction of font-size for fontDisplay (autofit). */
  displayCharW: number;
  /** Label / tag font-family stack. */
  fontLabel: string;
  /** Handwritten note font-family stack. */
  fontHand: string;
  /** Plate color grade (CSS filter applied to every photographic plate). */
  plateFilter: string;
  /** Grain opacity 0-1 and vignette strength 0-1. */
  grain: number;
  vignette: number;
  /** Warm vs cool flicker tint. */
  flickerTint: string;
}

/** How to frame a still for a given asset role (the prompting intelligence). */
export interface RoleFraming {
  prefix: string;
  ar: string;
}

export interface DocuStyleDef {
  id: string;
  label: string;
  /** Shown to the planner: the channel world to design within. */
  worldDescription: string;
  /** Appended to EVERY image prompt — the look contract. */
  stillStyle: string;
  /** Per-role framing prefixes + aspect ratios. */
  roleFraming: Record<DocuAssetRole, RoleFraming>;
  /** Camera + pacing doctrine specific to this world. */
  cinematography: string;
  /** Shot kinds the planner may use, in rough priority. */
  shotKinds: DocuShotKind[];
  /** Opening + closing shot kinds. */
  hookKind: DocuShotKind;
  closerKind: DocuShotKind;
  /** Google Fonts stylesheet URL (loaded + awaited before render). */
  fontCss: string;
  /** Font families to verify are loaded (display, label, hand). */
  fontProbe: [string, string, string];
  theme: DocuTheme;
}

/* ------------------------------------------------------ shared framing -- */

const COLLAGE_FRAMING: Record<DocuAssetRole, RoleFraming> = {
  bg: { prefix: "Wide establishing plate, full-bleed, environment focus, calm tonal room in the centre: ", ar: "16:9" },
  fg: {
    prefix:
      "Portrait for a die-cut collage cutout: ONE subject alone, head, shoulders and both arms COMPLETELY inside " +
      "the frame (only the bottom edge may crop the body), centered, sharp edges, evenly lit seamless PLAIN LIGHT " +
      "GREY studio backdrop, nothing else in frame: ",
    ar: "3:4",
  },
  image: { prefix: "Single photograph, full-bleed, no border: ", ar: "3:4" },
  cutout: {
    prefix: "Single object centered and COMPLETELY inside the frame on a PLAIN WHITE background, no shadow, nothing else: ",
    ar: "1:1",
  },
};

/* --------------------------------------------------------- ARCHIVAL ----- */

const ARCHIVAL: DocuStyleDef = {
  id: "archival_collage",
  label: "Archival Documentary Collage",
  worldDescription:
    "a premium archival-history documentary channel: sepia cutout portraits over illustrated factory/era plates, " +
    "huge distressed type, yellow highlight boxes, taped vintage photographs, torn-paper matte cuts, rostrum " +
    "collage pans, heavy film grain — the look of a polished history explainer.",
  stillStyle:
    " STYLE (obey strictly): authentic 1920s-1940s archival documentary image — sepia and desaturated earth tones, " +
    "real photographic film grain, slight halftone print texture, period-correct clothing/machinery/architecture, " +
    "dramatic natural light with STRONG tonal separation between subject and surroundings, believable historical " +
    "photograph or vintage illustrated plate. ABSOLUTELY NO text, NO letters, NO numbers, NO captions, NO " +
    "watermarks, NO borders, NO photo frames, NO modern objects.",
  roleFraming: COLLAGE_FRAMING,
  cinematography:
    "every shot has ONE motivated rostrum-camera move — push_in for a reveal, pull_back for aftermath/scale, " +
    "pan_left/pan_right for geography and collage boards, drift for somber holds. Never repeat move+intensity on " +
    "consecutive shots. PACING: hook 7-9s, middle shots 5-8s (no two consecutive equal), climax 4-6s, closing quote 5-7s.",
  shotKinds: ["parallax_portrait", "map_zoom", "photo_slide", "matte_sequence", "collage_pan", "object_drop", "quote_card"],
  hookKind: "parallax_portrait",
  closerKind: "quote_card",
  fontCss: "https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@500;600;700&family=Caveat:wght@600;700&display=block",
  fontProbe: ["Anton", "Oswald", "Caveat"],
  theme: {
    base: "#0d0c0a",
    paper: "#f7f1e2",
    ink: "#15130f",
    accent: "#f2c230",
    accent2: "#5ad27e",
    fontDisplay: "Anton, sans-serif",
    displayCharW: 0.52,
    fontLabel: "Oswald, sans-serif",
    fontHand: "Caveat, cursive",
    plateFilter: "sepia(0.3) contrast(1.04) saturate(0.82)",
    grain: 0.09,
    vignette: 0.58,
    flickerTint: "#1a1408",
  },
};

/* --------------------------------------------------------- DETECTIVE ---- */

const DETECTIVE: DocuStyleDef = {
  id: "detective_board",
  label: "True-Crime Evidence Board",
  worldDescription:
    "a gripping true-crime investigation channel: a cork EVIDENCE BOARD of pinned photographs connected by taut " +
    "RED STRING, surveillance stills, case-file documents, suspect mugshots under harsh interrogation light, maps " +
    "with circled locations — the camera prowls between pinned clues like a detective building the case.",
  stillStyle:
    " STYLE (obey strictly): gritty modern true-crime image — desaturated cold teal-and-amber grade, deep shadows " +
    "and harsh directional light, fine 35mm grain, slight surveillance/flash-photography realism, evidentiary and " +
    "unglamorous. Looks like a real case-file photo or CCTV still. ABSOLUTELY NO text, NO letters, NO numbers, NO " +
    "captions, NO watermarks, NO borders, NO timestamps, NO UI overlays.",
  roleFraming: {
    bg: { prefix: "Wide establishing plate, full-bleed, moody crime-scene environment, low key: ", ar: "16:9" },
    fg: {
      prefix:
        "Suspect/witness portrait for a die-cut cutout: ONE person alone, head and shoulders fully inside frame, " +
        "harsh frontal light, neutral expression, plain dark backdrop for clean cutting, nothing else in frame: ",
      ar: "3:4",
    },
    image: { prefix: "Single evidence photograph, full-bleed, no border, raw and unstyled: ", ar: "3:4" },
    cutout: { prefix: "Single object of evidence centered and fully inside frame on PLAIN WHITE, no shadow: ", ar: "1:1" },
  },
  cinematography:
    "the camera is a DETECTIVE'S EYE. Use evidence_board as the spine: the camera prowls (pan_left/pan_right/drift) " +
    "between pinned clues and pushes IN on the key photograph. Use push_in for suspect reveals, pull_back to show " +
    "the whole web of connections, drift for tense holds. Never repeat move+intensity consecutively. PACING: cold-open " +
    "reveal 6-8s, evidence beats 5-8s, the accusation punchy 4-6s, closing verdict card 5-7s.",
  shotKinds: ["evidence_board", "parallax_portrait", "photo_slide", "map_zoom", "matte_sequence", "object_drop", "quote_card"],
  hookKind: "evidence_board",
  closerKind: "quote_card",
  fontCss:
    "https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Special+Elite&family=Caveat:wght@600;700&display=block",
  fontProbe: ["Oswald", "Special Elite", "Caveat"],
  theme: {
    base: "#0a0b0d",
    paper: "#ece6d6",
    ink: "#171410",
    accent: "#c81e25",
    accent2: "#d9a441",
    fontDisplay: "Oswald, sans-serif",
    displayCharW: 0.64,
    fontLabel: "Special Elite, monospace",
    fontHand: "Caveat, cursive",
    plateFilter: "saturate(0.72) contrast(1.12) brightness(0.92)",
    grain: 0.1,
    vignette: 0.7,
    flickerTint: "#0a1014",
  },
};

export const DOCU_STYLES: Record<string, DocuStyleDef> = {
  archival_collage: ARCHIVAL,
  detective_board: DETECTIVE,
};

export const DEFAULT_STYLE_ID = "archival_collage";

export function getStyle(id?: string): DocuStyleDef {
  return DOCU_STYLES[id ?? DEFAULT_STYLE_ID] ?? ARCHIVAL;
}
