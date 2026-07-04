/**
 * Style-DNA distiller — Inception's grounding step.
 *
 * Turns AUTO-DISCOVERED research (top competitors + the Gemini thumbnail-vision
 * style guide + the SEO databank) into a single FROZEN, machine-readable
 * `StyleDNA`: the channel's recurring subject, setting, palette, motion/audio/
 * narrative vocabulary, and SEO formulas. Every downstream block generates
 * against it and the critic scores conformance TO it.
 *
 * NO GENERIC FALLBACK. When grounding is thin the distiller does not fabricate a
 * confident-looking spec — it lowers `confidence` and records exactly what is
 * missing in `groundingGaps`, so the Pipeline Doctor heals those gaps before the
 * channel is treated as "established". The companion `buildQualityBar` derives
 * the per-channel bar every critic judges against.
 */
import { z } from "zod";
import { agentJson } from "@/agents/mastra";
import { hasGeminiKey } from "@/lib/gemini";
import { hasAnthropicKey } from "@/lib/anthropic";
import { produceAndCritique } from "@/engine/critiqueLoop";
import type { FamilyKey } from "@/engine/families";
import type { QualityBar, QualityDimension, StyleDNA } from "./types";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

/** Visual signals mined by `refreshNicheResearchCore` (nicheIntelligence). */
export interface ThumbnailStyleGuide {
  dominantColors?: string[];
  hasTextOverlayPct?: number;
  notes?: string;
}

/** SEO databank slice (the parts that inform visual/narrative DNA). */
export interface DatabankSignals {
  thumbnailRules?: string[];
  hookPatterns?: string[];
  competitorGaps?: string[];
  titleTemplates?: string[];
}

export interface StyleDNAInput {
  family: FamilyKey;
  name: string;
  niche?: string;
  persona?: string;
  styleGrammar?: string;
  /** Identity palette seed (used only as a hint, never as a generic default). */
  palette?: string[];
  /** Top competitor titles (highest-viewed first). */
  competitorTitles?: string[];
  /** Power words mined from the niche. */
  powerWords?: string[];
  /** Gemini-vision analysis of the niche's top thumbnails. */
  thumbnailStyleGuide?: ThumbnailStyleGuide;
  /** SEO databank signals. */
  databank?: DatabankSignals;
  /** Gemini analysis of the operator's example clip ("make it like this"). */
  exampleClipNotes?: string;
  now: number;
  log?: Logger;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const clampHexes = (xs: unknown, max: number): string[] =>
  Array.isArray(xs) ? xs.filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, max) : [];
const clampStrs = (xs: unknown, max: number): string[] =>
  Array.isArray(xs) ? xs.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim()).slice(0, max) : [];

/** What the showrunner agent fills in (DNA minus computed provenance fields). */
const dnaSchema = z.object({
  palette: z.array(z.string()),
  recurringSubject: z.string(),
  setting: z.string(),
  composition: z.string(),
  colorGrade: z.string(),
  motifs: z.array(z.string()),
  variationAxes: z.array(z.string()),
  motionVocabulary: z.array(z.string()),
  motionDiscipline: z.string(),
  visualAvoid: z.array(z.string()),
  thumbnail: z.object({
    composition: z.string(),
    textRule: z.string(),
    palette: z.array(z.string()),
    subject: z.string(),
  }),
  audio: z.object({
    genre: z.string(),
    bpmMin: z.number(),
    bpmMax: z.number(),
    instrumentation: z.array(z.string()),
    textures: z.array(z.string()),
    moodArc: z.string(),
    loudnessLufs: z.number(),
    loopable: z.boolean(),
  }),
  narrative: z
    .object({
      scriptStyle: z.string(),
      hookStyle: z.string(),
      pacing: z.string(),
      voiceProfile: z.string(),
      delivery: z.string(),
    })
    .optional(),
  seo: z.object({
    titleFormula: z.string(),
    descriptionStructure: z.string(),
    playlistStrategy: z.string(),
  }),
});
type RawDNA = z.infer<typeof dnaSchema>;

/** The different-model critic's verdict on a DNA draft (specificity + fidelity). */
const critiqueSchema = z.object({
  score: z.number(),
  issues: z.array(z.string()),
});

/** Phrases that mean the DNA is generic boilerplate, not custom to this channel. */
const GENERIC_TELLS = [
  "recurring central subject",
  "a single bold",
  "calm, consistent",
  "on-brand",
  "clean cohesive",
  "clean, cohesive",
  "visually appealing",
  "high quality",
  "high-quality",
  "engaging content",
  "various elements",
  "a focused channel",
];

