import assert from "node:assert/strict";

import {
  CHILD_EDITORIAL_REVIEW_MAX_AGE_DAYS,
  CHILDREN_SHOW_BIBLE_VERSION,
  assertChildrenShowBible,
  childrenShowBibleContentFingerprint,
  evaluateChildrenShowBible,
  type ChildrenShowBibleInput,
} from "@/engine/childrenShowBible";
import {
  CURRICULUM_EPISODE_SEED_VERSION,
  assertCurriculumEpisodeSeed,
  curriculumEpisodeSeedContentFingerprint,
  type CurriculumEpisodeSeedInput,
} from "@/engine/curriculumEpisodeSeed";
import { buildEpisodeGraph, compileSceneManifest, episodeGraphFingerprint } from "@/engine/episodeGraph";
import { contentLaneForFamily } from "@/engine/contentLane";
import { buildLearningContract } from "@/engine/learningContract";
import { assertChildContentSafety } from "@/trigger/blocks/childrenSafetyBlocks";
import { childrenShowBibleBlocks } from "../childrenShowBibleBlocks";

const NOW = new Date();
const lane = contentLaneForFamily("children_learning");
assert(lane);

const objective = "Sort red, blue, and yellow blocks by color.";
const graph = buildEpisodeGraph({
  seriesId: "series-color-corner",
  episodeId: "episode-color-sort",
  topic: "Sorting blocks by color",
  audience: "children" as const,
  durationSec: 30,
  sources: [
    {
      id: "source-curriculum-color",
      kind: "curriculum" as const,
      label: "Early learning color sorting curriculum",
      locator: "curriculum://early-learning/color-sorting",
    },
    {
      id: "source-script-color",
      kind: "script" as const,
      label: "Approved Color Corner episode script",
      locator: "script://color-corner/sort-colors/v1",
    },
  ],
  characterIds: ["character-tavi"],
  settingIds: ["setting-color-corner"],
  characters: [
    {
      id: "character-tavi",
      displayName: "Tavi",
      continuityLock: "Tavi wears a teal apron with three round color patches and carries a small felt sorting tray.",
    },
  ],
  settings: [
    {
      id: "setting-color-corner",
      displayName: "Color Corner Workshop",
      continuityLock: "A sunlit round workshop with felt shelves, a blue sorting mat, and no logos or branded objects.",
    },
  ],
  beats: [
    {
      id: "beat-color-problem",
      kind: "problem" as const,
      t0: 0,
      t1: 6,
      claim: "The mixed blocks need kind color homes.",
      learningObjective: objective,
      scenePurpose: "Present a familiar problem: the color blocks are mixed together.",
      sourceRefs: ["source-script-color", "source-curriculum-color"],
      characterIds: ["character-tavi"],
      settingId: "setting-color-corner",
      text: "Tavi finds red, blue, and yellow blocks all mixed together on the sorting mat.",
      camera: { framing: "medium" as const, move: "push" as const },
      visualState: { action: "Tavi gently spreads the mixed blocks into a clear row.", props: ["red block", "blue block", "yellow block"] },
      transition: "cut" as const,
      storySpineBeatIds: ["beat-color-problem"],
      storySpineSentenceIds: ["sentence-color-problem"],
    },
    {
      id: "beat-color-guide",
      kind: "experiment" as const,
      t0: 6,
      t1: 12,
      claim: "One block can be matched to its color home at a time.",
      learningObjective: objective,
      scenePurpose: "Guide the first calm sorting attempt.",
      sourceRefs: ["source-script-color", "source-curriculum-color"],
      characterIds: ["character-tavi"],
      settingId: "setting-color-corner",
      text: "Tavi tries one red block first and places it beside the red felt circle.",
      camera: { framing: "close" as const, move: "static" as const },
      visualState: { action: "Tavi matches one red block to the red felt circle.", props: ["red block", "red felt circle"] },
      transition: "match_cut" as const,
      storySpineBeatIds: ["beat-color-guide"],
      storySpineSentenceIds: ["sentence-color-guide"],
    },
    {
      id: "beat-color-repeat",
      kind: "observation" as const,
      t0: 12,
      t1: 18,
      claim: "The same color-matching idea works with different blocks and actions.",
      learningObjective: objective,
      scenePurpose: "Repeat the matching idea with varied color and movement cues.",
      sourceRefs: ["source-script-color", "source-curriculum-color"],
      characterIds: ["character-tavi"],
      settingId: "setting-color-corner",
      text: "Tavi slides a blue block to blue, then taps a yellow block beside yellow.",
      camera: { framing: "wide" as const, move: "track" as const },
      visualState: { action: "Tavi changes the block and action while keeping the same color match rule.", props: ["blue block", "yellow block"] },
      transition: "match_cut" as const,
      storySpineBeatIds: ["beat-color-repeat"],
      storySpineSentenceIds: ["sentence-color-repeat"],
    },
    {
      id: "beat-color-participate",
      kind: "choice" as const,
      t0: 18,
      t1: 24,
      claim: "A learner can choose where a colored block belongs.",
      learningObjective: objective,
      scenePurpose: "Invite the viewer to point or sort with Tavi.",
      sourceRefs: ["source-script-color", "source-curriculum-color"],
      characterIds: ["character-tavi"],
      settingId: "setting-color-corner",
      text: "Tavi pauses with a blue block and invites the viewer to point to its color home.",
      camera: { framing: "medium" as const, move: "push" as const },
      visualState: { action: "Tavi holds the blue block still and leaves a gentle participation pause.", props: ["blue block", "blue felt circle"] },
      transition: "cut" as const,
      storySpineBeatIds: ["beat-color-participate"],
      storySpineSentenceIds: ["sentence-color-participate"],
    },
    {
      id: "beat-color-recall",
      kind: "resolution" as const,
      t0: 24,
      t1: 30,
      claim: "Blocks can be sorted by matching each color to its color home.",
      learningObjective: objective,
      scenePurpose: "Resolve the familiar problem and recall the sorting rule.",
      sourceRefs: ["source-script-color", "source-curriculum-color"],
      characterIds: ["character-tavi"],
      settingId: "setting-color-corner",
      text: "The blocks are sorted, and Tavi asks what color home each block needs.",
      camera: { framing: "wide" as const, move: "static" as const },
      visualState: { action: "Tavi smiles beside the three sorted color homes for a calm recall moment.", props: ["red block", "blue block", "yellow block"] },
      transition: "dissolve" as const,
      storySpineBeatIds: ["beat-color-recall"],
      storySpineSentenceIds: ["sentence-color-recall"],
    },
  ],
  causalEdges: [
    {
      id: "edge-color-1-2",
      fromBeatId: "beat-color-problem",
      toBeatId: "beat-color-guide",
      relation: "teaches" as const,
      rationale: "The mixed blocks lead to a guided first matching attempt.",
      sourceRefs: ["source-curriculum-color"],
    },
    {
      id: "edge-color-2-3",
      fromBeatId: "beat-color-guide",
      toBeatId: "beat-color-repeat",
      relation: "teaches" as const,
      rationale: "The first match leads to varied repetition with other blocks.",
      sourceRefs: ["source-curriculum-color"],
    },
    {
      id: "edge-color-3-4",
      fromBeatId: "beat-color-repeat",
      toBeatId: "beat-color-participate",
      relation: "teaches" as const,
      rationale: "Varied matching leads to an opportunity for the viewer to choose.",
      sourceRefs: ["source-curriculum-color"],
    },
    {
      id: "edge-color-4-5",
      fromBeatId: "beat-color-participate",
      toBeatId: "beat-color-recall",
      relation: "resolves" as const,
      rationale: "The participation pause leads to a resolved sorting rule and recall.",
      sourceRefs: ["source-curriculum-color"],
    },
  ],
});

