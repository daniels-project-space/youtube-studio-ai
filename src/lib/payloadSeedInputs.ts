/**
 * The operator-authored packets a run may carry on its payload.
 *
 * These are the store keys that no block produces and that arrive instead on
 * `RunPipelineInput`, frozen into the invocation snapshot before any provider
 * work so a retry cannot regenerate them from newer settings.
 *
 * WHY THIS IS ONE LIST IN ONE FILE
 *
 * It used to be written out three times — the payload field, the seeding
 * spread in runPipeline, and PAYLOAD_SEEDS in familyPipelineConnectivity.test —
 * and the three had already drifted. The test's list was documented as "the
 * exact `*Input` fields runPipeline accepts" and named FOUR, while runPipeline
 * accepted three: `editorialEvidencePacketInput` was in the test and nowhere
 * else. So the connectivity check certified as reachable an input that had no
 * delivery path at all, which is the precise failure that check exists to
 * catch.
 *
 * Nothing here is a capability grant. Each key is still validated by its own
 * admission function inside its block — assertEditorialEvidencePacket,
 * assertCurriculumEpisodeSeed and their kin are the trust boundary. This list
 * only says which keys may be CARRIED.
 *
 * DELIBERATELY ABSENT: `cinematicCaseDirection` and
 * `cinematicSequenceEditorialReview`. Both are read by
 * cinematic_case_sequence_draft/_finalize and neither has any delivery path, so
 * those two blocks cannot currently run outside their tests. They are not added
 * here because the second is a human editor's SIGNATURE on a crime-recreation
 * draft: giving a caller a payload field that supplies one is an authorization
 * decision, not a wiring fix. scripts/audit-unproducible-consumes.ts keeps both
 * visible until an owner decides how a real signature should arrive.
 */
export const PAYLOAD_SEED_INPUT_KEYS = [
  "childrenShowBibleInput",
  "curriculumEpisodeSeedInput",
  "casefileSourcePacketInput",
  "editorialEvidencePacketInput",
] as const;

export type PayloadSeedInputKey = (typeof PAYLOAD_SEED_INPUT_KEYS)[number];

/**
 * The subset of a payload that should be frozen into the invocation snapshot.
 *
 * Structured-cloned so a later mutation of the caller's object cannot reach a
 * snapshot that has already been sealed.
 */
export function payloadSeedInputs(
  payload: Partial<Record<PayloadSeedInputKey, unknown>>,
): Record<string, unknown> {
  const seeded: Record<string, unknown> = {};
  for (const key of PAYLOAD_SEED_INPUT_KEYS) {
    if (payload[key] !== undefined) seeded[key] = structuredClone(payload[key]);
  }
  return seeded;
}
