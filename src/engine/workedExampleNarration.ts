/** A held arithmetic-to-script adapter, not an editorial or pronunciation approval. */
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";
import { z } from "zod";
import type { Script } from "@/lib/scriptGen";
import { assertWorkedExamplePreparation } from "./workedExample";

export const WORKED_EXAMPLE_NARRATION_VERSION = "worked-example-narration/en-v1" as const;
type WorkedExampleScript = Script & {
  workedExampleNarrationVersion: typeof WORKED_EXAMPLE_NARRATION_VERSION;
  workedExamplePreparationFingerprint: string;
};

export const WorkedExampleEditorialApprovalSchema = z.object({
  version: z.literal("worked-example-editorial-approval/v1"),
  preparationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  scriptFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/** Integrity binding only: the existing independent critic owns creating this artifact. */
export function workedExampleEditorialApprovalFor(script: WorkedExampleScript) {
  return {
    version: "worked-example-editorial-approval/v1" as const,
    preparationFingerprint: script.workedExamplePreparationFingerprint,
    scriptFingerprint: sha256Hex(canonicalJson(script)),
  };
}

export function assertWorkedExampleEditorialApproval(value: unknown, script: WorkedExampleScript | undefined): void {
  if (!script && value === undefined) return;
  if (!script) throw new Error("worked example editorial approval has no current bound script");
  const approval = WorkedExampleEditorialApprovalSchema.safeParse(value);
  if (!approval.success || canonicalJson(approval.data) !== canonicalJson(workedExampleEditorialApprovalFor(script))) {
    throw new Error("worked example editorial approval does not match the current script; independent review required before paid narration");
  }
}

/** Reuse the verifier's exact speech; do not ask a model to copy or re-solve equations. */
export function draftWorkedExampleNarration(preparation: unknown, request: unknown): {
  script: WorkedExampleScript; narrationText: string;
} {
  const verified = assertWorkedExamplePreparation(preparation, request);
  const { projection } = verified;
  const sections: Script["sections"] = [
    ...projection.steps.map((step, index) => ({
      heading: `Step ${index + 1}`, narration: step.speech, role: "body" as const,
    })),
    { heading: "Answer", narration: projection.answerSpeech, role: "outro" },
  ];
  const narrationText = [projection.problemSpeech, ...sections.map((section) => section.narration)].join("\n\n");
  return {
    narrationText,
    script: {
      workedExampleNarrationVersion: WORKED_EXAMPLE_NARRATION_VERSION,
      workedExamplePreparationFingerprint: verified.fingerprint,
      hook: projection.problemSpeech, sections, narrationText,
      // Planning estimate only. Existing TTS/assembly must supply measured duration.
      estDurationSec: Math.ceil(narrationText.split(/\s+/).length / 2.5),
    },
  };
}

/** Optional only for ordinary scripts. Any arithmetic marker requires the whole binding. */
export function assertWorkedExampleNarrationBinding(args: {
  request: unknown; preparation: unknown; script: unknown; narrationText: unknown;
  ownerId: string; channelId: string; runId: string;
}): WorkedExampleScript | undefined {
  const script = args.script && typeof args.script === "object" ? args.script : {};
  const marked = Object.hasOwn(script, "workedExamplePreparationFingerprint") || Object.hasOwn(script, "workedExampleNarrationVersion");
  if (args.request === undefined && args.preparation === undefined && !marked) return;
  const verified = assertWorkedExamplePreparation(args.preparation, args.request);
  if (verified.request.ownerId !== args.ownerId || verified.request.channelId !== args.channelId || verified.request.runId !== args.runId) {
    throw new Error("worked example narration namespace does not match the active caller");
  }
  const expected = draftWorkedExampleNarration(verified, args.request);
  if (args.narrationText !== expected.narrationText) throw new Error("worked example narration differs from the verified derivation");
  if (canonicalJson(args.script) !== canonicalJson(expected.script)) throw new Error("worked example script differs from the verified derivation");
  return expected.script;
}