const lessonContract = buildLearningContract(graph, lane);

const sourcePacket: ChildrenShowBibleInput = {
  version: CHILDREN_SHOW_BIBLE_VERSION,
  seriesId: graph.seriesId,
  ageBand: { label: "preschool", minimumYears: 3, maximumYears: 5 },
  learningObjective: {
    id: "objective-color-sort",
    statement: lessonContract.learningObjective,
    observableAction: "Sort each colored block into the matching color home.",
    assessment: {
      responseMode: "point",
      requiredCorrectResponses: 2,
      prompt: "Can you point to the red and blue color homes?",
    },
  },
  identity: {
    seriesTitle: "Color Corner Friends",
    world: {
      settingId: "setting-color-corner",
      displayName: "Color Corner Workshop",
      continuityLock: "A sunlit round workshop with felt shelves, a blue sorting mat, and no logos or branded objects.",
      originalIdentity: "A quiet felt workshop where color rules become small cooperative discoveries.",
    },
    recurringCharacters: [
      {
        characterId: "character-tavi",
        displayName: "Tavi",
        continuityLock: "Tavi wears a teal apron with three round color patches and carries a small felt sorting tray.",
        role: "guide",
        plannedEpisodeMinimum: 12,
        originalIdentity: "A patient neighborhood maker who turns ordinary sorting and noticing into calm play.",
      },
    ],
    originalityDeclaration: {
      createdForThisSeries: true,
      noBorrowedOrIpAdjacentIdentity: true,
      differentiation: "The series uses tactile felt rules, gentle pauses, and a workshop routine authored for Color Corner Friends.",
    },
  },
  storyPattern: [
    {
      kind: "familiar_problem",
      summary: "The color blocks are mixed together on Tavi’s familiar sorting mat.",
      episodeBeatIds: ["beat-color-problem"],
    },
    {
      kind: "guided_attempt",
      summary: "Tavi calmly models one red-block match.",
      episodeBeatIds: ["beat-color-guide"],
    },
    {
      kind: "varied_repetition",
      summary: "The same matching rule changes color and movement cues.",
      episodeBeatIds: ["beat-color-repeat"],
      variationDimensions: ["object", "action"],
    },
    {
      kind: "participation",
      summary: "The viewer is invited to point to a matching color home.",
      episodeBeatIds: ["beat-color-participate"],
      participationPrompt: "Can you point to the red and blue color homes?",
    },
    {
      kind: "resolution_recall",
      summary: "The blocks are sorted and the matching rule is recalled.",
      episodeBeatIds: ["beat-color-recall"],
      recallPrompt: lessonContract.retrievalPractice.prompt,
    },
  ],
  editorialReview: {
    id: "child-editor-review-color-sort-001",
    decision: "approved",
    reviewerId: "child-editor-curriculum-desk",
    reviewedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
    reviewedShowBibleFingerprint: "0".repeat(64),
    reviewedEpisodeGraphFingerprint: episodeGraphFingerprint(graph),
    reviewedLessonContractFingerprint: lessonContract.fingerprint,
    ageBandConfirmed: true,
    learningObjectiveConfirmed: true,
    originalIdentityConfirmed: true,
    storyPatternConfirmed: true,
  },
};

