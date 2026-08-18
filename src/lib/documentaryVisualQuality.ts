/**
 * Deterministic editorial-direction gate for documentary and Short plans.
 *
 * A vision reviewer still judges final pixels. This contract exists earlier in
 * the pipeline so a generic plate, a single camera drift, or a wall of type
 * never gets expensive provider/render work merely because it is technically
 * valid JSON.
 */

export type DocumentaryVisualQualityGrade = "good" | "decent" | "slop";
export type DocumentaryCoverageRole = "establish" | "hero" | "proof" | "detail";
export type DocumentaryTypographyMode = "headline" | "annotation" | "minimal";

export interface DocumentaryVisualProof {
  /** Short instruction both compositor and visual reviewer can use. */
  id: string;
  mustShow: string;
  /** Every term must appear in an actual asset brief or source query. */
  requiredTerms: string[];
}

/** The coverage that stops one generated plate standing in for a whole beat. */
export interface DocumentaryEditorialCoverage {
  primarySubject: string;
  visualProof: string;
  roles: DocumentaryCoverageRole[];
}

/** A shot must progress: establish → new information → intentional exit. */
export interface DocumentaryMotionArc {
  establish: string;
  reveal: string;
  exit: string;
  purpose: string;
  /** The in-shot visual reset. At normal Short pacing this lands before 4s. */
  visualResetAtPercent: number;
}

/** Typography is supporting evidence, never a substitute for the visual. */
export interface DocumentaryTypographyPlan {
  mode: DocumentaryTypographyMode;
  purpose: "orient" | "identify" | "emphasize" | "land";
  maxWords: number;
}

export interface DocumentaryVisualQualityAsset {
  id?: string;
  brief?: string;
  query?: string;
  role?: string;
  storyRole?: DocumentaryCoverageRole;
}

export interface DocumentaryVisualQualityShot {
  narration: string;
  beat: string;
  kind?: string;
  scale?: "establishing" | "wide" | "medium" | "close";
  durationSec?: number;
  camera?: { move?: string; intensity?: string; revealMove?: string; revealAtPercent?: number };
  rackFocus?: "near_to_far" | "far_to_near";
  assets?: DocumentaryVisualQualityAsset[];
  visualCues?: string[];
  coverage?: DocumentaryEditorialCoverage;
  motionArc?: DocumentaryMotionArc;
  typography?: DocumentaryTypographyPlan;
  title?: string;
  labels?: Array<{ text?: string; sub?: string }>;
  annotations?: string[];
}

export interface DocumentaryVisualShotAssessment {
  shotIndex: number;
  proofs: DocumentaryVisualProof[];
  missingProofs: DocumentaryVisualProof[];
  coverageReady: boolean;
  motionReady: boolean;
  typographyReady: boolean;
  visualResetSec: number | null;
  reasons: string[];
}

export interface DocumentaryVisualQualityAssessment {
  grade: DocumentaryVisualQualityGrade;
  score: number;
  semanticScore: number;
  coverageScore: number;
  motionScore: number;
  storyScore: number;
  typographyScore: number;
  blockers: string[];
  reasons: string[];
  shots: DocumentaryVisualShotAssessment[];
}

const GENERIC_CUE_WORDS = new Set([
  "a", "an", "and", "at", "be", "by", "for", "from", "in", "into", "is", "it", "of", "on", "or", "the", "to", "with",
  "actual", "authored", "background", "cinematic", "clear", "collage", "documentary", "environment", "frame", "image", "line", "moment",
  "photo", "picture", "scene", "show", "shot", "text", "text-free", "visual", "what",
]);

const LAYERED_KINDS = new Set([
  "parallax_portrait", "depth_parallax", "photo_slide", "matte_sequence", "collage_pan", "evidence_board", "object_drop", "geo_map",
]);

const COVERAGE_RICH_KINDS = new Set(["parallax_portrait", "photo_slide", "matte_sequence", "collage_pan", "evidence_board", "object_drop"]);