/**
 * Trustworthy facts the model must not be allowed to fudge — folded into the
 * critique so a draft with no locked identity or generic filler can never pass.
 */
function deterministicIssues(raw: RawDNA, narrated: boolean): string[] {
  const issues: string[] = [];
  if (!raw.recurringSubject?.trim()) issues.push("recurringSubject is empty — the channel has no locked identity");
  if (!raw.setting?.trim()) issues.push("setting is empty — no recurring world to anchor every video");
  if (clampHexes(raw.palette, 6).length < 2) issues.push("palette has fewer than 2 valid hex colors");
  if (clampStrs(raw.motifs, 8).length < 2) issues.push("fewer than 2 motifs — visual identity under-specified");
  if (!raw.audio?.genre?.trim()) issues.push("audio.genre is empty");
  if (narrated && !raw.narrative) issues.push("narrated family but no narrative block (voiceProfile/scriptStyle missing)");
  const blob = JSON.stringify(raw).toLowerCase();
  for (const tell of GENERIC_TELLS) {
    if (blob.includes(tell)) issues.push(`generic phrasing "${tell}" — replace with something specific to THIS channel`);
  }
  return issues;
}

/** Families that narrate (so a missing narrative block is a real grounding gap). */
const NARRATED: ReadonlySet<FamilyKey> = new Set<FamilyKey>([
  "narrated_stock",
  "cinematic",
  "sleep",
  "shorts",
  "whiteboard",
] as FamilyKey[]);

/**
 * Honest, ungrounded skeleton — used ONLY when there is no LLM at all. It is
 * flagged `source:"ungrounded"`, `confidence:0` so it can NEVER pass as
 * established; the Doctor must heal it before any video ships. We do not invent
 * a fake subject/setting — those stay empty and become explicit gaps.
 */
function ungroundedDNA(input: StyleDNAInput): StyleDNA {
  return {
    source: "ungrounded",
    confidence: 0,
    groundingGaps: [
      "no LLM key at inception — Style DNA was not distilled",
      "recurringSubject + setting undefined (the channel has no locked identity yet)",
    ],
    palette: clampHexes(input.palette, 6),
    recurringSubject: "",
    setting: "",
    composition: "",
    colorGrade: "",
    motifs: [],
    variationAxes: [],
    motionVocabulary: [],
    motionDiscipline: "",
    visualAvoid: [],
    thumbnail: { composition: "", textRule: "", palette: clampHexes(input.palette, 6), subject: "" },
    audio: { genre: "", bpmRange: [70, 90], instrumentation: [], textures: [], moodArc: "", loudnessLufs: -14, loopable: input.family === "music_loop" },
    seo: { titleFormula: "", descriptionStructure: "", playlistStrategy: "" },
    refreshedAt: input.now,
  };
}

