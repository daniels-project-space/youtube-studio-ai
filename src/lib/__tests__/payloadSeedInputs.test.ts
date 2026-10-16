/**
 * AN OPERATOR PACKET WITH NO DELIVERY PATH.
 *
 * `editorial_evidence_packet` existed with a block, a module contract, an
 * artifact schema and its own unit tests. It reads `editorialEvidencePacketInput`
 * from the store. Nothing produced that key, and `RunPipelineInput` had no field
 * for it — so outside its tests the block could only ever call
 * assertEditorialEvidencePacket(undefined) and throw.
 *
 * What makes it worth a test rather than a one-line fix is HOW it survived.
 * familyPipelineConnectivity.test listed the key in PAYLOAD_SEEDS under the
 * comment "the exact `*Input` fields runPipeline accepts", so the check whose
 * whole job is catching unreachable inputs was seeding the very key that had no
 * way to arrive. A hand-copied list turned a gap into a certification.
 *
 * The list now lives in one place and both sides read it. The compile-time
 * assertion below is the part that cannot rot: adding a key to
 * PAYLOAD_SEED_INPUT_KEYS without adding the matching RunPipelineInput field
 * fails typecheck, so the two cannot drift again.
 */
import assert from "node:assert/strict";

import {
  PAYLOAD_SEED_INPUT_KEYS,
  payloadSeedInputs,
  type PayloadSeedInputKey,
} from "@/lib/payloadSeedInputs";
import type { RunPipelineInput } from "@/trigger/runPipeline";

/* ------------- the guard that makes this permanent, not just fixed --------- */

// If a key is added to the list without a matching payload field, this stops
// being assignable and typecheck fails. `import type` is erased, so nothing from
// the Trigger task is loaded at runtime.
type EveryKeyIsAcceptedByRunPipeline =
  PayloadSeedInputKey extends keyof RunPipelineInput ? true : never;
const _acceptedByRunPipeline: EveryKeyIsAcceptedByRunPipeline = true;
void _acceptedByRunPipeline;

// A caller-supplied value cannot stand in for authored cinematic direction or
// the human editor's signature; those artifacts need a separate authority path.
type HumanReviewCannotBePayloadSeed = Extract<
  keyof RunPipelineInput,
  "cinematicCaseDirection" | "cinematicSequenceEditorialReview"
> extends never ? true : never;
const _humanReviewCannotBePayloadSeed: HumanReviewCannotBePayloadSeed = true;
void _humanReviewCannotBePayloadSeed;

/* ------------------------------ the seeding ------------------------------- */

assert.deepEqual(
  payloadSeedInputs({}),
  {},
  "a payload carrying no operator packet seeds nothing",
);

const packet = { claims: [{ id: "c1" }], sources: [{ id: "s1" }] };
const seeded = payloadSeedInputs({ editorialEvidencePacketInput: packet });
assert.deepEqual(
  Object.keys(seeded),
  ["editorialEvidencePacketInput"],
  "the packet that had no delivery path now reaches the store",
);

const chessSource = {
  id: "source-opening-game",
  label: "Opening study",
  locator: "https://example.test/chess/opening-game",
  rightsNote: "Operator-supplied study source",
  pgn: "1. e4 e5",
  expectedPlyCount: 2,
  expectedFinalFen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
};
const seededChess = payloadSeedInputs({ chessReplaySource: chessSource });
assert.deepEqual(
  Object.keys(seededChess),
  ["chessReplaySource"],
  "the production chess source block can receive its strict source packet from RunPipelineInput",
);
chessSource.pgn = "mutated after dispatch";
assert.equal(
  (seededChess["chessReplaySource"] as typeof chessSource).pgn,
  "1. e4 e5",
  "the source packet is frozen into the invocation snapshot before later caller mutations",
);

// Frozen, not referenced: a caller mutating its object after dispatch must not
// reach a snapshot that has already been sealed.
(packet.claims as { id: string }[]).push({ id: "c2" });
assert.equal(
  (seeded["editorialEvidencePacketInput"] as typeof packet).claims.length,
  1,
  "the seeded packet is a structured clone, so a later mutation cannot reach it",
);

// An explicit undefined is absence, not a value to seed.
assert.deepEqual(
  payloadSeedInputs({ childrenShowBibleInput: undefined }),
  {},
  "an absent packet is not seeded as undefined",
);

const all = payloadSeedInputs(
  Object.fromEntries(PAYLOAD_SEED_INPUT_KEYS.map((key) => [key, { key }])) as Record<
    PayloadSeedInputKey,
    unknown
  >,
);
assert.deepEqual(
  Object.keys(all).sort(),
  [...PAYLOAD_SEED_INPUT_KEYS].sort(),
  "every declared key is actually seeded — a list entry that is never read would be the same defect again",
);

console.log(
  `PAYLOAD SEED INPUTS PASS — ${PAYLOAD_SEED_INPUT_KEYS.length} operator packets, each accepted by ` +
  "RunPipelineInput at compile time and seeded by one shared implementation",
);
