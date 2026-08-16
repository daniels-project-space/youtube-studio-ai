/**
 * A deterministic safety/release boundary for child-directed originals.
 * It permits creation of a private review candidate, never autonomous public
 * release. The graph itself contains the full timed text and visual plan, so
 * the gate has no hidden model dependency.
 */
import {
  assertEpisodeGraph,
  assertSceneManifest,
  childSafeTextDefects,
  episodeGraphFingerprint,
  type EpisodeGraph,
  type SceneManifest,
} from "@/engine/episodeGraph";
import { assertLearningContract } from "@/engine/learningContract";
import {
  ChildrenShowBibleApprovalReceiptSchema,
  ChildrenShowBibleSchema,
} from "@/engine/childrenShowBible";
import {
  assertCurriculumEpisodeSeedMatchesShowBible,
  CurriculumEpisodeSeedApprovalReceiptSchema,
  CurriculumEpisodeSeedSchema,
} from "@/engine/curriculumEpisodeSeed";
import type { Block } from "@/engine/types";

export const CHILD_CONTENT_SAFETY_VERSION = "child-content-safety/v1" as const;

export interface ChildContentSafetyReceipt {
  version: typeof CHILD_CONTENT_SAFETY_VERSION;
  pass: true;
  madeForKids: true;
  audience: "children";
  release: "human-editorial-approval-required";
  allowedPublishMode: "draft";
  reviewReasons: string[];
  episodeGraphFingerprint: string;
  /** Binds the human-review receipt to the exact deterministic visual plan. */
  sceneManifestFingerprint: string;
  lessonContractFingerprint: string;
  /** The exact child-editor-approved original identity/curriculum packet. */
  childrenShowBibleFingerprint: string;
  /** The pre-Story-Spine child-editor-approved per-episode curriculum intent. */
  curriculumEpisodeSeedFingerprint: string;
}

/**
 * Final release-boundary evidence for a supervised children episode.
 *
 * A child-safety receipt reviews an Episode Graph and Scene Manifest before
 * rendering. The final master is only admissible when its renderer receipt
 * proves that it came from that same reviewed manifest. Keeping this pure and
 * renderer-receipt-shaped lets every future upload surface enforce the same
 * provenance rule without duplicating policy.
 */
export function assertChildContentRenderEvidence(args: {
  childSafety: unknown;
  sceneCompilerReceipt: unknown;
}): void {
  const childSafety = args.childSafety as Partial<ChildContentSafetyReceipt> | undefined;
  if (
    childSafety?.pass !== true ||
    childSafety.madeForKids !== true ||
    childSafety.release !== "human-editorial-approval-required" ||
    childSafety.allowedPublishMode !== "draft" ||
    typeof childSafety.sceneManifestFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/i.test(childSafety.sceneManifestFingerprint) ||
    typeof childSafety.childrenShowBibleFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/i.test(childSafety.childrenShowBibleFingerprint) ||
    typeof childSafety.curriculumEpisodeSeedFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/i.test(childSafety.curriculumEpisodeSeedFingerprint)
  ) {
    throw new Error("child_content_safety: invalid or unbound children safety receipt");
  }

  const render = args.sceneCompilerReceipt as {
    version?: unknown;
    renderer?: unknown;
    manifestFingerprint?: unknown;
    externalProviderCalls?: unknown;
    hasAudio?: unknown;
  } | undefined;
  if (
    render?.version !== "scene-compiler-render/v1" ||
    render.renderer !== "deterministic-scene/v1" ||
    render.externalProviderCalls !== 0 ||
    render.hasAudio !== true ||
    typeof render.manifestFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/i.test(render.manifestFingerprint)
  ) {
    throw new Error("child_content_safety: final master lacks an audited deterministic render receipt");
  }
  if (render.manifestFingerprint !== childSafety.sceneManifestFingerprint) {
    throw new Error("child_content_safety: final master was not rendered from the reviewed scene manifest");
  }
}