/** Grounding context block fed to the showrunner — only REAL signals, no filler. */
function groundingContext(input: StyleDNAInput): { text: string; gaps: string[]; hasVision: boolean; hasTitles: boolean; hasDatabank: boolean } {
  const gaps: string[] = [];
  const parts: string[] = [];

  const titles = clampStrs(input.competitorTitles, 15);
  const hasTitles = titles.length > 0;
  if (hasTitles) parts.push(`TOP COMPETITOR TITLES (highest-viewed):\n${titles.join("\n")}`);
  else gaps.push("no competitor titles (niche research returned nothing) — SEO + positioning under-grounded");

  const power = clampStrs(input.powerWords, 14);
  if (power.length) parts.push(`POWER WORDS: ${power.join(", ")}`);

  const tg = input.thumbnailStyleGuide;
  // The research layer writes a PLACEHOLDER guide ("minimal guide …") when the
  // vision call could not run/failed. That is NOT grounding — crediting it would
  // be the exact silent-fallback we're eliminating, so detect + reject it.
  const noteLc = (tg?.notes ?? "").toLowerCase();
  const minimalNote = noteLc.startsWith("minimal guide");
  // The vision call is asked to flag OFF-NICHE thumbnails (search pollution). If
  // it says the discovered references don't match the niche, they are wrong refs
  // — grounding the DNA on them would be confidently wrong, so reject + gap it.
  const offNiche = /not consistent|off[- ]niche|do not match|don't match|not match|not related|unrelated|inconsistent with/.test(noteLc);
  const hasVision = !minimalNote && !offNiche && !!(tg && ((tg.dominantColors && tg.dominantColors.length > 0) || tg.notes));
  if (hasVision) {
    parts.push(
      [
        "THUMBNAIL VISION ANALYSIS (Gemini over the niche's top thumbnails):",
        tg?.dominantColors?.length ? `- dominant colors: ${tg.dominantColors.join(", ")}` : "",
        typeof tg?.hasTextOverlayPct === "number" ? `- % with bold text overlay: ${tg.hasTextOverlayPct}` : "",
        tg?.notes ? `- notes: ${tg.notes}` : "",
      ].filter(Boolean).join("\n"),
    );
  } else if (offNiche) {
    gaps.push("thumbnail vision ran but the discovered references are OFF-NICHE (search pollution) — visual DNA NOT grounded on real niche thumbnails; Doctor must refine discovery queries");
  } else if (minimalNote) {
    gaps.push("thumbnail vision FAILED upstream (placeholder guide) — visual DNA grounded only in titles/text, NOT the niche's real thumbnails; Doctor must repair the vision pass");
  } else {
    gaps.push("no thumbnail vision analysis — visual DNA (palette/composition/subject) under-grounded");
  }

  const db = input.databank;
  const hasDatabank = !!(db && (db.thumbnailRules?.length || db.hookPatterns?.length || db.competitorGaps?.length));
  if (hasDatabank) {
    parts.push(
      [
        db?.thumbnailRules?.length ? `THUMBNAIL RULES (proven): ${db.thumbnailRules.slice(0, 8).join("; ")}` : "",
        db?.hookPatterns?.length ? `HOOK PATTERNS: ${db.hookPatterns.slice(0, 8).join("; ")}` : "",
        db?.competitorGaps?.length ? `UNDERSERVED ANGLES (gaps competitors miss): ${db.competitorGaps.slice(0, 8).join("; ")}` : "",
      ].filter(Boolean).join("\n"),
    );
  } else {
    gaps.push("no SEO databank — hook/thumbnail/gap doctrine under-grounded");
  }

  return { text: parts.join("\n\n"), gaps, hasVision, hasTitles, hasDatabank };
}

/**
 * Distil the channel's Style DNA from auto-discovered research. Confidence is
 * earned from REAL grounding signals (vision + titles + databank + the LLM
 * actually running); whatever is missing is recorded as a gap for the Doctor.
 */
