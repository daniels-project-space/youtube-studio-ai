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
    !/^[a-f0-9]{64}$/i.test(childSafety.sceneManifestFingerprint)
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
    episodeGraphFingerprint: episodeGraphFingerprint(graph),
    sceneManifestFingerprint: manifest.fingerprint,
    lessonContractFingerprint: lessonContract.fingerprint,
    reviewReasons: [
      "Child-directed content requires a human editorial check before release.",
      "This artifact may create a private draft only; public and scheduled publishing are blocked.",
      "Reviewer must confirm age suitability, original characters/assets, and made-for-kids settings.",
    ],
  };
}

const childContentSafety: Block = {
  id: "child_content_safety",
  consumes: ["episodeGraph", "sceneManifest", "lessonContract", "contentLane"],
  produces: ["childContentSafety"],
  run: async (ctx) => {
    const receipt = assertChildContentSafety({
      episodeGraph: ctx.store["episodeGraph"],
      sceneManifest: ctx.store["sceneManifest"],
      lessonContract: ctx.store["lessonContract"],
      contentLane: ctx.store["contentLane"],
    });
    ctx.log("child_content_safety: passed deterministic safety checks; private human-review draft only");
    return { childContentSafety: receipt };
  },
};

export const childContentSafetyBlocks: Block[] = [childContentSafety];