sourcePacket.editorialReview.reviewedShowBibleFingerprint = childrenShowBibleContentFingerprint(sourcePacket);

const curriculumEpisodeSeedInput: CurriculumEpisodeSeedInput = {
  version: CURRICULUM_EPISODE_SEED_VERSION,
  seriesId: graph.seriesId,
  episodeId: graph.episodeId,
  episodeTopic: graph.topic,
  ageBand: sourcePacket.ageBand,
  measurableObjective: {
    id: sourcePacket.learningObjective.id,
    statement: sourcePacket.learningObjective.statement,
    observableAction: sourcePacket.learningObjective.observableAction,
  },
  vocabularyAndActions: [
    { term: "sort", childFriendlyMeaning: "Put things that belong together in the same gentle group.", requiredAction: "Move each block to its matching color home." },
    { term: "match", childFriendlyMeaning: "Find the color that is the same.", requiredAction: "Point to or place a block by its same-color felt circle." },
  ],
  assessment: sourcePacket.learningObjective.assessment,
  identity: sourcePacket.identity,
  editorialReview: {
    id: "child-editor-review-curriculum-color-sort-001",
    decision: "approved",
    reviewerId: "child-editor-curriculum-desk",
    reviewedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
    reviewedCurriculumEpisodeSeedFingerprint: "0".repeat(64),
    ageBandConfirmed: true,
    measurableObjectiveConfirmed: true,
    vocabularyAndActionsConfirmed: true,
    assessmentConfirmed: true,
    originalIdentityConfirmed: true,
  },
};
curriculumEpisodeSeedInput.editorialReview.reviewedCurriculumEpisodeSeedFingerprint =
  curriculumEpisodeSeedContentFingerprint(curriculumEpisodeSeedInput);
const admittedCurriculumEpisodeSeed = assertCurriculumEpisodeSeed({
  input: curriculumEpisodeSeedInput,
  contentLane: lane,
}, { now: NOW });

function showBibleArgs(input: unknown, episodeGraph = graph, currentLessonContract = lessonContract) {
  return {
    input,
    curriculumEpisodeSeed: admittedCurriculumEpisodeSeed.seed,
    curriculumEpisodeSeedApproval: admittedCurriculumEpisodeSeed.receipt,
    episodeGraph,
    lessonContract: currentLessonContract,
    contentLane: lane,
  };
}

