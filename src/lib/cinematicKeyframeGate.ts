import { z } from "zod";
import {
  assertCinematicKeyframeReview,
  CINEMATIC_KEYFRAME_MIN_SCORE,
  CINEMATIC_KEYFRAME_REVIEW_VERSION,
  type CinematicKeyframeReview,
} from "@/engine/cinematicKeyframeReview";
import { VISION_GATE_MAX_TOKENS, visionLocal } from "@/lib/vision";

const ReviewerVerdictSchema = z.object({
  semanticAlignment: z.number().finite().min(0).max(1),
  composition: z.number().finite().min(0).max(1),
  continuity: z.number().finite().min(0).max(1),
  artifactFree: z.number().finite().min(0).max(1),
  textWatermarkFree: z.boolean(),
  /**
   * Dedicated, code-enforced field for the identifiable-likeness prohibition
   * — mirroring textWatermarkFree above. Every gate prompt already tells the
   * reviewer to reject real-person likeness, but folded only into the single
   * omnibus `pass` boolean that also covers dozens of unrelated criteria
   * (frozen action, wrong lighting, broken anatomy, ...) that signal is not
   * independently auditable in code. This gives the single most safety-
   * critical rejection reason its own explicit, programmatically-checked
   * verdict field, exactly like watermark/text already has.
   */
  noIdentifiableLikeness: z.boolean(),
  pass: z.boolean(),
  notes: z.array(z.string().trim().min(1).max(280)).max(8).default([]),
}).strict();

export interface CinematicKeyframeGateScene {
  id: string;
  imagePrompt: string;
  motionPrompt: string;
  continuityIds?: readonly string[];
  keyframeRequirements?: readonly string[];
}

/**
 * The only reviewer failure that may spend the one admitted replacement still.
 * Transport, provider, and malformed-response failures must remain terminal:
 * they do not establish that a visual repair would fix the candidate.
 */
export class CinematicKeyframeRejectedError extends Error {
  constructor(sceneId: string, notes: readonly string[]) {
    super(
      `cinematic keyframe gate failed ${sceneId}: ` +
        (notes.join("; ") || "reviewer rejected the candidate"),
    );
    this.name = "CinematicKeyframeRejectedError";
  }
}

function parseVerdict(raw: string): z.infer<typeof ReviewerVerdictSchema> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("cinematic keyframe gate: reviewer returned no JSON object");
  }
  try {
    return ReviewerVerdictSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch (error) {
    throw new Error(`cinematic keyframe gate: malformed reviewer verdict (${error instanceof Error ? error.message : String(error)})`);
  }
}

/**
 * Independent quality gate for the source still before it is allowed to spend
 * on LTX. Previous accepted keyframes of the same cast are evidence only; the
 * final image is always the candidate being graded.
 */
export async function reviewCinematicKeyframe(args: {
  scene: CinematicKeyframeGateScene;
  candidatePath: string;
  referencePaths: readonly string[];
  reviewedAgainstSceneIds: readonly string[];
}): Promise<CinematicKeyframeReview> {
  const references = args.referencePaths.slice(0, 2);
  const raw = await visionLocal({
    prompt: [
      "You are the independent final keyframe gate for a source-bound cinematic documentary. Never infer success from the prompt; inspect the supplied pixels.",
      references.length
        ? `The first ${references.length} image(s) are already accepted reference stills of the same faceless mannequin cast. Do not score them. The final image is the candidate.`
        : "The single supplied image is the candidate first frame; no prior same-cast reference is available.",
      `Required image: ${args.scene.imagePrompt}`,
      `Required LTX motion: ${args.scene.motionPrompt}`,
      args.scene.continuityIds?.length
        ? `Locked anonymous mannequin cast IDs: ${args.scene.continuityIds.join(", ")}. Preserve faceless identity, wardrobe silhouette/material/palette, key prop, and body proportions when they are visible.`
        : "No recurring cast is visible; judge the stated environment and evidence treatment instead.",
      args.scene.keyframeRequirements?.length
        ? `Specific obligations: ${args.scene.keyframeRequirements.join(" | ")}`
        : "Specific obligations: coherent cinematic composition, correct camera scale, no unsupported factual visual claim.",
      "Reject real-person likeness, visible faces for mannequin treatments, gore, text/letters/logos/watermarks, duplicate limbs, broken anatomy/geometry, incompatible lighting, or generic imagery that misses the causal shot purpose.",
      `Return STRICT JSON only: {"semanticAlignment":0..1,"composition":0..1,"continuity":0..1,"artifactFree":0..1,"textWatermarkFree":true|false,"noIdentifiableLikeness":true|false,"pass":true|false,"notes":["concrete visual observation"]}. Set noIdentifiableLikeness to false if the candidate shows any identifiable human face or real-person likeness rather than a strictly anonymous faceless mannequin treatment, even a partial or plausible one. Set pass true only when every score is at least ${CINEMATIC_KEYFRAME_MIN_SCORE}, textWatermarkFree is true, noIdentifiableLikeness is true, and the image is suitable as LTX's first frame.`,
    ].join("\n"),
    imagePaths: [...references, args.candidatePath],
    json: true,
    maxTokens: VISION_GATE_MAX_TOKENS,
    noCache: true,
    // This receipt is labelled non-Google and is an admission prerequisite for
    // paid LTX work. Scope the provider chain rather than merely naming it.
    providers: ["openrouter"], tier: "final",
  });
  const verdict = parseVerdict(raw);
  const failingScores = [
    verdict.semanticAlignment,
    verdict.composition,
    verdict.continuity,
    verdict.artifactFree,
  ].some((score) => score < CINEMATIC_KEYFRAME_MIN_SCORE);
  if (!verdict.pass || !verdict.textWatermarkFree || !verdict.noIdentifiableLikeness || failingScores) {
    throw new CinematicKeyframeRejectedError(args.scene.id, verdict.notes);
  }
  const review = assertCinematicKeyframeReview({
    version: CINEMATIC_KEYFRAME_REVIEW_VERSION,
    reviewer: "non_google_vision",
    sceneId: args.scene.id,
    reviewedAgainstSceneIds: [...args.reviewedAgainstSceneIds],
    semanticAlignment: verdict.semanticAlignment,
    composition: verdict.composition,
    continuity: verdict.continuity,
    artifactFree: verdict.artifactFree,
    textWatermarkFree: verdict.textWatermarkFree,
    pass: true,
    notes: verdict.notes,
  }, {
    sceneId: args.scene.id,
    reviewedAgainstSceneIds: args.reviewedAgainstSceneIds,
  });
  return review;
}
