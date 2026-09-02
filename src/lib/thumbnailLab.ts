/**
 * THUMBNAIL LAB — evidence → rules → tournament → comparative validation.
 *
 * The one-shot "generate and pass/fail" approach produced competent-but-stale
 * thumbnails. The lab works the way winning channels work:
 *
 *  1. VERIFY EVIDENCE — pull the highest-VIEW competitor thumbnails the
 *     research already scraped, then vision-screen them: only genuinely
 *     on-positioning, high-craft references survive (the architect flagged
 *     reference pollution as a BLOCKING gap — this is its repair).
 *  2. DISTILL RULES — vision-deconstruct WHY each verified winner clicks
 *     (composition, focal device, text treatment, color story), then have the
 *     showrunner synthesize a persistent per-channel PLAYBOOK: hard rules +
 *     three named, executable patterns. Stored on the channel — the "devises
 *     rules out of that" loop, made durable.
 *  3. TOURNAMENT — per video, instantiate an executable pattern into a real
 *     candidate (native Nano Banana Pro scene + physical typography)
 *     and judge it
 *     COMPARATIVELY against the verified references in a simulated feed.
 *     The winner ships; scores + reasons persist.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseJsonLoose } from "@/lib/gemini";
import {
  hasVisionKey,
  visionLocal,
  VISION_GATE_MAX_TOKENS,
  type VisionTier,
} from "@/lib/vision";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { imageToJpeg } from "@/lib/ffmpeg";
import { buildThumbBrief, type ThumbBriefArgs } from "@/lib/banana";
import { readThumbnailOcr, thumbnailOcrMatchesExpected } from "@/lib/thumbnailOcr";
import {
  renderThumbnail,
  type GenerateScene,
  type ThumbnailRenderSpec,
  type ThumbnailRenderResult,
} from "@/lib/thumbnailRenderer";
import {
  GOLDEN_THUMBNAIL_CRAFT_RULES,
  OWNER_SELECTED_THUMBNAIL_PREFERENCE_RULES,
} from "@/lib/thumbnailGoldenStandard";
import {
  scoreThumbnailStoryInterest,
  STORY_INTEREST_DOCTRINE,
} from "@/lib/thumbnailStoryInterest";
import { downloadTo } from "@/lib/files";
import type { StyleDNA } from "@/engine/creative/types";
import type { FamilyKey } from "@/engine/families";
import type { ThumbnailGateVerdict } from "@/engine/qualityPolicy";
import type { ThumbnailTextZone } from "@/lib/thumbnailLayout";
import { trustedThumbnailTextZoneResolution } from "@/lib/thumbnailSafeZone";
import {
  applyThumbnailChannelIdentity,
  type ThumbnailIdentityContract,
} from "@/lib/thumbnailChannelIdentity";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

/**
 * Renderer-neutral visual treatment supplied by an admitted provenance policy.
 * It keeps policy language out of ad-hoc art-direction branches and lets the
 * same constraints reach the art director, provider prompt, local overlay,
 * and thumbnail-specific reviewer.
 */
export interface ThumbnailVisualTreatment {
  artDirectionRules?: readonly string[];
  providerPromptRequirements?: readonly string[];
  reviewCriteria?: readonly string[];
  disclosureBadge?: string;
}

/** Distilled 2026 CTR research — the judge's and synthesizer's ground truth. */
export const RESEARCH_PRINCIPLES = [
  "≤3 visual elements; the tone+topic must read in under 1 second (clutter costs ~23% CTR).",
  "2-3 bold complementary colors; the subject 30%+ brighter or darker than the background.",
  "Faceless niches win with ONE dramatic hero object against a clean ground + a ≤4-word callout.",
  "Finance: NUMBER-FORWARD — one specific number as the credibility trigger, occupying 15-20% of the canvas, upper third, white/gold on dark (data-literate audiences click specifics, not adjectives).",
  "Navy/charcoal base + gold/white accents = institutional authority palette for finance.",
  "Text: bold sans-serif ONLY, 1-3 words (5 absolute max), NEVER restating the title — it adds the curiosity the title doesn't.",
  "Documentary annotation language (Vox/Johnny Harris school): muted cinematic base + ONE editorial annotation device (accent underline, circled element, arrow) in the accent color.",
  "Consistent per-channel styling lifts subscriber CTR 15-20%: lock palette + text position family; vary the hero object and the number.",
  "Honest framing only — false-promise thumbnails decay channel-wide recommendations.",
  "THE 120px SQUINT TEST: most first views are ~120px wide on mobile — mood, subject, and text must all survive there; if it's a muddy blur, the design is wrong.",
  "SAFE ZONES: never place HEADLINE text or key story elements in the bottom-right (duration timestamp) or bottom-left (chapter markers) corners; keep critical content off extreme edges. The compact channel badge is the one deliberate exception — it is always bottom-right, sized and inset so the duration pill overlapping it costs nothing.",
  "Max 6 words on the image, and saturate beyond real life — thumbnails compete with bright UI.",
] as const;

export interface VerifiedRef {
  path: string;
  url: string;
  views: number;
  craft: number;
  why: string;
}

export interface ThumbPattern {
  name: string;
  when: string;
  /** Scene recipe for the provider base — text-free, with <PLACEHOLDERS>. */
  fluxRecipe: string;
  /** ThumbText prop template (placeholders in line texts / numberCallout). */
  textRecipe: Record<string, unknown>;
}

/** The channel's UNMISTAKABLE typographic + rendering identity. */
export interface VisualLanguage {
  font?: "impact" | "marker" | "bebas" | "serif" | "rounded";
  treatment?: "plate" | "sticker" | "stamp" | "neon" | "clean";
  baseColor?: string;
  accentColor?: string;
  /** Base-image rendering style, e.g. "vintage ink engraving on parchment". */
  imageStyle?: string;
  badgeStyle?: "center" | "pill";
  /** TYPE-AS-OBJECT treatment: deterministic local typography rendered with
   * a physical-design motif (plate / smear / stamp / sticker). It is never
   * delegated to the scene model. */
  textObject?:
    | "torn_strip" | "paint_smear" | "censor_bar" | "grunge_sticker" | "spaced_elegant" | "block_plate"
    | "neon_sign" | "spray_paint" | "stamp_ink" | "movie_poster" | "ransom_note" | "carved"
    | "scene_forged";
  /** cutout_collage = hero is a die-cut PHOTO cutout over a designed collage
   * background (the anti-AI-look device for commentary/persona channels);
   * full_scene = one continuous rendered scene. */
  composition?: "cutout_collage" | "full_scene";
  uppercase?: boolean;
  /** Historical playbook preference retained for stored-data compatibility.
   * Deployed rendering always uses the deterministic local compositor. */
  renderMode?: "recraft" | "integrated" | "layered" | "template";
  /** Locked layout subset from the template pack (docs/THUMB_TEMPLATES.md). */
  templates?: string[];
}

export interface ThumbnailPlaybook {
  /** Honest provenance: a reference-backed distillation or a deterministic
   * Style-DNA foundation used when reference acquisition is unavailable. */
  source?: "verified_references" | "style_dna_foundation";
  /** Clickbait ENERGY tier (identity-chosen): spectacle = over-the-top
   * impossible-scale drama; bold = strong grounded punch; cozy_pop = charming
   * saturated warmth. ALL are catchy — none are sleepy. */
  energy?: "spectacle" | "bold" | "cozy_pop";
  /** Channel-constant visual language (font/treatment/colors/image style). */
  visualLanguage?: VisualLanguage;
  /**
   * A profile-specific must-show/must-not-show contract. It is attached at the
   * central resolver, reaches both design routes, and converts to a strict
   * mobile reviewer verdict. Stored legacy playbooks remain compatible.
   */
  identityContract?: ThumbnailIdentityContract;
  rules: string[];
  avoid: string[];
  patterns: ThumbPattern[];
  refsUsed: { url: string; views: number; why: string }[];
  distilledAt: number;
}