async function main(): Promise<void> {
  const report = evaluateChildrenShowBible(showBibleArgs(sourcePacket), { now: NOW });
  assert.equal(report.safe, true, JSON.stringify(report.issues));

  const admitted = assertChildrenShowBible(showBibleArgs(sourcePacket), { now: NOW });
  assert.equal(admitted.bible.contentFingerprint, childrenShowBibleContentFingerprint(sourcePacket));
  assert.equal(admitted.receipt.showBibleFingerprint, childrenShowBibleContentFingerprint(sourcePacket));
  assert.equal(admitted.receipt.episodeGraphFingerprint, episodeGraphFingerprint(graph));
  assert.equal(admitted.receipt.release, "private_human_child_editor_review_only");
  assert.equal(admitted.receipt.allowedPublishMode, "draft");
  assert.equal(admitted.receipt.requiresHumanChildEditor, true);
  const childSafety = assertChildContentSafety({
    episodeGraph: graph,
    sceneManifest: compileSceneManifest(graph),
    lessonContract,
    contentLane: lane,
    childrenShowBible: admitted.bible,
    childrenShowBibleApproval: admitted.receipt,
    curriculumEpisodeSeed: admittedCurriculumEpisodeSeed.seed,
    curriculumEpisodeSeedApproval: admittedCurriculumEpisodeSeed.receipt,
  });
  assert.equal(childSafety.allowedPublishMode, "draft");
  assert.equal(childSafety.childrenShowBibleFingerprint, admitted.bible.contentFingerprint);

  // The manifest fingerprint deliberately equals the graph fingerprint for
  // idempotency. It must not be treated as proof that scene content was not
  // changed after child-editor review.
  const postReviewEditedManifest = structuredClone(compileSceneManifest(graph));
  postReviewEditedManifest.scenes[0].text =
    "Tavi quietly arranges the blocks in a row without explaining the color-sorting problem.";
  assert.throws(
    () => assertChildContentSafety({
      episodeGraph: graph,
      sceneManifest: postReviewEditedManifest,
      lessonContract,
      contentLane: lane,
      childrenShowBible: admitted.bible,
      childrenShowBibleApproval: admitted.receipt,
      curriculumEpisodeSeed: admittedCurriculumEpisodeSeed.seed,
      curriculumEpisodeSeedApproval: admittedCurriculumEpisodeSeed.receipt,
    }),
    /does not exactly match the reviewed Episode Graph/,
  );

  const logs: string[] = [];
  const patch = await childrenShowBibleBlocks[0].run({
    ownerId: "owner-test",
    runId: "run-children-show-bible",
    channelId: "channel-test",
    keyPrefix: "owner/owner-test/channel/channel-test/",
    params: {},
    store: {
      childrenShowBibleInput: sourcePacket,
      curriculumEpisodeSeed: admittedCurriculumEpisodeSeed.seed,
      curriculumEpisodeSeedApproval: admittedCurriculumEpisodeSeed.receipt,
      episodeGraph: graph,
      lessonContract,
      contentLane: lane,
    },
    budgetUsd: 0,
    log: (message) => logs.push(message),
  });
  assert.equal(
    (patch.childrenShowBibleApproval as { release: string }).release,
    "private_human_child_editor_review_only",
  );
  assert.match(logs.join("\n"), /provider calls: 0/);

  const missingAgeBand = structuredClone(sourcePacket) as Record<string, unknown>;
  delete missingAgeBand.ageBand;
  assert.throws(
    () => assertChildrenShowBible(showBibleArgs(missingAgeBand), { now: NOW }),
    /age_band_missing:.*Remediation:/,
  );

  const borrowedIdentity = structuredClone(sourcePacket);
  borrowedIdentity.identity.originalityDeclaration.differentiation = "A Pokémon-inspired color town.";
  assert.throws(
    () => assertChildrenShowBible(showBibleArgs(borrowedIdentity), { now: NOW }),
    /identity_ip_adjacent:.*Remediation:/,
  );

  const missingVariation = structuredClone(sourcePacket);
  delete missingVariation.storyPattern[2].variationDimensions;
  assert.throws(
    () => assertChildrenShowBible(showBibleArgs(missingVariation), { now: NOW }),
    /story_pattern_semantics_invalid:.*Varied repetition/,
  );

  const changedBible = structuredClone(sourcePacket);
  changedBible.storyPattern[0].kind = "guided_attempt";
  assert.throws(
    () => assertChildrenShowBible(showBibleArgs(changedBible), { now: NOW }),
    /story_pattern_invalid:.*Remediation:/,
  );

  const mismatchedApproval = structuredClone(sourcePacket);
  mismatchedApproval.editorialReview.reviewedShowBibleFingerprint = "f".repeat(64);
  assert.throws(
    () => assertChildrenShowBible(showBibleArgs(mismatchedApproval), { now: NOW }),
    /editorial_review_bible_mismatch:.*Remediation:/,
  );

  const changedGraph = structuredClone(graph);
  changedGraph.beats[0].text = "Tavi finds the red, blue, and yellow blocks mixed on the mat.";
  const changedLessonContract = buildLearningContract(changedGraph, lane);
  assert.throws(
    () => assertChildrenShowBible(showBibleArgs(sourcePacket, changedGraph, changedLessonContract), { now: NOW }),
    /editorial_review_graph_mismatch:.*Remediation:/,
  );

  const staleApproval = structuredClone(sourcePacket);
  staleApproval.editorialReview.reviewedAt = new Date(
    NOW.getTime() - (CHILD_EDITORIAL_REVIEW_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1_000,
  ).toISOString();
  assert.throws(
    () => assertChildrenShowBible(showBibleArgs(staleApproval), { now: NOW }),
    /editorial_review_stale:.*Remediation:/,
  );

  console.log("children show bible admission tests passed");
}

void main();
