import { NOVITA_CINEMATIC_QA_REPAIR_CAP } from "./pricing";
import { VISUAL_MATTER_MAX_REFERENCE_ASSETS_PER_SHOT } from "./visualMatter";

/** The vision provider admits at most this many images in one QA request. */
export const NOVITA_VISUAL_QA_MAX_IMAGES_PER_GRADER_CALL = 5;

/** ShotPlan and generation profiles deliberately cap one still set at four candidates. */
export const NOVITA_VISUAL_QA_MAX_INITIAL_IMAGE_CANDIDATES = 4;

/** Each video QA request compares the start, middle, and end render frames. */
export const NOVITA_VIDEO_QA_RENDERED_FRAMES_PER_GRADE = 3;

/** A continuous-shot endpoint may require one additional terminal-grade request. */
export const NOVITA_VIDEO_QA_TERMINAL_GRADES_PER_ATTEMPT = 1;

export function novitaVisualQaReferenceBatchCount(
  referenceAssetCount: number,
  nonReferenceImageCount: number,
): number {
  if (!Number.isInteger(referenceAssetCount) || referenceAssetCount < 0) {
    throw new Error("Novita visual QA reference asset count must be a nonnegative integer");
  }
  if (!Number.isInteger(nonReferenceImageCount) || nonReferenceImageCount < 1) {
    throw new Error("Novita visual QA evidence image count must be a positive integer");
  }
  const referenceCapacity = NOVITA_VISUAL_QA_MAX_IMAGES_PER_GRADER_CALL - nonReferenceImageCount;
  if (referenceCapacity < 1) {
    throw new Error("Novita visual QA evidence leaves no reference-image capacity");
  }
  // QA always makes one grade even when a shot has no Visual Matter anchors.
  return Math.max(1, Math.ceil(referenceAssetCount / referenceCapacity));
}

/**
 * Upper bound for all mandatory grader calls for one shot, including every
 * reference batch and every allowed targeted repair. This mirrors the actual
 * qa_assets / qa_shots batching; it is a reservation calculation only and
 * never changes the evidence supplied to the grader.
 */
export function novitaCinematicQaMaxGraderCallsPerShot(
  phase: "image" | "video",
): number {
  const references = VISUAL_MATTER_MAX_REFERENCE_ASSETS_PER_SHOT;
  if (phase === "image") {
    const initial = novitaVisualQaReferenceBatchCount(
      references,
      NOVITA_VISUAL_QA_MAX_INITIAL_IMAGE_CANDIDATES,
    );
    const repair = novitaVisualQaReferenceBatchCount(references, 1);
    return initial + NOVITA_CINEMATIC_QA_REPAIR_CAP * repair;
  }
  const visualGrade = novitaVisualQaReferenceBatchCount(
    references,
    NOVITA_VIDEO_QA_RENDERED_FRAMES_PER_GRADE,
  );
  return (NOVITA_CINEMATIC_QA_REPAIR_CAP + 1) * (
    visualGrade + NOVITA_VIDEO_QA_TERMINAL_GRADES_PER_ATTEMPT
  );
}
