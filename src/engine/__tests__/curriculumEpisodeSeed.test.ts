import assert from "node:assert/strict";

import {
  CURRICULUM_EPISODE_SEED_VERSION,
  assertCurriculumEpisodeSeed,
  assertCurriculumEpisodeSeedForStoryInput,
  assertCurriculumEpisodeSeeded,
  curriculumEpisodeSeedContentFingerprint,
  type CurriculumEpisodeSeedInput,
} from "@/engine/curriculumEpisodeSeed";
import { contentLaneForFamily } from "@/engine/contentLane";
import { curriculumEpisodeSeedBlocks } from "@/trigger/blocks/curriculumEpisodeSeedBlocks";

const NOW = new Date("2026-08-16T12:00:00.000Z");
const lane = contentLaneForFamily("children_learning");
assert(lane);

const input: CurriculumEpisodeSeedInput = {
  version: CURRICULUM_EPISODE_SEED_VERSION,
  seriesId: "series-spark-garden",
  episodeId: "episode-seed-sort",
  episodeTopic: "Sorting garden seeds by shape",
  ageBand: { label: "preschool", minimumYears: 3, maximumYears: 5 },
  measurableObjective: {
    id: "objective-seed-sort",
    statement: "Sort round and long garden seeds by shape.",
    observableAction: "Place each seed card on its matching shape mat.",
  },
  vocabularyAndActions: [
    { term: "round", childFriendlyMeaning: "Like a tiny circle.", requiredAction: "Point to a round seed card." },
    { term: "long", childFriendlyMeaning: "Long from one end to the other.", requiredAction: "Place a long seed card on the long mat." },
  ],
  assessment: { responseMode: "sort", requiredCorrectResponses: 2, prompt: "Can you sort one round seed and one long seed?" },
  identity: {
    seriesTitle: "Spark Garden Friends",
    world: {
      settingId: "setting-spark-garden",
      displayName: "Spark Garden Shed",
      continuityLock: "A small sunlit garden shed with hand-painted seed mats and no brand marks.",
      originalIdentity: "A calm neighborhood garden where small noticing games help plants begin.",
    },
    recurringCharacters: [{
      characterId: "character-mira",
      displayName: "Mira",
      continuityLock: "Mira wears a moss-green apron with a round wooden seed tray.",
      role: "guide",
      plannedEpisodeMinimum: 8,
      originalIdentity: "A gentle garden helper who uses slow observation games instead of magical fixes.",
    }],
    originalityDeclaration: {
      createdForThisSeries: true,
      noBorrowedOrIpAdjacentIdentity: true,
      differentiation: "The series uses tactile garden experiments, patient pauses, and seed-sorting rituals authored for this original world.",
    },
  },
  editorialReview: {
    id: "child-editor-review-seed-sort-001",
    decision: "approved",
    reviewerId: "child-editor-garden-desk",
    reviewedAt: "2026-08-15T12:00:00.000Z",
    reviewedCurriculumEpisodeSeedFingerprint: "0".repeat(64),
    ageBandConfirmed: true,
    measurableObjectiveConfirmed: true,
    vocabularyAndActionsConfirmed: true,
    assessmentConfirmed: true,
    originalIdentityConfirmed: true,
  },
};
input.editorialReview.reviewedCurriculumEpisodeSeedFingerprint = curriculumEpisodeSeedContentFingerprint(input);

async function main(): Promise<void> {
  const admitted = assertCurriculumEpisodeSeed({ input, contentLane: lane }, { now: NOW });
  assert.equal(admitted.seed.release, "private_human_child_editor_review_only");
  assert.equal(admitted.receipt.allowedPublishMode, "draft");
  assertCurriculumEpisodeSeedForStoryInput({
    curriculumEpisodeSeed: admitted.seed,
    curriculumEpisodeSeedApproval: admitted.receipt,
    contentLane: lane,
    topic: input.episodeTopic,
  });
  assert.throws(
    () => assertCurriculumEpisodeSeedForStoryInput({
      curriculumEpisodeSeed: admitted.seed,
      curriculumEpisodeSeedApproval: admitted.receipt,
      contentLane: lane,
      topic: "A different episode",
    }),
    /selected topic does not match/,
  );
  assert.throws(() => assertCurriculumEpisodeSeeded(lane, {}), /curriculumEpisodeSeedInput/);

  const patch = await curriculumEpisodeSeedBlocks[0].run({
    ownerId: "owner-test",
    runId: "run-curriculum-seed",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: { curriculumEpisodeSeedInput: input, contentLane: lane },
    budgetUsd: 0,
    log: () => undefined,
  });
  assert.equal(
    (patch.curriculumEpisodeSeedApproval as { release: string }).release,
    "private_human_child_editor_review_only",
  );
  console.log("curriculum episode seed tests passed");
}

void main();