function normalized(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function wordCount(value: string | undefined): number {
  return normalized(value).split(/\s+/).filter(Boolean).length;
}

function hasAllTerms(haystack: string, terms: readonly string[]): boolean {
  const words = new Set(normalized(haystack).split(/\s+/).filter(Boolean));
  const aliases: Record<string, readonly string[]> = {
    photograph: ["photograph", "photographs", "photo", "photos", "image", "images", "picture", "pictures"],
    greeting: ["greeting", "greetings", "hello", "hellos", "voice", "voices"],
  };
  return terms.every((term) => (aliases[term] ?? [normalized(term)]).some((candidate) => words.has(candidate)));
}

function uniqueProofs(proofs: DocumentaryVisualProof[]): DocumentaryVisualProof[] {
  const seen = new Set<string>();
  return proofs.filter((proof) => {
    const key = `${proof.mustShow}:${proof.requiredTerms.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cueTerms(cue: string): string[] {
  return normalized(cue)
    .split(/\s+/)
    .filter((word) => word.length > 2 && !GENERIC_CUE_WORDS.has(word))
    .slice(0, 4);
}

/**
 * Extracts proof objects from explicit cinematographer cues and from recurring
 * documentary phrases that have a well-defined literal visual counterpart.
 */
export function documentaryVisualProofsFor(
  narration: string,
  beat: string,
  visualCues: readonly string[] = [],
): DocumentaryVisualProof[] {
  const source = normalized(`${narration} ${beat}`);
  const proofs: DocumentaryVisualProof[] = [];
  const has = (...terms: string[]) => hasAllTerms(source, terms);
  const hasPhotoWord = /\b(image|images|photo|photos|photograph|photographs|picture|pictures)\b/.test(source);

  if (has("golden", "record")) proofs.push({ id: "golden-record", mustShow: "the Golden Record itself", requiredTerms: ["golden", "record"] });
  if (has("voyager")) proofs.push({ id: "voyager-spacecraft", mustShow: "the Voyager spacecraft", requiredTerms: ["voyager"] });
  if (hasPhotoWord && has("earth")) proofs.push({ id: "earth-photograph", mustShow: "a real photograph of Earth", requiredTerms: ["earth", "photograph"] });
  if (/\b115\b/.test(source) && /\b(images|pictures|photos|photographs)\b/.test(source)) proofs.push({ id: "image-collection", mustShow: "a visible collection of photographs", requiredTerms: ["photograph"] });
  if (/\b55\b/.test(source) && /\b(greeting|greetings|language|languages|hello|hellos)\b/.test(source)) proofs.push({ id: "greetings", mustShow: "a visible set of greetings or voice records", requiredTerms: ["greeting"] });
  if (has("map")) proofs.push({ id: "map", mustShow: "a map or route diagram", requiredTerms: ["map"] });
  if ((has("solar", "system") && /\b(beyond|outside|leaves|left|drift|drifts)\b/.test(source)) || has("interstellar")) {
    proofs.push({ id: "interstellar-journey", mustShow: "Voyager moving beyond the solar system", requiredTerms: ["voyager"] });
  }

  for (const cue of visualCues) {
    const terms = cueTerms(cue);
    if (terms.length) proofs.push({ id: `cue-${proofs.length + 1}`, mustShow: cue.trim(), requiredTerms: terms });
  }

  if (!proofs.length) {
    const fallback = cueTerms(beat || narration);
    if (fallback.length) proofs.push({ id: "literal-beat", mustShow: beat.trim() || narration.trim(), requiredTerms: fallback });
  }
  return uniqueProofs(proofs);
}

/** Ensures a plan always carries explicit reviewer-facing must-show cues. */
export function normalizeDocumentaryVisualCues(
  narration: string,
  beat: string,
  visualCues: readonly string[] | undefined,
): string[] {
  const existing = (visualCues ?? []).map((cue) => cue.trim()).filter(Boolean).slice(0, 4);
  const inferred = documentaryVisualProofsFor(narration, beat, existing).map((proof) => proof.mustShow);
  return [...new Set([...existing, ...inferred])].slice(0, 4);
}

export function editorialCoverageFor(
  narration: string,
  beat: string,
  kind?: string,
): DocumentaryEditorialCoverage {
  const proof = documentaryVisualProofsFor(narration, beat)[0]?.mustShow ?? (beat.trim() || narration.trim());
  const roles: DocumentaryCoverageRole[] = kind === "quote_card"
    ? ["proof"]
    : kind === "depth_parallax" || kind === "geo_map" || kind === "map_zoom"
      ? ["establish", "proof"]
      : ["establish", "hero", "proof", "detail"];
  return { primarySubject: cueTerms(beat || narration).slice(0, 4).join(" ") || "the narrated subject", visualProof: proof, roles };
}

export function editorialMotionArcFor(
  narration: string,
  beat: string,
  camera?: DocumentaryVisualQualityShot["camera"],
): DocumentaryMotionArc {
  const subject = cueTerms(beat || narration).slice(0, 4).join(" ") || "the visual proof";
  const revealMove = camera?.revealMove ?? (camera?.move === "push_in" ? "pan_right" : "push_in");
  const visualResetAtPercent = Math.min(0.62, Math.max(0.38, camera?.revealAtPercent ?? 0.52));
  return {
    establish: `Orient the viewer to ${subject}.`,
    reveal: `Reveal the decisive ${subject} with ${revealMove}.`,
    exit: "Create a clean handoff to the next factual beat.",
    purpose: "Camera movement reveals new information; it is not ambient drift.",
    visualResetAtPercent,
  };
}

export function editorialTypographyFor(
  kind?: string,
  hasTitle = false,
): DocumentaryTypographyPlan {
  return {
    mode: hasTitle ? "headline" : kind === "quote_card" ? "minimal" : "annotation",
    purpose: kind === "quote_card" ? "land" : hasTitle ? "emphasize" : "identify",
    maxWords: hasTitle ? 3 : 6,
  };
}

function assessShot(shot: DocumentaryVisualQualityShot, shotIndex: number): DocumentaryVisualShotAssessment {
  const proofs = documentaryVisualProofsFor(shot.narration, shot.beat, shot.visualCues ?? []);
  const assetText = (shot.assets ?? []).map((asset) => `${asset.brief ?? ""} ${asset.query ?? ""}`).join(" ");
  const usesDataMap = shot.kind === "geo_map" && normalized(shot.beat).includes("map");
  const missingProofs = proofs.filter((proof) => !usesDataMap && !hasAllTerms(assetText, proof.requiredTerms));
  const coverage = shot.coverage;
  const coverageRoles = new Set(coverage?.roles ?? []);
  const coverageReady = Boolean(
    coverage?.primarySubject.trim() && coverage.visualProof.trim() &&
    coverageRoles.has("proof") &&
    (shot.kind === "quote_card" || coverageRoles.size >= 2) &&
    (COVERAGE_RICH_KINDS.has(shot.kind ?? "") ? coverageRoles.size >= 3 : true),
  );
  const arc = shot.motionArc;
  const visualResetSec = typeof shot.durationSec === "number" && arc ? shot.durationSec * arc.visualResetAtPercent : null;
  const motionReady = Boolean(
    arc?.establish.trim() && arc.reveal.trim() && arc.exit.trim() && arc.purpose.trim() &&
    typeof arc.visualResetAtPercent === "number" && arc.visualResetAtPercent >= 0.28 && arc.visualResetAtPercent <= 0.66 &&
    (visualResetSec === null || visualResetSec <= 4.1),
  );
  const typography = shot.typography;
  const titleWords = wordCount(shot.title);
  const labelWords = (shot.labels ?? []).reduce((sum, label) => sum + wordCount(label.text) + wordCount(label.sub), 0);
  const typographyReady = Boolean(
    typography && typography.maxWords >= 1 && typography.maxWords <= 6 &&
    titleWords <= Math.max(3, typography.maxWords) && labelWords <= 12,
  );
  const reasons = [
    ...missingProofs.map((proof) => `must show ${proof.mustShow}, but no asset brief proves it`),
    ...(coverageReady ? [] : ["needs a named visual proof plus purposeful establish/hero/proof/detail coverage"]),
    ...(motionReady ? [] : ["needs an establish → reveal → exit motion arc with a visual reset before four seconds"]),
    ...(typographyReady ? [] : ["type treatment is missing or exceeds the restrained editorial copy budget"]),
  ];
  return { shotIndex, proofs, missingProofs, coverageReady, motionReady, typographyReady, visualResetSec, reasons };
}

/**
 * Grades a plan before pixels are generated. It scores the requirements that
 * distinguish a directed Short from a slowly moving generic template.
 */
export function assessDocumentaryVisualQuality(
  shots: readonly DocumentaryVisualQualityShot[],
): DocumentaryVisualQualityAssessment {
  const assessments = shots.map(assessShot);
  const totalProofs = assessments.reduce((sum, shot) => sum + shot.proofs.length, 0);
  const missingProofs = assessments.flatMap((shot) => shot.missingProofs.map((proof) => ({ shot, proof })));
  const semanticScore = totalProofs === 0 ? 0 : Math.round(34 * (totalProofs - missingProofs.length) / totalProofs);
  const coverageReady = assessments.filter((shot) => shot.coverageReady).length;
  const layeredShots = shots.filter((shot) => LAYERED_KINDS.has(shot.kind ?? "") || (shot.assets?.length ?? 0) >= 2).length;
  const coverageScore = Math.round(
    Math.min(12, (coverageReady / Math.max(1, shots.length)) * 12) +
    Math.min(8, (layeredShots / Math.max(1, shots.length)) * 8),
  );
  const moves = new Set(shots.map((shot) => shot.camera?.move).filter((move): move is string => Boolean(move && move !== "drift")));
  const strongMoves = shots.filter((shot) => shot.camera?.intensity === "medium" || shot.camera?.intensity === "strong").length;
  const motionReady = assessments.filter((shot) => shot.motionReady).length;
  const focusOrReveal = shots.filter((shot) => shot.rackFocus || shot.camera?.revealMove || ["evidence_board", "collage_pan", "matte_sequence"].includes(shot.kind ?? "")).length;
  const motionScore = Math.round(
    Math.min(8, (motionReady / Math.max(1, shots.length)) * 8) +
    Math.min(5, moves.size * 2.5) +
    Math.min(4, (strongMoves / Math.max(1, shots.length)) * 4) +
    Math.min(3, focusOrReveal * 1.5),
  );
  const distinctKinds = new Set(shots.map((shot) => shot.kind).filter(Boolean)).size;
  const distinctScales = new Set(shots.map((shot) => shot.scale).filter(Boolean)).size;
  const nonEmptyNarration = shots.filter((shot) => Boolean(shot.narration.trim() && shot.beat.trim())).length;
  const storyScore = Math.round(
    Math.min(8, (nonEmptyNarration / Math.max(1, shots.length)) * 8) +
    Math.min(5, distinctKinds * 1.5) +
    Math.min(3, distinctScales * 1.5),
  );
  const typographyReady = assessments.filter((shot) => shot.typographyReady).length;
  const titleShots = shots.filter((shot) => Boolean(shot.title?.trim())).length;
  const typographyScore = Math.round(
    Math.min(7, (typographyReady / Math.max(1, shots.length)) * 7) +
    Math.min(4, Math.max(0, 1 - Math.max(0, titleShots / Math.max(1, shots.length) - 0.65) * 4) * 4),
  );
  const score = Math.min(100, semanticScore + coverageScore + motionScore + storyScore + typographyScore);
  const blockers = [
    ...missingProofs.map(({ shot, proof }) => `shot ${shot.shotIndex + 1}: ${proof.mustShow}`),
    ...assessments.filter((shot) => !shot.coverageReady).map((shot) => `shot ${shot.shotIndex + 1}: incomplete visual coverage`),
    ...assessments.filter((shot) => !shot.motionReady).map((shot) => `shot ${shot.shotIndex + 1}: no purposeful visual reset`),
  ];
  const reasons = assessments.flatMap((shot) => shot.reasons.map((reason) => `Shot ${shot.shotIndex + 1}: ${reason}`));
  if (moves.size < 3) reasons.push("Camera plan has fewer than three motivated move types across the Short.");
  if (distinctKinds < 3) reasons.push("Shot plan has fewer than three visual grammars, so it risks feeling templated.");
  if (titleShots / Math.max(1, shots.length) > 0.65) reasons.push("Too many beats rely on a large headline instead of the imagery.");

  const grade: DocumentaryVisualQualityGrade = blockers.length || score < 74
    ? "slop"
    : score >= 86 && semanticScore >= 32 && coverageScore >= 17 && motionScore >= 16 && storyScore >= 13 && typographyScore >= 8
      ? "good"
      : "decent";
  return { grade, score, semanticScore, coverageScore, motionScore, storyScore, typographyScore, blockers, reasons, shots: assessments };
}