const FAMILY_VISUAL_LANGUAGE: Record<FamilyKey, {
  energy: NonNullable<ThumbnailPlaybook["energy"]>;
  font: NonNullable<VisualLanguage["font"]>;
  treatment: NonNullable<VisualLanguage["treatment"]>;
  textObject: NonNullable<VisualLanguage["textObject"]>;
  imageStyle: string;
}> = {
  // Quiz thumbnails live or die on a single legible question + a big "?" beat,
  // so a bold impact plate is the right grammar — the same one narrated_stock
  // uses, deliberately, rather than inventing a fifth treatment.
  quizyear: {
    energy: "bold", font: "impact", treatment: "plate", textObject: "block_plate",
    imageStyle: "bold flat graphic quiz card, high-contrast, one clear subject, no text baked in",
  },
  narrated_stock: {
    energy: "bold", font: "impact", treatment: "plate", textObject: "block_plate",
    imageStyle: "premium cinematic editorial photograph with dramatic subject isolation",
  },
  cinematic: {
    energy: "spectacle", font: "bebas", treatment: "clean", textObject: "movie_poster",
    imageStyle: "blockbuster cinematic still with deep atmosphere and dimensional light",
  },
  music_loop: {
    energy: "cozy_pop", font: "rounded", treatment: "neon", textObject: "neon_sign",
    imageStyle: "saturated atmospheric illustration with luminous environmental storytelling",
  },
  sleep: {
    energy: "cozy_pop", font: "serif", treatment: "clean", textObject: "spaced_elegant",
    imageStyle: "ethereal cinematic nature tableau with soft luminous depth",
  },
  shorts: {
    energy: "spectacle", font: "impact", treatment: "sticker", textObject: "grunge_sticker",
    imageStyle: "high-energy editorial poster with sharp subject separation",
  },
  documentary_collage_short: {
    energy: "bold", font: "impact", treatment: "plate", textObject: "block_plate",
    imageStyle: "premium archival evidence-board collage with one dramatic portrait-safe focal subject",
  },
  whiteboard: {
    energy: "bold", font: "marker", treatment: "stamp", textObject: "stamp_ink",
    imageStyle: "hand-drawn editorial chalk illustration with tactile board grain",
  },
  comic: {
    energy: "bold", font: "bebas", treatment: "stamp", textObject: "carved",
    imageStyle: "cinematic inked graphic-novel panel with cross-hatched dimensional light",
  },
  loreshort: {
    energy: "spectacle", font: "serif", treatment: "clean", textObject: "movie_poster",
    imageStyle: "epic painted concept-art tableau with chiaroscuro light and vast receding depth",
  },
  illustrated_explainer: {
    energy: "bold", font: "impact", treatment: "plate", textObject: "block_plate",
    imageStyle: "original premium editorial vector scene with one causal visual idea and clean diagrammatic hierarchy",
  },
  children_learning: {
    energy: "cozy_pop", font: "rounded", treatment: "clean", textObject: "block_plate",
    imageStyle: "original cheerful 2D learning scene with one clear safe action, stable friendly characters, and no branded properties",
  },
};

/**
 * A real, executable playbook derived entirely from the channel's Style DNA.
 * It is not called Golden or reference-backed: its job is to make a channel
 * operational when YouTube search/vision evidence is temporarily unavailable,
 * while the inception probe still validates an actual rendered thumbnail.
 */
export function buildStyleDnaPlaybook(args: {
  dna: StyleDNA;
  family: FamilyKey;
  channelName: string;
  now?: number;
}): ThumbnailPlaybook {
  const family = FAMILY_VISUAL_LANGUAGE[args.family];
  const palette = args.dna.thumbnail.palette.length
    ? args.dna.thumbnail.palette
    : args.dna.palette;
  const baseColor = palette[0] ?? "#111827";
  const accentColor = palette[Math.min(1, Math.max(0, palette.length - 1))] ?? "#ffd400";
  const subject = args.dna.thumbnail.subject || args.dna.recurringSubject;
  const setting = args.dna.setting;
  const shared =
    `DNA-LOCKED subject: ${subject}. Channel world: ${setting}. ` +
    `Palette ${palette.join(" / ") || `${baseColor} / ${accentColor}`}.`;
  const badge = args.channelName.toUpperCase();

  return {
    source: "style_dna_foundation",
    energy: family.energy,
    visualLanguage: {
      font: family.font,
      treatment: family.treatment,
      baseColor,
      accentColor,
      textObject: family.textObject,
      composition: "full_scene",
      imageStyle: family.imageStyle,
      badgeStyle: "pill",
      uppercase: args.family !== "sleep",
    },
    rules: [
      `The recurring click subject is always ${subject}.`,
      `Composition contract: ${args.dna.thumbnail.composition}.`,
      `Text contract: ${args.dna.thumbnail.textRule}.`,
      `Use only the locked thumbnail palette: ${palette.join(", ")}.`,
      "Reserve one clean 42% text zone opposite the hero before rendering.",
      "Headline is five words maximum, deterministically typeset, and readable at 120px.",
      "Keep critical content outside the 52px edge safe area and both bottom corners.",
    ],
    avoid: [
      ...args.dna.visualAvoid.slice(0, 4),
      "generic centered title cards",
      "baked-in AI typography or misspelled lettering",
      "text over faces, eyes, or the dominant subject",
      "decorative scenes that do not communicate the video topic",
    ],
    patterns: [
      {
        name: "signature-hero",
        when: "identity-led or benefit-led topic",
        fluxRecipe: `${shared} One dominant <TOPIC_HERO> on the right third, emotionally legible, with a dark simple left text zone.`,
        textRecipe: {
          lines: [{ text: "<HOOK_WORD>", accent: false }, { text: "<PAYOFF_WORD>", accent: true }],
          position: "left", baseColor, accentColor, uppercase: true, badge,
        },
      },
      {
        name: "story-tension",
        when: "conflict, transformation, mystery, or before/after topic",
        fluxRecipe: `${shared} Show <TOPIC_CONFLICT> as one coherent story moment on the left third, reserving clean dark negative space on the right.`,
        textRecipe: {
          lines: [{ text: "<TENSION_WORD>", accent: false }, { text: "<REVEAL_WORD>", accent: true }],
          position: "right", baseColor, accentColor, uppercase: true, badge,
        },
      },
      {
        name: "iconic-detail",
        when: "object, number, lesson, discovery, or calm mood topic",
        fluxRecipe: `${shared} Extreme close-up of one topic-specific <ICONIC_DETAIL>, high contrast and tactile, with uncluttered upper-left negative space.`,
        textRecipe: {
          lines: [{ text: "<CURIOSITY_HOOK>", accent: false }, { text: "<KEY_DETAIL>", accent: true }],
          position: "upperLeft", baseColor, accentColor, uppercase: true, badge,
        },
      },
    ],
    refsUsed: [],
    distilledAt: args.now ?? Date.now(),
  };
}

const THUMBNAIL_FAMILIES = new Set<FamilyKey>([
  "narrated_stock",
  "cinematic",
  "music_loop",
  "sleep",
  "shorts",
  "documentary_collage_short",
  "whiteboard",
  "comic",
]);

function assertExecutablePlaybook(playbook: ThumbnailPlaybook): void {
  if (!playbook.rules.length) {
    throw new Error("thumbnailLab: stored playbook has no Golden rules");
  }
  if (!playbook.patterns.length || playbook.patterns.some((pattern) =>
    !pattern.name?.trim() || !pattern.fluxRecipe?.trim() || !Object.keys(pattern.textRecipe ?? {}).length
  )) {
    throw new Error("thumbnailLab: stored playbook has no complete executable patterns");
  }
  if (
    !playbook.visualLanguage?.font ||
    !playbook.visualLanguage.imageStyle ||
    !playbook.visualLanguage.accentColor
  ) {
    throw new Error("thumbnailLab: stored playbook has incomplete visual language");
  }
}

/**
 * The one production playbook resolver used by both full renders and the
 * week-ahead queue. A present-but-corrupt stored playbook fails closed; only a
 * genuinely absent playbook may be rebuilt from complete Style DNA.
 */
export function resolveGoldenThumbnailPlaybook(args: {
  storedPlaybook?: ThumbnailPlaybook | null;
  dna?: StyleDNA | null;
  family?: string | null;
  channelName: string;
}): { playbook: ThumbnailPlaybook; strategy: "playbook" | "style_dna_foundation" } {
  if (args.storedPlaybook) {
    assertExecutablePlaybook(args.storedPlaybook);
    return {
      playbook: applyThumbnailChannelIdentity({
        channelName: args.channelName,
        playbook: args.storedPlaybook,
      }),
      strategy: "playbook",
    };
  }
  const family = args.family as FamilyKey | undefined;
  if (
    !args.dna?.recurringSubject?.trim() ||
    !args.dna.thumbnail?.subject?.trim() ||
    !Array.isArray(args.dna.thumbnail.palette) ||
    !family ||
    !THUMBNAIL_FAMILIES.has(family)
  ) {
    throw new Error(
      "thumbnailLab: production thumbnail readiness missing (need Style DNA + family or a stored playbook)",
    );
  }
  const playbook = buildStyleDnaPlaybook({
    dna: args.dna,
    family,
    channelName: args.channelName,
  });
  const identityLockedPlaybook = applyThumbnailChannelIdentity({
    channelName: args.channelName,
    playbook,
  });
  assertExecutablePlaybook(identityLockedPlaybook);
  return { playbook: identityLockedPlaybook, strategy: "style_dna_foundation" };
}

/** Deterministically chooses the exact stored Golden pattern for one artifact. */
export function selectGoldenThumbnailPattern(args: {
  playbook: ThumbnailPlaybook;
  seed: string;
  patternBias?: readonly string[];
}): { pattern: ThumbPattern; patternIndex: number } {
  assertExecutablePlaybook(args.playbook);
  const requested = new Set((args.patternBias ?? []).filter(Boolean));
  const pool = requested.size
    ? args.playbook.patterns.filter((pattern) => requested.has(pattern.name))
    : args.playbook.patterns;
  const candidates = pool.length ? pool : args.playbook.patterns;
  const patternIndex = [...args.seed]
    .reduce((sum, char) => sum + char.charCodeAt(0), 0) % candidates.length;
  return { pattern: candidates[patternIndex], patternIndex };
}