export async function synthStyleDNA(input: StyleDNAInput): Promise<StyleDNA> {
  const log = input.log ?? (() => {});
  if (!hasAnthropicKey() && !hasGeminiKey()) {
    log("styleDNA: no LLM key — ungrounded skeleton (Doctor must heal before established)");
    return ungroundedDNA(input);
  }

  const g = groundingContext(input);
  const narrated = NARRATED.has(input.family);
  const prompt = [
    `Distil the STYLE DNA for a faceless YouTube channel — the single, frozen,`,
    `machine-readable definition of "good" that EVERY video must conform to.`,
    `Name: ${input.name}`,
    `Format (family): ${input.family}`,
    input.niche ? `Niche: ${input.niche}` : "",
    input.persona
      ? `OPERATOR PERSONA — CANON, not a suggestion: "${input.persona}". The recurringSubject, setting and motifs MUST embody THIS persona's world exactly (a persona set in a neon penthouse must never distill into a café). Competitor/databank signals inform PACKAGING (titles, thumbnails, hooks) only — they never relocate the world.`
      : "",
    ENGINE_MOTION_LIMITS[input.family] ?? "",
    input.styleGrammar ? `Visual style seed: ${input.styleGrammar}` : "",
    input.palette?.length ? `Palette seed (hint only): ${clampHexes(input.palette, 6).join(", ")}` : "",
    input.exampleClipNotes
      ? `OPERATOR'S EXAMPLE CLIP (analyzed — the operator pointed at this and said "like this"; weight it heavily): ${input.exampleClipNotes}`
      : "",
    "",
    g.text ? `GROUND YOUR ANSWER IN THIS RESEARCH (reverse-engineer WHY the top channels win — do not invent):\n${g.text}` : "No external research signals were available — reason from genre best-practice and BE EXPLICIT where you are guessing.",
    "",
    `Decide a SINGLE recurring subject + setting that becomes this channel's recognizable identity`,
    `(like Lofi Girl's studying character + rainy window) and lock the ONLY axes allowed to vary`,
    `(e.g. time-of-day, season). Be concrete and opinionated — generic answers are failures.`,
    "",
    `Return STRICT JSON:`,
    `- palette: 3-5 hex colors (dominant→accent), grounded in the vision analysis if present`,
    `- recurringSubject: the ONE concrete subject/character that IS the brand`,
    `- setting: the recurring world/place shared by every video`,
    `- composition: focal placement / rule-of-thirds / depth conventions`,
    `- colorGrade: the look's grade + mood`,
    `- motifs: 3-6 recurring signature elements`,
    `- variationAxes: the ONLY things allowed to change between videos`,
    `- motionVocabulary: what may move (subtle ambient elements)`,
    `- motionDiscipline: camera/motion rules (e.g. locked tripod, no pans/zooms)`,
    `- visualAvoid: anti-patterns to NEVER render (include the niche's "cheap" tells)`,
    `- thumbnail: {composition (subject-on-third, high-contrast, mobile-legible), textRule (<=3 words/mood-phrase/none), palette (3-4 hex, contrast pushed past the video grade), subject}`,
    `- audio: {genre, bpmMin, bpmMax, instrumentation, textures (1-2 only), moodArc, loudnessLufs (YouTube ref -14), loopable}`,
    narrated
      ? `- narrative: {scriptStyle, hookStyle, pacing, voiceProfile (timbre/age/pace/warmth), delivery (emotional direction)}`
      : `- narrative: omit (this family has no narration)`,
    `- seo: {titleFormula (with [BRACKET] variables), descriptionStructure, playlistStrategy}`,
  ]
    .filter(Boolean)
    .join("\n");

  // ITERATIVE distillation (Reflexion): the Showrunner (Claude) drafts the DNA;
  // a DIFFERENT-model critic (Gemini) scores it for genuine specificity +
  // fidelity to the research, with deterministic anti-generic guards folded in;
  // the draft is regenerated carrying the critique forward. No fallback — if the
  // generator throws outright we return an ungrounded skeleton for the Doctor.
  let loop;
  try {
    loop = await produceAndCritique<RawDNA>({
      label: "styleDNA",
      threshold: 0.8,
      maxIters: 2,
      log: (m) => log(m),
      produce: (priorIssues) => {
        const fix = priorIssues.length
          ? `\n\nYOUR PREVIOUS DRAFT FAILED REVIEW — FIX EVERY ONE OF THESE, do not repeat them:\n- ${priorIssues.join("\n- ")}`
          : "";
        return agentJson({
          role: "showrunner", schema: dnaSchema, log: (m) => log(m),
          maxTokens: 2600, temperature: 0.7, prompt: prompt + fix,
        });
      },
      critique: async (raw) => {
        const det = deterministicIssues(raw, narrated);
        let llmScore = det.length ? 0.5 : 0.8;
        let llmIssues: string[] = [];
        try {
          const v = await agentJson({
            role: "critic", schema: critiqueSchema, log: (m) => log(m),
            maxTokens: 900, temperature: 0.3,
            prompt: [
              `Audit this channel's STYLE DNA for GENUINE specificity and fidelity to the research.`,
              `It MUST be custom to THIS channel — generic boilerplate that could describe any channel is a FAILURE.`,
              g.text ? `RESEARCH THE DNA SHOULD REFLECT (reverse-engineered from real top performers):\n${g.text}` : `No external research was available — judge whether the DNA is at least vividly genre-specific.`,
              `DNA DRAFT:\n${JSON.stringify(raw)}`,
              `Score 0..1 — 1.0 = a concrete locked recurring subject + setting, palette/motifs/motion that clearly derive from the research and the niche's real conventions; 0.0 = vague filler.`,
              `Return JSON {"score": number, "issues": [concrete, specific fixes]}. Penalize vague adjectives, any field copy-pasteable to another channel, and anything not grounded in the research.`,
            ].join("\n\n"),
          });
          llmScore = Math.max(0, Math.min(1, Number(v.score) || 0));
          llmIssues = clampStrs(v.issues, 6);
        } catch (e) {
          log(`styleDNA: critic failed (${e instanceof Error ? e.message : e}) — deterministic-only this iter`);
        }
        // Deterministic failures cap the score and block acceptance outright.
        const score = det.length ? Math.min(llmScore, 0.6) : llmScore;
        const pass = det.length === 0 && llmScore >= 0.8;
        return { score, pass, issues: [...det, ...llmIssues] };
      },
    });
  } catch (e) {
    log(`styleDNA: distil failed (${e instanceof Error ? e.message : e}) — ungrounded, Doctor to retry`);
    const u = ungroundedDNA(input);
    u.groundingGaps = [`distil call failed: ${e instanceof Error ? e.message : String(e)}`, ...u.groundingGaps];
    return u;
  }
  const raw = loop.value;

  // Earn confidence from real grounding AND from clearing the specificity bar.
  let confidence = 0.45; // the LLM ran and produced a structured spec
  if (g.hasVision) confidence += 0.3;
  if (g.hasTitles) confidence += 0.15;
  if (g.hasDatabank) confidence += 0.1;
  if (!loop.accepted) confidence *= 0.7; // critic never cleared the bar → flag for Doctor
  confidence = Math.min(1, Number(confidence.toFixed(2)));
  const gaps = [...g.gaps];
  if (!loop.accepted) {
    gaps.push(
      `Style DNA did not clear the specificity bar after ${loop.iterations} iter(s): ${loop.critique.issues.slice(0, 3).join("; ")}`,
    );
  }
  if (narrated && !raw.narrative) gaps.push("narrative DNA missing for a narrated family — voice/script under-grounded");

  const palette = clampHexes(raw.palette, 6);
  const bpmMin = Math.max(40, Math.min(raw.audio.bpmMin, raw.audio.bpmMax));
  const bpmMax = Math.max(raw.audio.bpmMin, raw.audio.bpmMax);

  const dna: StyleDNA = {
    source: g.hasVision ? "research+vision" : "research",
    confidence,
    groundingGaps: gaps,
    palette: palette.length >= 2 ? palette : clampHexes(input.palette, 6),
    recurringSubject: raw.recurringSubject.trim(),
    setting: raw.setting.trim(),
    composition: raw.composition.trim(),
    colorGrade: raw.colorGrade.trim(),
    motifs: clampStrs(raw.motifs, 8),
    variationAxes: clampStrs(raw.variationAxes, 6),
    motionVocabulary: clampStrs(raw.motionVocabulary, 8),
    motionDiscipline: raw.motionDiscipline.trim(),
    visualAvoid: clampStrs(raw.visualAvoid, 10),
    thumbnail: {
      composition: raw.thumbnail.composition.trim(),
      textRule: raw.thumbnail.textRule.trim(),
      palette: clampHexes(raw.thumbnail.palette, 5),
      subject: raw.thumbnail.subject.trim(),
    },
    audio: {
      genre: raw.audio.genre.trim(),
      bpmRange: [bpmMin, bpmMax],
      instrumentation: clampStrs(raw.audio.instrumentation, 8),
      textures: clampStrs(raw.audio.textures, 4),
      moodArc: raw.audio.moodArc.trim(),
      loudnessLufs: Number.isFinite(raw.audio.loudnessLufs) ? raw.audio.loudnessLufs : -14,
      loopable: raw.audio.loopable,
    },
    narrative: raw.narrative
      ? {
          scriptStyle: raw.narrative.scriptStyle.trim(),
          hookStyle: raw.narrative.hookStyle.trim(),
          pacing: raw.narrative.pacing.trim(),
          voiceProfile: raw.narrative.voiceProfile.trim(),
          delivery: raw.narrative.delivery.trim(),
        }
      : undefined,
    seo: {
      titleFormula: raw.seo.titleFormula.trim(),
      descriptionStructure: raw.seo.descriptionStructure.trim(),
      playlistStrategy: raw.seo.playlistStrategy.trim(),
    },
    refreshedAt: input.now,
  };

  // Hard grounding requirement: a confident DNA MUST have a locked identity.
  if (!dna.recurringSubject || !dna.setting) {
    dna.confidence = Math.min(dna.confidence, 0.3);
    dna.groundingGaps = ["recurringSubject/setting not locked — identity under-defined", ...dna.groundingGaps];
  }

  log("styleDNA: distilled", { subject: dna.recurringSubject.slice(0, 48), confidence: dna.confidence, gaps: dna.groundingGaps.length });
  return dna;
}

