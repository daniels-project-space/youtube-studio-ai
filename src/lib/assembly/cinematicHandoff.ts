/**
 * Cinematic assembly handoff — the narrow, lossless boundary between reviewed
 * LTX footage and an exact clip-order assembler.
 *
 * This deliberately does NOT enable the generic Assembly EDL renderer for a
 * cinematic master. `assertCinematicAssemblyRoute` still keeps that unproven
 * path closed. It packages the already-admitted scene plan, edit decisions,
 * and renderer receipt into one durable object a parity-proven assembler can
 * consume without guessing, resorting, or cycling clips.
 */
import { z } from "zod";

import {
  CinematicCutReasonSchema,
  CinematicEditDecisionListSchema,
  CinematicTensionStateSchema,
} from "@/engine/cinematicCaseSequence";
import { assertCinematicSequenceRenderBinding } from "@/engine/cinematicSequenceRenderBinding";
import { SourceProofMediaReceiptSchema } from "@/engine/sourceProofMedia";

export const CINEMATIC_ASSEMBLY_HANDOFF_VERSION = "cinematic-assembly-handoff/v1" as const;

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/, "expected sha256 fingerprint");
const shotId = z.string().regex(/^cinematic-shot-[a-z0-9-]+$/, "expected cinematic shot id");
const TIMING_TOLERANCE_SEC = 0.03;

/**
 * One immutable editor decision bound to the actual clip returned by LTX.
 * `sequenceIndex` is intentional: consumers must not sort by id, timestamp,
 * R2 key, or filesystem order and accidentally change the reviewed edit.
 */
export const CinematicShotToClipSchema = z.object({
  sequenceIndex: z.number().int().nonnegative(),
  shotId,
  clipKey: z.string().trim().min(1),
  t0: z.number().finite().nonnegative(),
  t1: z.number().finite().positive(),
  continuitySeed: z.number().int().min(1).max(2_147_483_647),
  cutReason: CinematicCutReasonSchema,
  tensionState: CinematicTensionStateSchema,
  narrationPurpose: z.string().trim().min(1).max(360),
  /** Exact approved evidence clip receipt when this is a real source insert. */
  sourceProofMediaReceipt: SourceProofMediaReceiptSchema.optional(),
}).strict().refine((item) => item.t1 > item.t0, "cinematic clip t1 must follow t0");
export type CinematicShotToClip = z.infer<typeof CinematicShotToClipSchema>;

/**
 * The sequence-indexed clip manifest that crosses into assembly. It is not a
 * generic footage pool: `exactOrder: true` means every item is a required,
 * reviewed cut and any missing/reordered binding is a hard failure.
 */
export const CinematicShotToClipManifestSchema = z.object({
  version: z.literal(CINEMATIC_ASSEMBLY_HANDOFF_VERSION),
  source: z.literal("cinematic_case_sequence"),
  sequenceFingerprint: fingerprint,
  exactOrder: z.literal(true),
  durationSec: z.number().finite().positive(),
  items: z.array(CinematicShotToClipSchema).min(2).max(2_000),
}).strict().superRefine((manifest, ctx) => {
  const ids = new Set<string>();
  let cursor = 0;
  manifest.items.forEach((item, index) => {
    if (item.sequenceIndex !== index) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "sequenceIndex"],
        message: "sequenceIndex must be contiguous and preserve the reviewed shot order",
      });
    }
    if (ids.has(item.shotId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index, "shotId"], message: "cinematic shot ids must be unique" });
    }
    ids.add(item.shotId);
    if (item.sourceProofMediaReceipt && (
      item.sourceProofMediaReceipt.sceneId !== item.shotId ||
      item.sourceProofMediaReceipt.sequenceFingerprint !== manifest.sequenceFingerprint ||
      item.sourceProofMediaReceipt.clipKey !== item.clipKey
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "sourceProofMediaReceipt"],
        message: "source-proof receipt must bind this exact cinematic shot, sequence, and assembled clip key",
      });
    }
    if (Math.abs(item.t0 - cursor) > TIMING_TOLERANCE_SEC) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "t0"],
        message: "cinematic clips must be contiguous in their reviewed order",
      });
    }
    cursor = item.t1;
  });
  if (Math.abs(cursor - manifest.durationSec) > TIMING_TOLERANCE_SEC) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationSec"],
      message: "cinematic clip coverage must end at the reviewed sequence duration",
    });
  }
});
export type CinematicShotToClipManifest = z.infer<typeof CinematicShotToClipManifestSchema>;