/**
 * The production browse-strip gate shared by normal and week-ahead
 * thumbnails. Provider absence and judge errors are deliberately surfaced to
 * the caller; production callers must fail closed via assertThumbnailGate.
 */
export async function runThumbnailMobileReferenceQa(args: {
  outJpg: string;
  tmpDir: string;
  title: string;
  niche?: string;
  playbook: ThumbnailPlaybook;
  referenceUrls?: readonly string[];
  brandContext?: Record<string, unknown> | null;
  visualTreatmentCriteria?: readonly string[];
  /** Exact native copy planned before generation. OCR must find every item. */
  expectedWords?: readonly string[];
  /** Final admission may select the stronger pinned reviewer explicitly. */
  qaTier?: VisionTier;
  log?: Logger;
}): Promise<ThumbnailGateVerdict> {
  if (!hasVisionKey()) {
    throw new Error("thumbnailLab: a configured production QA provider is required");
  }
  assertExecutablePlaybook(args.playbook);
  const mobileJpg = join(args.tmpDir, "thumbnail_mobile_168.jpg");
  await imageToJpeg(args.outJpg, mobileJpg, 168, 94);
  const refPaths: string[] = [];
  // The pinned final reviewer accepts two images total: candidate + one
  // reference. Fast comparative review accepts the broader four-ref strip.
  const referenceLimit = args.qaTier === "final" ? 1 : 4;
  const referenceUrls = [...new Set(args.referenceUrls ?? [])].filter(Boolean).slice(0, referenceLimit);
  for (let index = 0; index < referenceUrls.length; index++) {
    try {
      refPaths.push(await downloadTo(referenceUrls[index], join(args.tmpDir, `qa_ref_${index}.jpg`)));
    } catch (error) {
      args.log?.(
        `thumbnailLab: skipped unreachable QA reference ${index + 1}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  const visualTreatmentCriteria = [
    ...(args.playbook.identityContract?.reviewCriteria ?? []),
    ...(args.visualTreatmentCriteria ?? []),
  ]
    .map((criterion) => criterion.trim())
    .filter(Boolean)
    .slice(0, 8);
  const requiresVisualTreatmentVerdict = visualTreatmentCriteria.length > 0;
  const raw = await visionLocal({
    prompt:
      `Image 1 is a CANDIDATE YouTube thumbnail rendered at real mobile browse size (~168px wide). ` +
      (refPaths.length
        ? `Images 2-${refPaths.length + 1} are verified reference thumbnails selected for this channel playbook and craft review. `
        : "No reference image was reachable, so apply the same production bar without comparative evidence. ") +
      `Video title: "${args.title}"${args.niche ? `, niche: ${args.niche}` : ""}.\n` +
      (args.brandContext ? `CHANNEL STYLE DNA: ${JSON.stringify(args.brandContext)}.\n` : "") +
      `FULL GOLDEN PLAYBOOK RULES:\n- ${args.playbook.rules.join("\n- ")}\n` +
      `USER-APPROVED GOLDEN CRAFT BAR:\n- ${GOLDEN_THUMBNAIL_CRAFT_RULES.join("\n- ")}\n` +
      `OWNER-SELECTED A/B PREFERENCES (generalize the craft, never copy a selected scene):\n- ` +
      `${OWNER_SELECTED_THUMBNAIL_PREFERENCE_RULES.join("\n- ")}\n` +
      (args.playbook.avoid.length
        ? `REJECTED ANTI-PATTERNS:\n- ${args.playbook.avoid.join("\n- ")}\n`
        : "") +
      `Judge the candidate against the production gate:\n` +
      `(1) textOk: every visible word is correctly spelled and readable at THIS size.` +
      (args.expectedWords?.length
        ? ` The pre-render plan requires EXACTLY ${args.expectedWords.map((word) => `"${word}"`).join(" and ")}; ` +
          `a synonym, expanded/shortened number, changed unit, or different payoff word is false. ` +
          `Beyond that exact headline, only ONE compact instance of the channel name may appear as the identity badge; ` +
          `a repeated channel name, subtitle, tagline, or supporting sentence makes textOk false.\n`
        : "\n") +
      `(2) faceClear: any intended face is clear and undistorted (true when no face is intended).\n` +
      `(3) Rate punch, styleMatch, and storyMatch 1-10` +
      (refPaths.length ? ` against the reference set.\n` : `.\n`) +
      `(4) uiClean: no broken glyphs, watermarks, accidental UI, clipping, or unreadable clutter.\n` +
      (requiresVisualTreatmentVerdict
        ? `(5) visualTreatmentCompliant: evaluate ALL of these non-negotiable treatment criteria against the actual candidate; false if any fail:\n- ${visualTreatmentCriteria.join("\n- ")}\n`
        : "") +
      `Return ONLY JSON {"textOk":boolean,"transcribedText":["every visible text item exactly as read"],` +
      `"faceClear":boolean,"punch":1-10,"styleMatch":1-10,` +
      `"storyMatch":1-10,"uiClean":boolean,` +
      (requiresVisualTreatmentVerdict ? `"visualTreatmentCompliant":boolean,` : "") +
      `"reason":"..."}.`,
    imagePaths: [mobileJpg, ...refPaths],
    json: true,
    maxTokens: VISION_GATE_MAX_TOKENS,
    tier: args.qaTier,
  });
  const verdict = parseJsonLoose<Partial<ThumbnailGateVerdict>>(raw);
  const reasonValue = verdict.reason as unknown;
  const reason = typeof reasonValue === "string"
    ? reasonValue
    : reasonValue && typeof reasonValue === "object"
      ? JSON.stringify(reasonValue).slice(0, 2_000)
      : "judge omitted its reason";
  let copyVerified = !args.expectedWords?.length;
  let ocrReason = "";
  if (args.expectedWords?.length) {
    const transcriptValue = (verdict as Partial<ThumbnailGateVerdict> & {
      transcribedText?: unknown;
    }).transcribedText;
    const transcript = Array.isArray(transcriptValue)
      ? transcriptValue.filter((item): item is string => typeof item === "string").join("\n")
      : typeof transcriptValue === "string" ? transcriptValue : "";
    const transcriptMatch = thumbnailOcrMatchesExpected({
      ocrText: transcript,
      expectedWords: args.expectedWords,
    });
    try {
      const ocrText = await readThumbnailOcr(args.outJpg);
      const ocr = thumbnailOcrMatchesExpected({ ocrText, expectedWords: args.expectedWords });
      // An art-direction word rendered INTO the artwork ("HUGE", "PAYOFF") adds
      // no missing copy, so presence checks alone score it exact and ship it.
      // Either reader seeing one is damning; a vision transcript cannot
      // disprove an extra word that is physically in the pixels.
      const leaked = [...new Set([...ocr.leaked, ...transcriptMatch.leaked])];
      // A misspelling only blocks when neither reader saw the correct string:
      // the vision transcript is the tie-breaker against noisy OCR on
      // deliberately stylized type.
      const misspelled = ocr.misspelled
        .filter((defect) => !transcriptMatch.normalizedOcr.includes(defect.expected));
      copyVerified = (ocr.matched || transcriptMatch.matched)
        && leaked.length === 0
        && misspelled.length === 0;
      if (!copyVerified) {
        const faults: string[] = [];
        if (!ocr.matched && !transcriptMatch.matched) {
          faults.push(`missing planned copy: ${ocr.missing.join(", ")}`);
        }
        if (leaked.length) {
          faults.push(
            `the artwork renders art-direction instruction words instead of obeying them: ` +
            `${leaked.join(", ")} — write ONLY the planned headline copy`,
          );
        }
        if (misspelled.length) {
          faults.push(
            `misspelled headline copy: ` +
            `${misspelled.map((d) => `"${d.observed}" should read "${d.expected}"`).join(", ")}`,
          );
        }
        ocrReason = `${faults.join("; ")} ` +
          `(OCR: ${ocr.normalizedOcr || "nothing"}; vision transcript: ${transcriptMatch.normalizedOcr || "nothing"})`;
      }
    } catch (error) {
      copyVerified = transcriptMatch.matched && transcriptMatch.leaked.length === 0;
      if (!copyVerified) {
        ocrReason = `exact planned copy was not verified (OCR: ` +
          `${error instanceof Error ? error.message : String(error)}; ` +
          `vision transcript: ${transcriptMatch.normalizedOcr || "nothing"})`;
      }
    }
  }
  return {
    textOk: verdict.textOk === true && copyVerified,
    faceClear: verdict.faceClear === true,
    punch: Number(verdict.punch ?? 0),
    styleMatch: Number(verdict.styleMatch ?? 0),
    storyMatch: Number(verdict.storyMatch ?? 0),
    uiClean: verdict.uiClean === true,
    ...(requiresVisualTreatmentVerdict
      ? { visualTreatmentCompliant: verdict.visualTreatmentCompliant === true }
      : {}),
    reason: [reason, ocrReason].filter(Boolean).join(" | "),
  };
}

/* --------------------- 0. acquire fresh references --------------------- */

/**
 * Direct, positioning-true reference acquisition — the repair for polluted
 * niche scrapes (the catalog-keyword scrape returned 0 verifiable references
 * for Investory). The lab derives search queries from the channel's OWN
 * positioning, pulls top-VIEW videos straight from YouTube, and lets the
 * vision screen do the final verification.
 */
export interface AcquiredRef {
  url: string;
  views: number;
  videoId: string;
  title: string;
}

export async function acquireReferences(args: {
  channelName: string;
  positioning: string;
  niche?: string;
  log?: Logger;
}): Promise<AcquiredRef[]> {
  const log = args.log ?? (() => {});
  if (!hasAnthropicKey()) throw new Error("thumbnailLab: OPENROUTER_API_KEY required");
  const q = await claudeJson<{ queries?: string[] }>({
    maxTokens: 400,
    temperature: 0.4,
    system: "You are a YouTube competitive-research strategist. Return ONLY JSON.",
    prompt:
      `Channel: "${args.channelName}"${args.niche ? ` (${args.niche})` : ""}.\nPositioning: ${args.positioning}\n\n` +
      `Write 4 YouTube SEARCH QUERIES that surface the videos of TRUE comparable channels — same tier, same ` +
      `format, same audience promise (NOT adjacent hustle/clickbait verticals). Concrete video-search phrasing ` +
      `(what a viewer of those channels actually searches), 2-5 words each. ` +
      `Return STRICT JSON {"queries":string[]}.`,
  });
  const queries = (q.queries ?? []).filter(Boolean).slice(0, 4);
  if (!queries.length) throw new Error("thumbnailLab: no reference search queries derived");
  log(`thumbnailLab: acquiring references via ${queries.length} positioning-true queries: ${queries.join(" | ")}`);

  const { searchVideoIds, fetchVideoDetails } = await import("@/lib/youtubeData");
  const ids = new Set<string>();
  for (const query of queries) {
    try {
      for (const id of await searchVideoIds({ query, maxResults: 12 })) ids.add(id);
    } catch (e) {
      log(`thumbnailLab: search "${query}" failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  const details = await fetchVideoDetails([...ids]);
  // Channel diversity: max 2 references per channel, ranked by views.
  const perChannel = new Map<string, number>();
  const picks: AcquiredRef[] = [];
  for (const d of details.sort((a, b) => (b.views ?? 0) - (a.views ?? 0))) {
    const url = d.thumbnailUrl;
    if (!url) continue;
    const n = perChannel.get(d.channelId) ?? 0;
    if (n >= 2) continue;
    perChannel.set(d.channelId, n + 1);
    picks.push({ url, views: d.views ?? 0, videoId: d.youtubeVideoId, title: d.title });
    if (picks.length >= 16) break;
  }
  log(`thumbnailLab: acquired ${picks.length} fresh reference candidates from ${perChannel.size} channels`);
  return picks;
}

/* ------------------------- 1. verify references ------------------------ */

export async function verifyReferences(args: {
  candidates: { url: string; views: number }[];
  channelName: string;
  positioning: string;
  tmpDir: string;
  log?: Logger;
}): Promise<VerifiedRef[]> {
  const log = args.log ?? (() => {});
  if (!hasVisionKey()) {
    throw new Error("thumbnailLab: a configured vision provider is required");
  }
  const top = args.candidates
    .filter((c) => c.url)
    .sort((a, b) => b.views - a.views)
    .slice(0, 12);
  const paths: { path: string; url: string; views: number }[] = [];
  for (let i = 0; i < top.length; i++) {
    try {
      paths.push({
        path: await downloadTo(top[i].url, join(args.tmpDir, `ref_${i}.jpg`)),
        url: top[i].url,
        views: top[i].views,
      });
    } catch { /* unreachable url — skip */ }
  }
  if (paths.length < 3) throw new Error(`thumbnailLab: only ${paths.length} reference thumbnails reachable`);

  const raw = await visionLocal({
    prompt:
      `These are ${paths.length} thumbnails from the HIGHEST-VIEW videos scraped in this niche, in order.\n` +
      `Channel being built: "${args.channelName}" — positioning: ${args.positioning}\n\n` +
      `For EACH image (1-${paths.length}): does it belong to the same PREMIUM/CINEMATIC tier and positioning ` +
      `(vs hustle-bro, crypto-pump, shocked-face tabloid, or low-craft clickbait)? Score craft 1-10 ` +
      `(composition, typography, color discipline). Return STRICT JSON ` +
      `{"refs":[{"idx":1-based,"onBrand":boolean,"craft":1-10,"why":"<=15 words"}]} — judge every image.`,
    imagePaths: paths.map((p) => p.path),
    json: true,
    // 12 per-ref verdicts truncate at small budgets ("Expected ','" parse flake)
    maxTokens: 3200,
  });
  const parsed = parseJsonLoose<{ refs?: { idx?: number; onBrand?: boolean; craft?: number; why?: string }[] }>(raw);
  const verdicts = parsed.refs ?? [];
  const verified: VerifiedRef[] = [];
  const craftOnly: VerifiedRef[] = [];
  for (const v of verdicts) {
    const i = (v.idx ?? 0) - 1;
    if (i < 0 || i >= paths.length) continue;
    if (v.onBrand && (v.craft ?? 0) >= 6) {
      verified.push({ ...paths[i], craft: v.craft ?? 6, why: v.why ?? "" });
    } else if ((v.craft ?? 0) >= 6) {
      craftOnly.push({ ...paths[i], craft: v.craft ?? 6, why: `craft-only evidence (off-brand): ${v.why ?? ""}` });
    }
  }
  verified.sort((a, b) => b.craft - a.craft || b.views - a.views);
  log(`thumbnailLab: ${verified.length}/${paths.length} references VERIFIED on-brand+high-craft (rest rejected as pollution)`);
  // BRAND-DIVERGENCE ESCAPE: a deliberately unique look (the whole point of the
  // DNA) can mean NO niche thumbnail reads as on-brand. The playbook gets its
  // look from the DNA; references only evidence what clickbait CRAFT wins in
  // the niche - so top off with high-craft off-brand winners, loudly labelled.
  if (verified.length < 3 && craftOnly.length) {
    craftOnly.sort((a, b) => b.craft - a.craft || b.views - a.views);
    const need = Math.min(3 - verified.length + 1, craftOnly.length);
    verified.push(...craftOnly.slice(0, need));
    log(`thumbnailLab: brand-divergent niche - grounding on ${need} high-craft OFF-BRAND winners as craft evidence (look stays DNA-locked)`);
  }
  // 2 refs + DNA still grounds a playbook (the DNA owns the look; refs only
  // evidence niche craft) - below that the scrape is genuinely useless.
  if (verified.length === 2) {
    log("thumbnailLab: thin evidence (2 refs) - proceeding, playbook leans harder on DNA + craft principles");
  }
  if (verified.length < 2) {
    throw new Error(
      `thumbnailLab: only ${verified.length} verified references — the scraped niche set is too polluted to ground a playbook (re-run niche research with corrected queries)`,
    );
  }
  return verified.slice(0, 6);
}

/* --------------------------- 2. distill rules --------------------------- */

export async function distillPlaybook(args: {
  refs: VerifiedRef[];
  dna: StyleDNA | null;
  channelName: string;
  positioning: string;
  log?: Logger;
}): Promise<ThumbnailPlaybook> {
  const log = args.log ?? (() => {});
  // Vision deconstruction — WHY each verified winner clicks.
  if (args.refs.length === 0) {
    log("thumbnailLab: ZERO references (search quota dead?) - distilling from DNA + craft principles only");
  }
  const deconRaw = args.refs.length === 0 ? '{"decon":[]}' : await visionLocal({
    prompt:
      `Deconstruct WHY each of these ${args.refs.length} proven high-view thumbnails wins the click. ` +
      `For each (1-${args.refs.length}): composition (focal placement, negative space), hero device ` +
      `(object/face/number/chart), text treatment (word count, casing, colors, position, any accent word), ` +
      `color story (base + accents), annotation devices (underline/circle/arrow/glow), and the curiosity ` +
      `mechanism. Be CONCRETE (hex-ish colors, word counts, positions). Return STRICT JSON ` +
      `{"decon":[{"idx":number,"composition":string,"hero":string,"text":string,"colors":string,"devices":string,"curiosity":string}]}.`,
    imagePaths: args.refs.map((r) => r.path),
    json: true,
    maxTokens: 2400,
  });
  const decon = parseJsonLoose<{ decon?: unknown[] }>(deconRaw).decon ?? [];
  log(`thumbnailLab: deconstructed ${decon.length} winning thumbnails`);

  if (!hasAnthropicKey()) throw new Error("thumbnailLab: OPENROUTER_API_KEY required for playbook synthesis");
  const palette = (args.dna?.thumbnail?.palette?.length ? args.dna.thumbnail.palette : args.dna?.palette) ?? [];
  const accent = palette.length >= 2 ? palette[palette.length - 2] : "#ffd400";

  const play = await claudeJson<{
    energy?: string;
    visualLanguage?: VisualLanguage;
    rules?: string[];
    avoid?: string[];
    patterns?: { name?: string; when?: string; fluxRecipe?: string; textRecipeJson?: string }[];
  }>({
    tier: "pro",
    // The visualLanguage-era schema is bigger — 3000 truncated mid-JSON
    // ("Expected ',' or '}'") on two of four channels.
    maxTokens: 6000,
    temperature: 0.5,
    system: "You are an elite YouTube thumbnail strategist. Return ONLY JSON.",
    prompt:
      `Build the THUMBNAIL PLAYBOOK for "${args.channelName}" (${args.positioning}).\n\n` +
      `EVIDENCE — deconstruction of ${decon.length} verified high-view, on-positioning thumbnails:\n` +
      `${JSON.stringify(decon).slice(0, 6000)}\n\n` +
      `CHANNEL DNA: palette ${palette.join(", ")} (accent ${accent}); thumbnail subject: ` +
      `${args.dna?.thumbnail?.subject ?? args.dna?.recurringSubject ?? "n/a"}; world: ${args.dna?.setting ?? "n/a"}.\n\n` +
      `${(args.dna as { thumbnailAnchors?: string[] } | null)?.thumbnailAnchors?.length ? `OPERATOR-ANCHORED REFERENCE THUMBNAILS (the operator personally chose these as THE BAR for this channel - weight them ABOVE the scraped evidence when they conflict):\n- ${(args.dna as { thumbnailAnchors?: string[] }).thumbnailAnchors!.join("\n- ")}\n\n` : ""}` +
      `RESEARCH PRINCIPLES (hard constraints):\n- ${RESEARCH_PRINCIPLES.join("\n- ")}\n\n` +
      `Synthesize:\n` +
      `0. energy: the channel's clickbait tier — "spectacle" (over-the-top impossible-scale drama: finance/tech/` +
      `drama channels), "bold" (grounded heroic punch: education/history/documentary), or "cozy_pop" (charming ` +
      `saturated warmth: lofi/ambient/kids). ALL tiers are CATCHY — pick what this identity can carry.\n` +
      `0b. visualLanguage: the channel's UNMISTAKABLE identity — {"font":"impact"|"marker"|"bebas"|"serif"|"rounded" ` +
      `(impact=bold modern, marker=hand-drawn, bebas=tall minimal, serif=editorial premium, rounded=soft playful), ` +
      `"treatment":"plate"|"sticker"|"stamp"|"neon"|"clean" (plate=filled box, sticker=white box+hard shadow pop, ` +
      `stamp=hollow archival border, neon=glowing type for night/synth worlds, clean=pure premium type), ` +
      `"baseColor":"#hex","accentColor":"#hex" — colors MUST come from THIS channel's palette; NEVER default to ` +
      `gold/yellow unless it is genuinely this channel's color, ` +
      `"textObject":"torn_strip"|"paint_smear"|"censor_bar"|"grunge_sticker"|"spaced_elegant"|"block_plate"|"neon_sign"|"spray_paint"|"stamp_ink"|"movie_poster"|"ransom_note"|"carved"|"scene_forged" (scene_forged = the headline takes the scene's own plane, angle, lighting and symmetry while staying the most prominent graphic; pick it for cinematic, atmospheric or photographic worlds where the type should belong to the picture rather than sit on it) (the channel SIGNATURE motif for the deterministic LOCAL typography layer; it must never appear in fluxRecipe or become a textual scene prop), "imageStyle":"<=12 words — the base-image rendering style (e.g. 'painterly anime watercolor', 'vintage ink ` +
      `engraving', 'hyperreal cinematic 3D', 'retro screenprint poster')","badgeStyle":"center"|"pill","composition":"cutout_collage"|"full_scene" (cutout_collage = the hero is a clean die-cut PHOTO cutout with crisp edges pasted OVER a designed collage background of torn clippings/photos/graphic shapes - real photographic grain, magazine-composite feel; PICK THIS for commentary/persona/drama/expose channels because continuous AI scenes read fake there. full_scene = one continuous rendered scene for painterly/cinematic worlds),` +
      `"uppercase":boolean}. THE RULE: if another channel could wear this language, it is WRONG — diverge hard.\n` +
      `1. rules: 6-8 HARD rules for this channel's thumbnails — specific (sizes, positions, counts, colors), ` +
      `derived from the evidence + principles, honoring the DNA palette.\n` +
      `2. avoid: 4-6 anti-patterns seen in the rejected/owned space.\n` +
      `3. patterns: EXACTLY 3 named, executable patterns (distinct compositions — e.g. number-forward / ` +
      `hero-object / annotated-chart). Each: name; when (which video topics); fluxRecipe = a TEXT-FREE ` +
      `image-generation scene recipe with <PLACEHOLDERS> for the topic-specific hero (palette + grade baked in, ` +
      `composition explicit incl. where negative space lives); textRecipeJson = a JSON-ENCODED STRING of the ` +
      `text-layer props: {"lines":[{"text":"<HOOK_WORD_1>","accent":false},{"text":"<HOOK_WORD_2>","accent":true}],` +
      `"numberCallout":"<NUMBER>" (include this key ONLY in number-led patterns; otherwise LEAVE THE KEY OUT of the ` +
      `JSON entirely - NEVER write placeholder words like OMIT),"position":"left|center|upperLeft|upperCenter","baseColor":"#hex",` +
      `"accentColor":"#hex","uppercase":true,"underlineAccent":true,` +
      `"font":"impact"|"marker"|"bebas" (impact=bold modern default; marker=hand-drawn-but-readable — USE for ` +
      `sketch/whiteboard/cozy/playful identities; bebas=tall minimal premium),` +
      `"badge":"${args.channelName.toUpperCase()}"} ` +
      `— placeholders ONLY in line texts and numberCallout.\n` +
      `Return STRICT JSON {"energy":"spectacle"|"bold"|"cozy_pop","visualLanguage":{"font","treatment","baseColor","accentColor","textObject","composition","imageStyle","badgeStyle","uppercase"},"rules":string[],"avoid":string[],"patterns":[{"name","when","fluxRecipe","textRecipeJson"}]} - energy AND visualLanguage are REQUIRED keys.`,
  });

  const patterns: ThumbPattern[] = (play.patterns ?? [])
    .map((p) => {
      let textRecipe: Record<string, unknown> = {};
      try { textRecipe = JSON.parse(p.textRecipeJson ?? "{}") as Record<string, unknown>; } catch { /* empty */ }
      return {
        name: p.name ?? "pattern",
        when: p.when ?? "",
        fluxRecipe: p.fluxRecipe ?? "",
        textRecipe,
      };
    })
    .filter((p) => p.fluxRecipe && Object.keys(p.textRecipe).length > 0)
    .slice(0, 3);
  if (patterns.length === 0) throw new Error("thumbnailLab: playbook synthesis produced no executable patterns");
  // A playbook without its visual identity is a generic-thumbnail factory —
  // refuse it loudly rather than persist undefined font/style to the channel.
  const vlOut = play.visualLanguage;
  if (!vlOut?.font || !vlOut?.imageStyle || !vlOut?.accentColor) {
    throw new Error(
      `thumbnailLab: playbook synthesis returned incomplete visualLanguage (font=${vlOut?.font} imageStyle=${vlOut?.imageStyle} accent=${vlOut?.accentColor}) — retry the distill`,
    );
  }

  log(`thumbnailLab: playbook distilled — ${play.rules?.length ?? 0} rules, ${patterns.length} patterns (${patterns.map((p) => p.name).join(" / ")})`);
  return {
    source: "verified_references",
    energy: (["spectacle", "bold", "cozy_pop"].includes(String(play.energy)) ? play.energy : "bold") as ThumbnailPlaybook["energy"],
    visualLanguage: play.visualLanguage,
    rules: play.rules ?? [],
    avoid: play.avoid ?? [],
    patterns,
    refsUsed: args.refs.map((r) => ({ url: r.url, views: r.views, why: r.why })),
    distilledAt: Date.now(),
  };
}

/* ---------------------------- 3. tournament ---------------------------- */

export interface TournamentCandidate {
  path: string;
  pattern: string;
  clickScore?: number;
  beatsRefs?: number;
  notes?: string;
}

export interface TournamentResult {
  candidates: TournamentCandidate[];
  winnerIdx: number;
  judgeWhy: string;
}

export interface ThumbnailCandidateRenderResult extends ThumbnailRenderResult {
  pattern: string;
  /** Planned copy retained for independent post-render OCR. */
  expectedWords?: string[];
  /**
   * Exact text-free scene / deterministic-typography split. Batch providers
   * use this persisted plan to render the already-art-directed scene without
   * asking a second model to re-plan the thumbnail.
   */
  renderSpec?: ThumbnailRenderSpec;
  concept: {
    heroProp: string | null;
    background: string | null;
    details: string[];
    scenePrompt: string;
  };
}

export interface DesignedThumbnailRequest {
  /** Complete one-pass Nano Banana Pro art-direction prompt, including exact copy. */
  prompt: string;
  brief: ThumbBriefArgs;
  expectWords: string[];
}

export type GenerateDesignedThumbnail = (
  request: DesignedThumbnailRequest,
) => Promise<Uint8Array>;

/** Instantiate ONE pattern into a finished candidate (base + typography). */
export async function renderCandidate(args: {
  pattern: ThumbPattern;
  title: string;
  channelName?: string;
  scriptHint?: string;
  /** Topicraft's already-judged physical story moment. The Golden pattern may
   * compose it, but must not replace its actors, objects, action, or causal beat. */
  sceneSeed?: string;
  /** DNA/operator-locked scene: the heroProp MUST be this subject (hard rail, not inspiration). */
  sceneMandate?: string;
  playbook: ThumbnailPlaybook;
  outJpg: string;
  tmpDir: string;
  idx: number;
  /**
   * Concrete defects the QA grader found in the PREVIOUS candidate for this
   * same video (P1-3). Present only on a regenerate; the art director must fix
   * these specifically rather than re-rolling the same concept blindly.
   */
  priorIssues?: readonly string[];
  /** This channel's standing critic instruction, applied to the art direction. */
  criticDoctrine?: string;
  /** Provenance-bound rules shared by the local compositor and image provider. */
  visualTreatment?: ThumbnailVisualTreatment;
  /** Explicit production still route. There is deliberately no provider fallback. */
  generateScene?: GenerateScene;
  /** Proven Nano Banana Pro one-pass route: scene + physical typography. */
  generateDesignedThumbnail?: GenerateDesignedThumbnail;
  log?: Logger;
}): Promise<ThumbnailCandidateRenderResult> {
  const identityContract = args.playbook.identityContract;
  const identityDirection = identityContract
    ? `CHANNEL IDENTITY CONTRACT (non-negotiable; reject a scene that misses any visible fact):\n` +
      `MUST SHOW:\n- ${identityContract.requiredSceneEvidence.join("\n- ")}\n` +
      `MUST NOT SHOW:\n- ${identityContract.prohibitedVisualPatterns.join("\n- ")}`
    : "";
  // TWO-PASS DESIGN: the LAYOUT is decided FIRST (which zone the text owns),
  // the image is generated WITH that zone deliberately reserved as negative
  // space, then the text lands in its planned home — never fighting the image.
  // STORY-INTEREST LIFT: corrections fed back into a second instantiation when
  // the first concept scores as a weak or inert subject. Text-only, so a dull
  // idea is replaced before any image is paid for.
  let storyLift: readonly string[] = [];
  const instantiate = async () => claudeJson<{
    heroProp?: string;
    background?: string;
    details?: string[];
    fluxPrompt?: string;
    textPropsJson?: string;
    textZone?: string;
    layoutMode?: "split" | "centered_hero";
  }>({
    // The native design brief needs enough room for structured scene and hook
    // planning before the JSON response closes.
    maxTokens: 3000,
    tier: "pro",
    temperature: 0.75,
    system: "You are an elite YouTube thumbnail art director. Return ONLY JSON.",
    prompt:
      `Instantiate this thumbnail PATTERN for the video "${args.title}".\n` +
      // Story interest is decided BEFORE layout and scene invention: craft
      // cannot rescue a subject nobody cares about.
      `${STORY_INTEREST_DOCTRINE.join("\n")}\n` +
      (storyLift.length
        ? `THE PREVIOUS CONCEPT WAS REJECTED AS A WEAK SUBJECT, not a weak execution. The craft was fine; the story ` +
          `was not worth telling. Choose a genuinely more interesting subject for this same video:\n` +
          `${storyLift.map((lift) => `- ${lift}`).join("\n")}\n`
        : "") +
      // Regenerate feedback comes FIRST so it cannot be buried under the
      // standing pattern rules — this is the whole point of the critique loop.
      ((args.priorIssues ?? []).length
        ? `THE PREVIOUS ATTEMPT WAS REJECTED BY THE QA GRADER. Fix these specific defects — do not simply re-roll ` +
          `the same concept:\n${(args.priorIssues ?? []).slice(0, 6).map((issue) => `- ${String(issue).replace(/\s+/g, " ").trim().slice(0, 240)}`).join("\n")}\n`
        : "") +
      (args.criticDoctrine
        ? `CHANNEL CRITIC DOCTRINE (this channel's standing standard — honour it): ${args.criticDoctrine.replace(/\s+/g, " ").trim().slice(0, 400)}\n`
        : "") +
      (args.visualTreatment?.artDirectionRules?.length
        ? `NON-NEGOTIABLE VISUAL TREATMENT (apply every rule; this overrides pattern inspiration and generic CTR conventions):\n- ${args.visualTreatment.artDirectionRules.join("\n- ")}\n`
        : "") +
      (identityDirection ? `${identityDirection}\n` : "") +
      `${args.sceneMandate ? `MANDATORY SCENE (operator/DNA-locked - NOT inspiration, NOT optional): the heroProp MUST be exactly this subject, adapted to this topic: ${args.sceneMandate}. Invent background and details AROUND it - never replace it.\n` : ""}` +
      (args.sceneSeed
        ? `TOPICRAFT-JUDGED STORY MOMENT (mandatory grounding): ${args.sceneSeed}. Preserve its actors, objects, physical action, and cause/effect. The pattern controls composition and styling; it may not substitute a different story.\n`
        : "") +
      (args.scriptHint ? `Video content hint: ${args.scriptHint.slice(0, 500)}\n` : "") +
      `PATTERN "${args.pattern.name}": ${args.pattern.fluxRecipe}\n` +
      `TEXT TEMPLATE: ${JSON.stringify(args.pattern.textRecipe)}\n` +
      `FULL GOLDEN PLAYBOOK RULES:\n- ${args.playbook.rules.join("\n- ")}\n` +
      `OWNER-SELECTED A/B PREFERENCES (generalize composition only):\n- ` +
      `${OWNER_SELECTED_THUMBNAIL_PREFERENCE_RULES.join("\n- ")}\n` +
      (args.playbook.avoid.length
        ? `FULL PLAYBOOK AVOID LIST:\n- ${args.playbook.avoid.join("\n- ")}\n\n`
        : "\n") +
      `STEP 1 — LAYOUT: choose layoutMode ("split" or "centered_hero") and textZone ("left"|"right"|"upperLeft"|"upperRight"|"upperCenter"). ` +
      `These are EQUAL options — pick the one this specific image is strongest in, not a default. ` +
      `split: large hero opposite the text zone, best for copy-dense hooks and asymmetric action. ` +
      `centered_hero: the hero owns the middle and stares the viewer down — a confrontational, symmetrical, ` +
      `one-point-perspective frame with the subject at peak action dead centre. This is a POWERFUL choice, not a ` +
      `fallback: use it when the subject is a face, a mask, a barrel-on object, a doorway, a corridor, or any ` +
      `head-on moment that gains force from being met square. Build real depth and tension around it (converging ` +
      `lines, foreground occlusion, atmosphere) and land the type in the clean pockets above or beside the ` +
      `silhouette. The only thing to avoid is a flat, empty, evenly-lit title card with a small object floating ` +
      `in the middle — symmetry itself is welcome when the image is charged.\n` +
      `STEP 2 — fluxPrompt: INVENT A NEW CONCEPT for this topic (the pattern recipe above is INSPIRATION ONLY — ` +
      `never reproduce its literal scene). ENERGY TIER = "${args.playbook.energy ?? "bold"}":\n` +
      (args.playbook.energy === "spectacle"
        ? `SPECTACLE: go to the edge of absurd — IMPOSSIBLE SCALE (a tsunami of coins crashing toward a tiny figure, ` +
          `a banknote the size of a skyscraper), PHYSICS-DEFYING moments frozen mid-action, cinematic catastrophe/` +
          `triumph. The viewer's reaction must be "WHAT?!".\n`
        : args.playbook.energy === "cozy_pop"
          ? `COZY-POP: irresistibly charming and warm — but PUNCHY: one adorable/magical focal moment (impossibly ` +
            `cozy light, oversized moon, glowing window, a cat doing something delightful), saturated inviting ` +
            `color, storybook wonder. Catchy and clickable, never sleepy or flat.\n`
          : `BOLD: grounded but dramatic — one striking focal subject at heroic scale, charged atmosphere (storm ` +
            `light, golden hour blaze, deep shadow), strong tension or payoff in the frame. Punchy, never generic.\n`) +
      `Keep ONLY the channel's palette + grade + finish from its world — the SCENE must be new each time. ` +
      `Hyper-saturated, volumetric light. COMPOSED FOR THE CHOSEN LAYOUT: split = subject opposite textZone with a clean darker 40% type field; centered_hero = hero centered at peak action with asymmetric supporting depth and protected type pockets around its silhouette. ` +
      `The final native design may contain ONLY the exact planned headline and compact channel badge—no other ` +
      `words, letters, numbers, equations, financial symbols, signs, labels, documents with writing, or logos.\n` +
      `NARRATIVE COHERENCE (hard requirement): the scene must LITERALLY ENACT the topic so a viewer instantly ` +
      `reads what the video is about - subjects ACTING OUT the idea (for "conquering anxiety": a stoic statue ` +
      `laying a steadying hand on a crumbling statue shoulder; for "market crash": a figure watching a collapsing ` +
      `red line tear through the floor). NEVER decorative abstraction (random dust, glows, floating objects) that ` +
      `does not tell the story. Test: cover the text - does the image alone communicate the topic?\n` +
      `CLICK SPECTACLE (hard requirement): freeze the ONE most consequential physical transformation at its peak—` +
      `rupture, avalanche, reversal, collision, escape, exposure, or impossible reveal. Make the cause and payoff visible ` +
      `in one glance. The hero must feel dangerous, surprising, or nearly impossible, never like a polished product render. ` +
      `For money topics, dramatize the exact input-to-payoff mechanism rather than showing generic coins or charts.\n` +
      `STEP 2b - BUILD THE SCENE IN NAMED STAGES (how the top 1% compose):\n` +
      `heroProp: the ONE dominant subject - 55-75% of the frame, emotionally charged, AGGRESSIVELY cropped with edges bleeding off frame (phone-screen scale) ` +
      `(a cracked marble face glaring, a grumpy mogul portrait, a war elephant chest-on). In split mode it sits opposite textZone; in centered_hero mode it anchors the middle while the hook uses a clear outer pocket.\n` +
      `background: a SEPARATE supporting layer behind the hero - darker, simpler, with depth (torn tabloid strips, ` +
      `a blurred crowd in red, a burning skyline, a storm sky). It frames the hero, never competes.\n` +
      `details: 1-2 NON-TEXTUAL story-carrying additions ON or AROUND the hero that make the click irresistible ` +
      `(fire reflected in glasses lenses, a glowing crack across the chest, a red zigzag crash line). ` +
      `Never request newspapers, signs, posters, labels, screens, letters, words, or any other textual prop. ` +
      `Each detail must deepen the SAME story - nothing random.\n` +
      `STEP 3 — textPropsJson: the template as a JSON-ENCODED STRING with placeholders replaced. The finished ` +
      `thumbnail may have at most TWO visual text lines total, including numberCallout. Before choosing copy, silently ` +
      `generate SIX distinct hooks and score each for curiosity gap, emotional tension, concrete specificity, visual synergy, ` +
      `instant mobile comprehension, and honest payoff. Select only the strongest winner; do not output the alternatives. ` +
      `Reject any hook that merely labels the topic, sounds instructional, or could fit 100 unrelated videos. If numberCallout is used, ` +
      `return exactly ONE supporting line (it may contain 1-2 words). Use ≤4 words total. Write a sharp curiosity, ` +
      `danger, conflict, vivid mechanism, or payoff hook—not a mechanical ` +
      `summary and not the title restated. The hook and image must create a knowledge gap that earns the click honestly. ` +
      `Name the memorable story object or tension (for example "MONEY MACHINE"), not filler such as "EXACT MATH", ` +
      `"HOW IT WORKS", "THE TRUTH", "EXPLAINED", or "REVEALED". ` +
      `Every line must contain real English hook copy, never meta-words like "omit"/"none". ` +
      `numberCallout: use a REAL number only when it strengthens the hook, preserving every material currency sign and ` +
      `time unit (for example "$1K/MO", never bare "1000"); otherwise leave the key out. Set "position" to textZone.\n` +
      `Return STRICT JSON {"heroProp":string,"background":string,"details":string[],"textPropsJson":string,"textZone":string,"layoutMode":"split"|"centered_hero"}.`,
  });

  let inst = await instantiate();
  // Score the SUBJECT, not the execution. Every other gate in this module
  // checks whether the candidate was rendered correctly; this one asks whether
  // the story was worth rendering at all, and buys one text-only retry rather
  // than a beautifully executed image of something boring.
  const plannedHeadline = (): string[] => {
    try {
      const parsed = JSON.parse(inst.textPropsJson ?? "{}") as Record<string, unknown>;
      const lines = (parsed["lines"] as { text?: string }[] | undefined) ?? [];
      return [
        ...(parsed["numberCallout"] ? [String(parsed["numberCallout"])] : []),
        ...lines.map((line) => String(line?.text ?? "")),
      ].filter(Boolean);
    } catch {
      return [];
    }
  };
  let storyInterest = scoreThumbnailStoryInterest({
    title: args.title,
    heroProp: inst.heroProp,
    headlineWords: plannedHeadline(),
    sceneSeed: args.sceneSeed,
  });
  if (storyInterest.verdict !== "compelling" && storyInterest.liftPrompts.length) {
    args.log?.(
      `thumbnailLab: story interest ${storyInterest.score}/100 (${storyInterest.verdict}) — ` +
      `${storyInterest.reasons.join("; ")}; re-planning the subject before paying for an image`,
    );
    storyLift = storyInterest.liftPrompts;
    const lifted = await instantiate();
    const liftedScore = scoreThumbnailStoryInterest({
      title: args.title,
      heroProp: lifted.heroProp,
      headlineWords: (() => {
        try {
          const parsed = JSON.parse(lifted.textPropsJson ?? "{}") as Record<string, unknown>;
          const lines = (parsed["lines"] as { text?: string }[] | undefined) ?? [];
          return [
            ...(parsed["numberCallout"] ? [String(parsed["numberCallout"])] : []),
            ...lines.map((line) => String(line?.text ?? "")),
          ].filter(Boolean);
        } catch {
          return [];
        }
      })(),
      sceneSeed: args.sceneSeed,
    });
    // Only keep the replacement if it is actually a better subject — a retry
    // that scores worse must not overwrite a merely-weak original.
    if (liftedScore.score > storyInterest.score) {
      inst = lifted;
      storyInterest = liftedScore;
      args.log?.(`thumbnailLab: story interest lifted to ${liftedScore.score}/100 (${liftedScore.verdict})`);
    } else {
      args.log?.(
        `thumbnailLab: story re-plan scored ${liftedScore.score}/100, no better than ${storyInterest.score} — keeping the original concept`,
      );
    }
  }
  // STAGED COMPOSITION: hero prop -> background -> story details, assembled
  // deterministically so generators receive named layers, not a prose blob.
  if (inst.heroProp) {
    inst.fluxPrompt =
      `LAYOUT MODE: ${inst.layoutMode === "centered_hero" ? "centered hero at peak action; reserve asymmetric clean pockets around its silhouette for native typography" : "split composition; hero opposite the chosen type zone"}. ` +
      `HERO PROP (dominant, 30-50% of frame, cropped close): ${inst.heroProp}. ` +
      `BACKGROUND (separate supporting layer behind the hero - darker, simpler, depth): ${inst.background ?? "deep dark gradient"}. ` +
      `STORY DETAILS (symbolic, on/around the hero): ${(inst.details ?? []).join("; ") || "none"}.`;
  }
  if (!inst.fluxPrompt || !inst.textPropsJson) throw new Error("pattern instantiation incomplete (need heroProp or fluxPrompt + textPropsJson)");
  let textProps: Record<string, unknown>;
  try { textProps = JSON.parse(inst.textPropsJson) as Record<string, unknown>; } catch {
    throw new Error("pattern textPropsJson unparseable");
  }
  // The channel's VISUAL LANGUAGE is constant — it overrides whatever the
  // pattern template carried (patterns vary composition, never identity).
  const vl = args.playbook.visualLanguage ?? {};
  textProps = {
    ...textProps,
    ...(vl.font ? { font: vl.font } : {}),
    ...(vl.treatment ? { treatment: vl.treatment } : {}),
    ...(vl.baseColor ? { baseColor: vl.baseColor } : {}),
    ...(vl.accentColor ? { accentColor: vl.accentColor } : {}),
    ...(vl.badgeStyle ? { badgeStyle: vl.badgeStyle } : {}),
    ...(vl.uppercase !== undefined ? { uppercase: vl.uppercase } : {}),
  };

  // META-WORD GUARD (the "OMIT" class — template placeholders leaking as
  // literal text): strip junk lines deterministically; a numberCallout must
  // actually contain a digit; fall back to title hook words if all lines die.
  const META = /^(omit|none|n\/?a|tbd|null|placeholder|number|text|word)$/i;
  let cleanLines = (((textProps["lines"] as { text?: string; accent?: boolean }[] | undefined) ?? []))
    .filter((l): l is { text: string; accent?: boolean } => Boolean(l.text && l.text.trim().length > 0 && !META.test(l.text.trim()) && !/[<>{}]/.test(l.text)));
  if (!cleanLines.length) {
    const hook = args.title.split(/[\s:—-]+/).filter((w) => w.length > 2).slice(0, 2);
    cleanLines = [{ text: hook[0] ?? "WATCH", accent: false }, { text: hook[1] ?? "THIS", accent: true }];
    args.log?.(`thumbnailLab: all text lines were meta-junk — fell back to title hook words`);
  }
  textProps = { ...textProps, lines: cleanLines };
  if (textProps["numberCallout"] !== undefined && !/\d/.test(String(textProps["numberCallout"]))) {
    delete textProps["numberCallout"];
  }

  // Nano Banana Pro owns the complete non-LoFi composition, including native
  // typography. The compositor below remains only for explicit legacy/manual
  // callers that do not supply the native route.
  const numberCallout = textProps["numberCallout"]
    ? String(textProps["numberCallout"])
    : undefined;
  const payoffIdx = Math.max(cleanLines.findIndex((l) => l.accent), 0);
  const zones = new Set<ThumbnailTextZone>([
    "left", "right", "upperLeft", "upperRight", "center", "upperCenter",
  ]);
  const requestedZone = String(inst.textZone ?? textProps["position"] ?? "left") as ThumbnailTextZone;
  const zone = zones.has(requestedZone) ? requestedZone : "left";
  const overlayLines = [
    ...(numberCallout ? [{ text: numberCallout, accent: true, payoff: true }] : []),
    ...cleanLines.map((line, index) => ({
      text: line.text,
      accent: line.accent,
      payoff: !numberCallout && index === payoffIdx,
    })),
  ];
  if (args.generateDesignedThumbnail) {
    const channelName = args.channelName?.trim() || String(textProps["badge"] ?? "channel");
    const brief: ThumbBriefArgs = {
      channelName,
      imageStyle: vl.imageStyle,
      palette: [vl.baseColor, vl.accentColor].filter((color): color is string => Boolean(color)),
      accentColor: vl.accentColor,
      textObject: vl.textObject
        ?? (vl.treatment === "sticker" ? "grunge_sticker"
          : vl.treatment === "stamp" ? "stamp_ink"
            : vl.treatment === "neon" ? "neon_sign"
              : vl.treatment === "plate" ? "block_plate"
                : vl.font === "serif" ? "paint_smear"
                  : "movie_poster"),
      composition: vl.composition,
      scene: inst.fluxPrompt,
      lines: overlayLines,
      badge: channelName,
    };
    const expectWords = overlayLines.map((line) => line.text);
    const prompt =
      `${buildThumbBrief(brief)} ${identityDirection} USER-APPROVED GOLDEN CRAFT BAR: ${GOLDEN_THUMBNAIL_CRAFT_RULES.join(" ")} ` +
      `OWNER-SELECTED A/B PREFERENCES: ${OWNER_SELECTED_THUMBNAIL_PREFERENCE_RULES.join(" ")}`;
    const providerPath = join(args.tmpDir, `thumbnail_designed_${args.idx}.png`);
    await writeFile(providerPath, await args.generateDesignedThumbnail({ prompt, brief, expectWords }));
    // This normalization only scales provider pixels to the delivery contract;
    // Nano Banana Pro already owns every scene and typography pixel.
    await imageToJpeg(providerPath, args.outJpg, 1_280, 720);
    const zoneResolution = trustedThumbnailTextZoneResolution(zone);
    args.log?.(`thumbnailLab: candidate ${args.idx + 1} "${args.pattern.name}" rendered (Nano Banana Pro native design)`);
    return {
      path: args.outJpg,
      basePath: providerPath,
      baseSource: "generated",
      requestedTextZone: zone,
      resolvedTextZone: zone,
      zoneResolution,
      pattern: args.pattern.name,
      expectedWords: expectWords,
      concept: {
        heroProp: inst.heroProp?.trim() || null,
        background: inst.background?.trim() || null,
        details: (inst.details ?? []).map((detail) => detail.trim()).filter(Boolean),
        scenePrompt: inst.fluxPrompt,
      },
    };
  }
  const renderSpec: ThumbnailRenderSpec = {
    scene: {
      description: inst.fluxPrompt,
      imageStyle: vl.imageStyle,
      palette: [vl.baseColor, vl.accentColor].filter((color): color is string => Boolean(color)),
      accentColor: vl.accentColor,
      composition: (vl as { composition?: string }).composition,
      textZone: zone,
      visualAvoid: args.playbook.avoid,
      ...(identityContract || args.visualTreatment?.providerPromptRequirements?.length
        ? {
            requiredVisualDirectives: [
              ...(identityContract?.requiredSceneEvidence ?? []),
              ...(identityContract?.prohibitedVisualPatterns.map((item) => `Never show ${item}`) ?? []),
              ...(args.visualTreatment?.providerPromptRequirements ?? []),
            ],
          }
        : {}),
    },
    typography: {
      lines: overlayLines,
      subtitle: args.visualTreatment?.disclosureBadge ?? (String(textProps["badge"] ?? "") || undefined),
      baseColor: vl.baseColor,
      accentColor: vl.accentColor,
      badgePlacement: args.visualTreatment?.disclosureBadge ? "topRight" : "bottomRight",
      badgeStyle: args.visualTreatment?.disclosureBadge ? "pill" : vl.badgeStyle,
      font: vl.font ?? "sans",
      uppercase: textProps["uppercase"] !== false,
      treatment: vl.treatment,
      textObject: vl.textObject,
    },
  };
  const rendered = await renderThumbnail({
    spec: renderSpec,
    outJpg: args.outJpg,
    tmpDir: args.tmpDir,
    generateScene: args.generateScene,
  });
  args.log?.(
    `thumbnailLab: candidate ${args.idx + 1} "${args.pattern.name}" rendered ` +
    `(${rendered.baseSource} text-free scene + deterministic type)`,
  );
  return {
    ...rendered,
    pattern: args.pattern.name,
    expectedWords: overlayLines.map((line) => line.text),
    renderSpec,
    concept: {
      heroProp: inst.heroProp?.trim() || null,
      background: inst.background?.trim() || null,
      details: (inst.details ?? []).map((detail) => detail.trim()).filter(Boolean),
      scenePrompt: inst.fluxPrompt,
    },
  };
}
/** Comparative feed judgment: candidates vs the verified real winners. */
export async function judgeTournament(args: {
  candidates: { path: string; pattern: string }[];
  refs: VerifiedRef[];
  title: string;
  tmpDir: string;
  /** Bypass the verdict cache for deliberate blind A/B regression trials. */
  noCache?: boolean;
  /** Final admission is limited to a two-candidate comparison. */
  tier?: VisionTier;
  log?: Logger;
}): Promise<TournamentResult> {
  const n = args.candidates.length;
  const refPaths = args.refs.slice(0, 4).map((r) => r.path);
  // Judge at FEED size — the size the click decision actually happens at.
  const smalls: string[] = [];
  for (let i = 0; i < n; i++) {
    smalls.push(await imageToJpeg(args.candidates[i].path, join(args.tmpDir, `cand_${i}_small.jpg`), 480, 270));
  }
  const referenceContext = refPaths.length > 0
    ? ` Images ${n + 1}-${n + refPaths.length} are REAL thumbnails of the highest-view videos in this niche ` +
      `(the competition in the same feed).`
    : " There are no reference images in this blind A/B comparison.";
  const raw = await visionLocal({
    prompt:
      `FEED SIMULATION. Images 1-${n} are CANDIDATE thumbnails for the video "${args.title}". ` +
      `${referenceContext}\n` +
      `Judge the candidates blind: do not infer an owner preference or reward image order. ` +
      `For each candidate: clickScore 1-10 (would it WIN the click in this feed), beatsRefs = how many of the ` +
      `references it visually out-competes, strengths, and the ONE fix that would most raise its score. ` +
      `Apply this user-approved golden craft bar:\n- ${GOLDEN_THUMBNAIL_CRAFT_RULES.join("\n- ")}\n` +
      `Apply these cross-video traits extracted from explicit owner A/B selections:\n- ` +
      `${OWNER_SELECTED_THUMBNAIL_PREFERENCE_RULES.join("\n- ")}\n` +
      `Judge composition, instant readability, hook compression, peak-action emotion, cause-and-consequence ` +
      `story proof, eye path, headline impact, color authority, mobile legibility, and premium feel. ` +
      `Be harsh — 8+ means it genuinely belongs among the winners.\n` +
      `Return STRICT JSON {"candidates":[{"idx":1-based,"clickScore":1-10,"beatsRefs":number,"strengths":string,"fix":string}],` +
      `"winner":1-based,"why":string}.`,
    imagePaths: [...smalls, ...refPaths],
    json: true,
    maxTokens: 1800,
    noCache: args.noCache,
    tier: args.tier,
  });
  const parsed = parseJsonLoose<{
    candidates?: { idx?: number; clickScore?: number; beatsRefs?: number; strengths?: string; fix?: string }[];
    winner?: number;
    why?: string;
  }>(raw);
  const out: TournamentCandidate[] = args.candidates.map((c, i) => {
    const v = (parsed.candidates ?? []).find((x) => (x.idx ?? 0) - 1 === i);
    return {
      path: c.path,
      pattern: c.pattern,
      clickScore: v?.clickScore,
      beatsRefs: v?.beatsRefs,
      notes: [v?.strengths, v?.fix ? `FIX: ${v.fix}` : ""].filter(Boolean).join(" | "),
    };
  });
  const winnerIdx = Math.min(n - 1, Math.max(0, (parsed.winner ?? 1) - 1));
  args.log?.(
    `thumbnailLab: tournament — ${out.map((c, i) => `#${i + 1} ${c.pattern}: ${c.clickScore ?? "?"}/10 (beats ${c.beatsRefs ?? "?"} refs)`).join("; ")} → winner #${winnerIdx + 1}`,
  );
  return { candidates: out, winnerIdx, judgeWhy: parsed.why ?? "" };
}