/** Confidence at/above which a channel's grounding is "established" (Doctor-free). */
/**
 * Self-contained deterministic engines can only MOVE in specific ways: the
 * distiller used to promise papercraft parallax/breathing cutouts the comic
 * renderer cannot do (confidence 1.0, zero grounding gaps), and QA then judged
 * real output against the fantasy. Constrain the motion vocabulary per family.
 */
const ENGINE_MOTION_LIMITS: Record<string, string> = {
  comic:
    "ENGINE MOTION LIMITS (hard): the renderer draws panels in with a hand, pops speech bubbles, zooms/pans a 3D camera across the page and turns pages. Do NOT promise parallax layers, particle effects, breathing/animated cutouts or any motion outside that vocabulary.",
  whiteboard:
    "ENGINE MOTION LIMITS (hard): a hand draws line-art and lettered labels onto a whiteboard, panel by panel, synced to narration. Do NOT promise camera moves, parallax, color-grade shifts or animated characters.",
};

export const ESTABLISHED_CONFIDENCE = 0.7;

/* --------------------------- Quality Bar ------------------------------ */

/** Which quality dimensions matter for each family (the critic's scorecard). */
const FAMILY_DIMENSIONS: Record<string, string[]> = {
  music_loop: ["identity", "loop_seam", "music", "thumbnail"],
  narrated_stock: ["identity", "script", "footage", "voice", "thumbnail"],
  cinematic: ["identity", "script", "footage", "voice", "thumbnail"],
  sleep: ["identity", "music", "voice", "thumbnail"],
  whiteboard: ["identity", "script", "footage", "thumbnail"],
  shorts: ["hook", "captions", "pacing", "thumbnail"],
};