/** Pure gate so the policy is independently testable and reuseable by any renderer. */
export function assertChildContentSafety(args: {
  episodeGraph: unknown;
  sceneManifest: unknown;
  lessonContract: unknown;
  contentLane?: unknown;
  childrenShowBible?: unknown;
  childrenShowBibleApproval?: unknown;
  curriculumEpisodeSeed?: unknown;
  curriculumEpisodeSeedApproval?: unknown;
}): ChildContentSafetyReceipt {
  const graph = assertEpisodeGraph(args.episodeGraph) as EpisodeGraph;
  const manifest = assertSceneManifest(args.sceneManifest) as SceneManifest;
  if (graph.audience !== "children" || manifest.audience !== "children") {
    throw new Error("child_content_safety: graph and scene manifest must both declare children audience");
  }
  if (manifest.externalProviderCalls !== 0 || manifest.renderer !== "deterministic-scene/v1") {
    throw new Error("child_content_safety: only the audited deterministic scene renderer is admitted");
  }
  const lane = args.contentLane as { key?: unknown } | undefined;
  if (lane?.key !== "children_learning_supervised") {
    throw new Error("child_content_safety: the children-learning supervised lane is required");
  }
  if (manifest.fingerprint.length !== 64) {
    throw new Error("child_content_safety: scene manifest fingerprint is invalid");
  }
  const lessonContract = assertLearningContract(args.lessonContract, graph);
  if (args.childrenShowBible === undefined || args.childrenShowBibleApproval === undefined) {
    throw new Error("child_content_safety: a current child-editor-approved show bible is required");
  }
  const showBible = ChildrenShowBibleSchema.parse(args.childrenShowBible);
  const approval = ChildrenShowBibleApprovalReceiptSchema.parse(args.childrenShowBibleApproval);
  if (args.curriculumEpisodeSeed === undefined || args.curriculumEpisodeSeedApproval === undefined) {
    throw new Error("child_content_safety: a current child-editor-approved CurriculumEpisodeSeed is required");
  }
  const curriculumEpisodeSeed = CurriculumEpisodeSeedSchema.parse(args.curriculumEpisodeSeed);
  const curriculumApproval = CurriculumEpisodeSeedApprovalReceiptSchema.parse(args.curriculumEpisodeSeedApproval);
  assertCurriculumEpisodeSeedMatchesShowBible({
    curriculumEpisodeSeed,
    curriculumEpisodeSeedApproval: curriculumApproval,
    showBibleInput: showBible,
  });
  const graphFingerprint = episodeGraphFingerprint(graph);
  if (
    showBible.episodeGraphFingerprint !== graphFingerprint ||
    showBible.lessonContractFingerprint !== lessonContract.fingerprint ||
    approval.showBibleFingerprint !== showBible.contentFingerprint ||
    approval.episodeGraphFingerprint !== graphFingerprint ||
    approval.lessonContractFingerprint !== lessonContract.fingerprint ||
    approval.release !== "private_human_child_editor_review_only" ||
    approval.allowedPublishMode !== "draft" ||
    approval.requiresHumanChildEditor !== true
  ) {
    throw new Error("child_content_safety: child-editor approval is not bound to this exact graph and lesson contract");
  }
  if (
    curriculumApproval.curriculumEpisodeSeedFingerprint !== curriculumEpisodeSeed.contentFingerprint ||
    curriculumApproval.seriesId !== graph.seriesId ||
    curriculumApproval.episodeId !== graph.episodeId
  ) {
    throw new Error("child_content_safety: curriculum seed approval is not bound to this exact children Episode Graph identity");
  }
  const defects = [
    ...childSafeTextDefects(graph.topic, "children episode topic"),
    ...manifest.scenes.flatMap((scene) => [
      ...childSafeTextDefects(scene.label, `children scene ${scene.id} label`),
      ...childSafeTextDefects(scene.text, `children scene ${scene.id} text`),
      ...childSafeTextDefects(scene.visualState.action, `children scene ${scene.id} visual action`),
    ]),
  ];
  if (defects.length) throw new Error(`child_content_safety: ${defects.join("; ")}`);
  if (!manifest.scenes.some((scene) => scene.learningObjective)) {
    throw new Error("child_content_safety: no explicit learning objective reached the render manifest");
  }
  return {
    version: CHILD_CONTENT_SAFETY_VERSION,
    pass: true,
    madeForKids: true,
    release: "human-editorial-approval-required",
    allowedPublishMode: "draft",
    audience: "children",
    episodeGraphFingerprint: graphFingerprint,
    sceneManifestFingerprint: manifest.fingerprint,
    lessonContractFingerprint: lessonContract.fingerprint,
    childrenShowBibleFingerprint: showBible.contentFingerprint,
    curriculumEpisodeSeedFingerprint: curriculumEpisodeSeed.contentFingerprint,
    reviewReasons: [
      "Child-directed content requires a human editorial check before release.",
      "This artifact may create a private draft only; public and scheduled publishing are blocked.",
      "Reviewer must confirm age suitability, original characters/assets, and made-for-kids settings.",
    ],
  };
}

const childContentSafety: Block = {
  id: "child_content_safety",
  consumes: [
    "episodeGraph", "sceneManifest", "lessonContract", "contentLane",
    "childrenShowBible", "childrenShowBibleApproval",
    "curriculumEpisodeSeed", "curriculumEpisodeSeedApproval",
  ],
  produces: ["childContentSafety"],
  run: async (ctx) => {
    const receipt = assertChildContentSafety({
      episodeGraph: ctx.store["episodeGraph"],
      sceneManifest: ctx.store["sceneManifest"],
      lessonContract: ctx.store["lessonContract"],
      contentLane: ctx.store["contentLane"],
      childrenShowBible: ctx.store["childrenShowBible"],
      childrenShowBibleApproval: ctx.store["childrenShowBibleApproval"],
      curriculumEpisodeSeed: ctx.store["curriculumEpisodeSeed"],
      curriculumEpisodeSeedApproval: ctx.store["curriculumEpisodeSeedApproval"],
    });
    ctx.log("child_content_safety: passed deterministic safety checks; private human-review draft only");
    return { childContentSafety: receipt };
  },
};

export const childContentSafetyBlocks: Block[] = [childContentSafety];
