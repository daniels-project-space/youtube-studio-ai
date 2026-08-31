import { z } from "zod";

import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const NARRATIVE_SHORT_ORIGIN_VERSION = "narrative-short-origin/v1" as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sourceWindow = z.object({
  t0: z.number().finite().nonnegative(),
  t1: z.number().finite().positive(),
}).strict().refine((value) => value.t1 > value.t0, "narrative Short source window must be positive");

const NarrativeShortOriginContentSchema = z.object({
  version: z.literal(NARRATIVE_SHORT_ORIGIN_VERSION),
  parentFinalMasterSha256: sha256,
  parentFinalMasterCertificateFingerprint: sha256,
  seriesPlanFingerprint: sha256,
  episodeGraphFingerprint: sha256,
  episodeBindingFingerprint: sha256,
  shortsExpansionPlanFingerprint: sha256,
  candidateId: z.string().regex(/^short-candidate-[0-9]+$/u),
  parentBeatId: z.string().regex(/^beat-[a-z0-9-]+$/u),
  sourceWindow,
}).strict();

export const NarrativeShortOriginSchema = NarrativeShortOriginContentSchema.extend({
  fingerprint: sha256,
}).strict().superRefine((value, issue) => {
  const { fingerprint: actual, ...content } = value;
  if (actual !== sha256Hex(canonicalJson(NarrativeShortOriginContentSchema.parse(content)))) {
    issue.addIssue({ code: z.ZodIssueCode.custom, message: "narrative Short origin fingerprint is invalid" });
  }
});

export type NarrativeShortOrigin = z.infer<typeof NarrativeShortOriginSchema>;

export function createNarrativeShortOrigin(
  input: z.input<typeof NarrativeShortOriginContentSchema>,
): NarrativeShortOrigin {
  const content = NarrativeShortOriginContentSchema.parse(input);
  return Object.freeze(NarrativeShortOriginSchema.parse({
    ...content,
    fingerprint: sha256Hex(canonicalJson(content)),
  }));
}

export function assertNarrativeShortOrigin(value: unknown): NarrativeShortOrigin {
  return Object.freeze(NarrativeShortOriginSchema.parse(value));
}