/**
 * Derive the per-channel bar from its DNA. Each dimension's description is
 * grounded in the DNA so the critic judges conformance to THIS channel, and the
 * deterministic floors (loop seam SSIM, music LUFS) are the un-gameable anchors.
 * `target` mean of 1.6 / 2 ≈ the 80% bar the operator asked for.
 */
export function buildQualityBar(family: FamilyKey, dna: StyleDNA, now: number): QualityBar {
  const ids = FAMILY_DIMENSIONS[family] ?? ["identity", "thumbnail"];
  const desc: Record<string, string> = {
    identity: `Reads unmistakably as "${dna.recurringSubject || "this channel"}" in "${dna.setting || "its setting"}" — palette ${dna.palette.join("/") || "on-brand"}, motifs (${dna.motifs.join(", ") || "—"}); only ${dna.variationAxes.join("/") || "approved axes"} may vary.`,
    loop_seam: `Seamless loop — no visible pop/velocity-flip at the boundary; only ${dna.motionVocabulary.join(", ") || "subtle ambient motion"}; ${dna.motionDiscipline || "camera locked"}.`,
    music: `${dna.audio.genre || "on-genre"} at ${dna.audio.bpmRange[0]}-${dna.audio.bpmRange[1]} BPM, ${dna.audio.instrumentation.join("/") || "right instrumentation"}, ${dna.audio.textures.join("/") || "restrained texture"}; mastered to ${dna.audio.loudnessLufs} LUFS; ${dna.audio.loopable ? "loop-safe" : "natural ending"}.`,
    thumbnail: `${dna.thumbnail.subject || dna.recurringSubject || "clear subject"}; ${dna.thumbnail.composition || "subject-on-third, high-contrast, mobile-legible"}; text: ${dna.thumbnail.textRule || "≤3 words"}.`,
    script: dna.narrative ? `${dna.narrative.scriptStyle}; hook: ${dna.narrative.hookStyle}; pacing: ${dna.narrative.pacing}.` : "On-brand script with a strong hook and tight pacing.",
    voice: dna.narrative ? `${dna.narrative.voiceProfile}; delivery: ${dna.narrative.delivery}; sits cleanly over the bed.` : "Human, on-tone narration mixed over the bed.",
    footage: `On-theme visuals that match the narration; ${dna.composition || "strong composition"}; grade: ${dna.colorGrade || "on-brand"}; avoid: ${dna.visualAvoid.join(", ") || "off-brand shots"}.`,
    hook: "Scroll-stopping in the first 1-2s; clear payoff promise.",
    captions: "Readable karaoke captions with keyword emphasis, correctly timed.",
    pacing: "Tight, pattern-interrupted pacing with no dead air.",
  };
  // Deterministic floors the iteration loop cannot game.
  const floors: Record<string, Pick<QualityDimension, "metric" | "op" | "threshold">> = {
    loop_seam: { metric: "seam_ssim", op: ">=", threshold: 0.9 },
    music: { metric: "lufs_abs_err", op: "<=", threshold: 1.5 },
  };

  const dimensions: QualityDimension[] = ids.map((id) => ({
    id,
    description: desc[id] ?? `Meets the channel's standard for ${id}.`,
    minScore: 1, // must be at least "acceptable" (0-1-2 scale)
    ...(floors[id] ?? {}),
  }));

  return { target: 1.6, dimensions, refreshedAt: now };
}
