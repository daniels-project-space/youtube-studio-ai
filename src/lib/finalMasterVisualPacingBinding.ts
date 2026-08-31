/**
 * Immutable binding for the deterministic final-master visual-pacing receipt.
 *
 * This records a narrow fact: the exact FFmpeg scene-marker measurement that
 * passed the lane's pacing policy for the released bytes. It is deliberately
 * not a claim that a particular cut count is aesthetically good, and does not
 * replace the evidence-backed visual reviewer for calibrated lanes.
 */
import { z } from "zod";

import { ContentLaneKeySchema, laneQualityPolicy } from "@/engine/contentLane";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { VisualPacingEvidenceSchema } from "@/lib/visualPacing";

export const FINAL_MASTER_VISUAL_PACING_BINDING_VERSION =
  "final-master-visual-pacing-binding/v1" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "expected SHA-256");
const finite = z.number().finite();
const contentLaneSchema = z.object({
  key: ContentLaneKeySchema,
  renderer: z.string().trim().min(1).max(160),
}).strict();
const finalMasterSchema = z.object({
  sha256,
  durationSec: finite.positive(),
}).strict();
const visualReviewSchema = z.object({
  reviewFingerprint: z.string().trim().min(1).max(256),
  reviewReceiptVersion: z.string().trim().min(1).max(128),
  reviewReceiptFingerprint: sha256,
  releaseReceiptFingerprint: sha256,
}).strict();
const qualityEvidenceSchema = z.object({
  bindingFingerprint: sha256,
  qualityEvidenceFingerprint: sha256,
}).strict();

export const FinalMasterVisualPacingBindingSchema = z.object({
  version: z.literal(FINAL_MASTER_VISUAL_PACING_BINDING_VERSION),
  finalMaster: finalMasterSchema,
  contentLane: contentLaneSchema,
  visualReview: visualReviewSchema,
  qualityEvidence: qualityEvidenceSchema,
  visualPacing: VisualPacingEvidenceSchema,
  bindingFingerprint: sha256,
}).strict();

export type FinalMasterVisualPacingBinding = z.infer<typeof FinalMasterVisualPacingBindingSchema>;
export type FinalMasterVisualPacingBindingInput = Omit<
  FinalMasterVisualPacingBinding,
  "version" | "bindingFingerprint"
>;

export function finalMasterVisualPacingBindingFingerprint(
  value: Omit<FinalMasterVisualPacingBinding, "bindingFingerprint">,
): string {
  return sha256Hex(canonicalJson(value));
}

function assertIntrinsicBinding(value: FinalMasterVisualPacingBinding): FinalMasterVisualPacingBinding {
  const { bindingFingerprint, ...unsigned } = value;
  if (bindingFingerprint !== finalMasterVisualPacingBindingFingerprint(unsigned)) {
    throw new Error("final-master visual-pacing binding fingerprint does not match its payload");
  }
  const policy = laneQualityPolicy(value.contentLane.key).visualPacing;
  if (canonicalJson(value.visualPacing.policy) !== canonicalJson(policy)) {
    throw new Error("final-master visual-pacing receipt does not use the released lane policy");
  }
  if (Math.abs(value.visualPacing.durationSec - value.finalMaster.durationSec) > 0.01) {
    throw new Error("final-master visual-pacing receipt duration does not match the released master");
  }
  if (!value.visualPacing.ran || !value.visualPacing.usable) {
    throw new Error("final-master visual-pacing receipt is incomplete");
  }
  if (value.visualPacing.changeCount !== value.visualPacing.changeTimestampsSec.length) {
    throw new Error("final-master visual-pacing receipt change count does not match its retained markers");
  }
  if (policy.mode === "exempt") {
    if (value.visualPacing.enforced || value.visualPacing.verdict !== "not_required") {
      throw new Error("exempt visual-pacing lane must retain an explicit not-required receipt");
    }
  } else {
    const maxMarkerHoldSec = policy.maxMarkerHoldSec;
    const observedMaxHoldSec = Math.max(
      ...value.visualPacing.evaluatedHoldIntervals.map((interval) => interval.durationSec),
      0,
    );
    if (
      !value.visualPacing.enforced ||
      value.visualPacing.verdict !== "pass" ||
      value.visualPacing.meetsPolicy !== true ||
      maxMarkerHoldSec === null ||
      Math.abs(value.visualPacing.maxHoldSec - observedMaxHoldSec) > 0.01 ||
      value.visualPacing.maxHoldSec > maxMarkerHoldSec + 0.3
    ) {
      throw new Error("released non-exempt lane requires a passing final-master visual-pacing receipt");
    }
  }
  return value;
}

export function createFinalMasterVisualPacingBinding(
  input: FinalMasterVisualPacingBindingInput,
): FinalMasterVisualPacingBinding {
  const unsigned = FinalMasterVisualPacingBindingSchema
    .omit({ version: true, bindingFingerprint: true })
    .parse(input);
  return assertIntrinsicBinding(FinalMasterVisualPacingBindingSchema.parse({
    version: FINAL_MASTER_VISUAL_PACING_BINDING_VERSION,
    ...unsigned,
    bindingFingerprint: finalMasterVisualPacingBindingFingerprint({
      version: FINAL_MASTER_VISUAL_PACING_BINDING_VERSION,
      ...unsigned,
    }),
  }));
}

/** Revalidates the compact release-certificate binding against its companions. */
export function assertFinalMasterVisualPacingBinding(args: {
  binding: unknown;
  finalMaster: { sha256: string; durationSec: number };
  visualReview: z.infer<typeof visualReviewSchema>;
  qualityEvidence: z.infer<typeof qualityEvidenceSchema>;
}): FinalMasterVisualPacingBinding {
  const binding = assertIntrinsicBinding(FinalMasterVisualPacingBindingSchema.parse(args.binding));
  if (
    binding.finalMaster.sha256 !== args.finalMaster.sha256 ||
    Math.abs(binding.finalMaster.durationSec - args.finalMaster.durationSec) > 0.01
  ) {
    throw new Error("final-master visual-pacing binding belongs to a different released master");
  }
  if (canonicalJson(binding.visualReview) !== canonicalJson(args.visualReview)) {
    throw new Error("final-master visual-pacing binding does not match the release visual-review receipt");
  }
  if (canonicalJson(binding.qualityEvidence) !== canonicalJson(args.qualityEvidence)) {
    throw new Error("final-master visual-pacing binding does not match the final-master quality evidence");
  }
  return binding;
}