/**
 * Durable handoff for the exact clip-order assembler. Keeping the source EDL
 * alongside its mapped clips means a resumed worker can re-assert every causal
 * decision before spending render compute.
 */
export const CinematicAssemblyHandoffSchema = z.object({
  version: z.literal(CINEMATIC_ASSEMBLY_HANDOFF_VERSION),
  manifest: CinematicShotToClipManifestSchema,
  editDecisionList: CinematicEditDecisionListSchema,
}).strict().superRefine((handoff, ctx) => {
  const { manifest, editDecisionList } = handoff;
  if (manifest.sequenceFingerprint !== editDecisionList.sequenceFingerprint) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sequenceFingerprint"], message: "clip manifest and EDL must bind the same sequence fingerprint" });
  }
  if (Math.abs(manifest.durationSec - editDecisionList.durationSec) > TIMING_TOLERANCE_SEC) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["durationSec"], message: "clip manifest and EDL must have the same reviewed duration" });
  }
  if (manifest.items.length !== editDecisionList.edits.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "every cinematic EDL decision requires exactly one rendered clip binding" });
  }
  manifest.items.forEach((clip, index) => {
    const edit = editDecisionList.edits[index];
    if (!edit || edit.shotId !== clip.shotId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["manifest", "items", index, "shotId"], message: "clip order must exactly equal the reviewed cinematic EDL order" });
      return;
    }
    if (
      Math.abs(edit.t0 - clip.t0) > TIMING_TOLERANCE_SEC ||
      Math.abs(edit.t1 - clip.t1) > TIMING_TOLERANCE_SEC ||
      edit.cutReason !== clip.cutReason ||
      edit.tensionState !== clip.tensionState ||
      edit.narrationPurpose !== clip.narrationPurpose
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["manifest", "items", index], message: "clip binding must retain the exact reviewed EDL timing and causal decision" });
    }
  });
});
export type CinematicAssemblyHandoff = z.infer<typeof CinematicAssemblyHandoffSchema>;

/**
 * Build the only admissible cinematic assembly input from the established
 * source-bound render binding. All three upstream artifacts are reparsed and
 * checked before this object is emitted, so an absent clip/review/binding fails
 * before assembly can start.
 */
export function createCinematicAssemblyHandoff(args: {
  scenePlan: unknown;
  editDecisionList: unknown;
  footageManifest: unknown;
  narrationDurationSec: number;
}): CinematicAssemblyHandoff {
  const binding = assertCinematicSequenceRenderBinding(args);
  const manifest = CinematicShotToClipManifestSchema.parse({
    version: CINEMATIC_ASSEMBLY_HANDOFF_VERSION,
    source: "cinematic_case_sequence",
    sequenceFingerprint: binding.scenePlan.sequenceFingerprint,
    exactOrder: true,
    durationSec: binding.scenePlan.durationSec,
    items: binding.scenePlan.scenes.map((scene, sequenceIndex) => {
      const edit = binding.editDecisionList.edits[sequenceIndex]!;
      const rendered = binding.footageManifest.items[sequenceIndex]!;
      return {
        sequenceIndex,
        shotId: scene.id,
        clipKey: rendered.clipKey,
        t0: scene.t0,
        t1: scene.t1,
        continuitySeed: scene.continuitySeed,
        cutReason: edit.cutReason,
        tensionState: edit.tensionState,
        narrationPurpose: edit.narrationPurpose,
        ...(rendered.sourceProofMediaReceipt
          ? { sourceProofMediaReceipt: rendered.sourceProofMediaReceipt }
          : {}),
      };
    }),
  });
  return CinematicAssemblyHandoffSchema.parse({
    version: CINEMATIC_ASSEMBLY_HANDOFF_VERSION,
    manifest,
    editDecisionList: binding.editDecisionList,
  });
}

/** Parse a persisted handoff before a resumed exact-order assembly job uses it. */
export function assertCinematicAssemblyHandoff(value: unknown): CinematicAssemblyHandoff {
  return CinematicAssemblyHandoffSchema.parse(value);
}
