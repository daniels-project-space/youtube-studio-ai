/**
 * Local-only implementation of the Scene Manifest renderer boundary.
 * The renderer does not invent story, source, or child-policy state: those
 * belong to Episode Graph / Casefile / Child Safety respectively.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { assertSceneManifest, type SceneManifest } from "@/engine/episodeGraph";
import {
  resolveScenarioVisualTreatmentForRoute,
  type ScenarioVisualTreatment,
} from "@/engine/scenarioVisualTreatment";
import {
  assertSyntheticScenarioContract,
  syntheticScenarioVisualKindFor,
} from "@/engine/syntheticScenario";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { composeWithIntro, probe } from "@/lib/ffmpeg";
import { downloadTo, makeRunTempDir } from "@/lib/files";
import { renderSceneManifest } from "@/lib/sceneCompilerRender";
import { getObjectBytes, putObjectFromFile } from "@/lib/storage";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

async function recordAsset(
  ctx: StageContext,
  r2Key: string,
  meta: Record<string, unknown>,
  kind = "video",
): Promise<void> {
  try {
    await convex().mutation(api.assets.recordAsset, {
      ownerId: ctx.ownerId,
      channelId: ctx.channelId as Id<"channels">,
      runId: ctx.runId as Id<"runs">,
      kind,
      r2Key,
      meta,
    });
  } catch (error) {
    // The master is still durable in R2; an asset-index outage should not make
    // the renderer pretend the local media result does not exist.
    ctx.log(`scene_compiler: asset index write failed (non-fatal): ${error instanceof Error ? error.message : error}`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`scene_compiler: ${label} is required`);
  return value.trim();
}

function resolveDimensions(aspect: unknown): { width: number; height: number } {
  if (aspect !== undefined && aspect !== "16:9") {
    throw new Error("scene_compiler: only the audited 16:9 master profile is currently admitted");
  }
  return { width: 1920, height: 1080 };
}

/** Purely validates the renderer handoff; useful for targeted integration tests. */
export function assertSceneCompilerAdmission(args: {
  manifest: unknown;
  narrationDurationSec: unknown;
  aspect?: unknown;
}): SceneManifest {
  resolveDimensions(args.aspect);
  const manifest = assertSceneManifest(args.manifest);
  const narrationDurationSec = Number(args.narrationDurationSec);
  if (!Number.isFinite(narrationDurationSec) || narrationDurationSec <= 0) {
    throw new Error("scene_compiler: narration duration must be a positive finite number");
  }
  if (Math.abs(manifest.durationSec - narrationDurationSec) > 0.05) {
    throw new Error(
      `scene_compiler: Scene Manifest duration ${manifest.durationSec}s does not match narration ${narrationDurationSec}s`,
    );
  }
  if (manifest.renderer !== "deterministic-scene/v1" || manifest.externalProviderCalls !== 0) {
    throw new Error("scene_compiler: manifest must be produced by the zero-provider deterministic scene compiler");
  }
  return manifest;
}

/**
 * The deterministic Scene Compiler is the first concrete adapter for the
 * renderer-neutral treatment. Its Remotion composition emits the exact
 * disclosure badge whenever `syntheticScenarioProfile` is present, so reject
 * a manifest that omits or mutates the receipt binding before pixels render.
 */
export function assertSceneCompilerScenarioVisualTreatment(args: {
  readonly manifest: SceneManifest;
  readonly treatment: ScenarioVisualTreatment | undefined;
}): void {
  const hasSyntheticScene = args.manifest.scenes.some(
    (scene) => scene.visualState.syntheticScenarioProfile !== undefined,
  );
  if (!args.treatment) {
    // Route-less/pre-treatment manifests remain resumable as legacy. Current
    // fictional routes cannot reach this branch: resolveScenario... rejects a
    // route that declares the treatment block but omits its receipt.
    return;
  }
  if (!hasSyntheticScene) {
    throw new Error("scene_compiler: scenario visual treatment requires fictional scene grammar in every scene");
  }
  for (const [index, scene] of args.manifest.scenes.entries()) {
    if (scene.visualState.syntheticScenarioProfile !== args.treatment.profile) {
      throw new Error(`scene_compiler: scene ${scene.id} synthetic profile does not match the scenario visual treatment`);
    }
    const visualKind = scene.visualState.syntheticScenarioVisualKind;
    const visualGrammarMatches = args.treatment.profile === "ai_decision"
      // Decision grammar is selected upstream from the Story Spine beat
      // purpose, which intentionally does not travel in the renderer ABI.
      ? visualKind === "decision_options" || visualKind === "decision_outcome"
      : visualKind === syntheticScenarioVisualKindFor(
          args.treatment.profile,
          index,
          args.manifest.scenes.length,
        );
    if (!visualGrammarMatches) {
      throw new Error(`scene_compiler: scene ${scene.id} fictional visual grammar does not match the scenario visual treatment`);
    }
    if (scene.visualState.scenarioVisualTreatmentFingerprint !== args.treatment.fingerprint) {
      throw new Error(`scene_compiler: scene ${scene.id} does not carry the sealed scenario visual treatment fingerprint`);
    }
    if (scene.visualState.evidenceVisualIntent || scene.visualState.evidenceVisualManifest) {
      throw new Error(`scene_compiler: scene ${scene.id} cannot combine fictional scenario treatment with factual visual evidence`);
    }
  }
}

const sceneCompiler: Block = {
  id: "scene_compiler",
  consumes: ["sceneManifest", "narrationLocalPath", "narrationDurationSec", "musicUrl"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec", "sceneCompilerReceipt"],
  run: async (ctx) => {
    const manifest = assertSceneCompilerAdmission({
      manifest: ctx.store["sceneManifest"],
      narrationDurationSec: ctx.store["narrationDurationSec"],
      aspect: ctx.params["aspect"],
    });
    const syntheticScenario = ctx.store["syntheticScenario"] === undefined
      ? undefined
      : assertSyntheticScenarioContract(ctx.store["syntheticScenario"]);
    const scenarioVisualTreatment = resolveScenarioVisualTreatmentForRoute({
      treatment: ctx.store["scenarioVisualTreatment"],
      route: ctx.store["channelProgramRoute"],
      scenario: syntheticScenario,
      topic: manifest.topic,
      consumer: "scene_compiler",
    });
    assertSceneCompilerScenarioVisualTreatment({ manifest, treatment: scenarioVisualTreatment });
    const narrationPath = requiredString(ctx.store["narrationLocalPath"], "narrationLocalPath");
    const narrationDurationSec = Number(ctx.store["narrationDurationSec"]);
    const { width, height } = resolveDimensions(ctx.params["aspect"]);
    const runDir = await makeRunTempDir(ctx.runId, "scene_compiler");
    const silentVideoPath = join(runDir, "scene-compiler-silent.mp4");
    const finalVideoPath = join(runDir, "scene-compiler-master.mp4");

    await renderSceneManifest({
      manifest,
      outPath: silentVideoPath,
      width,
      height,
      log: ctx.log,
    });

    const musicKey = typeof ctx.store["musicKey"] === "string" ? ctx.store["musicKey"] : undefined;
    const musicPath = join(runDir, "music-bed.mp3");
    if (musicKey) {
      await writeFile(musicPath, await getObjectBytes(musicKey));
    } else {
      await downloadTo(requiredString(ctx.store["musicUrl"], "musicUrl"), musicPath);
    }

    // One standard composition path gives this local renderer the same audible
    // quality contract as narrated video: dialogue-led mix, gradual ducking,
    // 384k AAC, faststart, and exact timed duration. No remote media provider
    // is called here.
    await composeWithIntro({
      loopBodyPath: silentVideoPath,
      musicPath,
      narrationPath,
      outPath: finalVideoPath,
      introSec: 0,
      bodySec: narrationDurationSec,
      tailSec: 0,
      width,
      height,
      bodyMusicVol: Number(ctx.params["bodyMusicVol"] ?? 0.1026),
      musicDuckRampSec: Number(ctx.params["musicDuckRampSec"] ?? 4),
    });

    const result = await probe(finalVideoPath);
    if (!result.hasVideo || !result.hasAudio || result.width !== width || result.height !== height) {
      throw new Error("scene_compiler: final master is missing required audio/video streams or 16:9 geometry");
    }
    if (Math.abs(result.durationSec - narrationDurationSec) > 0.12) {
      throw new Error(
        `scene_compiler: final master duration ${result.durationSec.toFixed(3)}s drifted from narration ${narrationDurationSec.toFixed(3)}s`,
      );
    }
    const prefix = `${ctx.keyPrefix.replace(/\/$/, "")}/runs/${ctx.runId}/scene-compiler`;
    const videoKey = `${prefix}/master.mp4`;
    await putObjectFromFile(videoKey, finalVideoPath, { contentType: "video/mp4" });
    const sceneCompilerReceipt = {
      version: "scene-compiler-render/v1" as const,
      renderer: manifest.renderer,
      manifestFingerprint: manifest.fingerprint,
      externalProviderCalls: 0 as const,
      sceneCount: manifest.scenes.length,
      durationSec: result.durationSec,
      width,
      height,
      hasAudio: result.hasAudio,
    };
    await recordAsset(ctx, videoKey, {
      engine: "scene_compiler",
      ...sceneCompilerReceipt,
      topic: manifest.topic,
      audience: manifest.audience,
      sourceRefs: manifest.scenes.flatMap((scene) => scene.sourceRefs),
    });
    ctx.log(
      `scene_compiler: ${manifest.scenes.length} deterministic scenes → ${videoKey} ` +
      `(${result.durationSec.toFixed(2)}s, provider calls: 0)`,
    );
    return {
      videoKey,
      videoLocalPath: finalVideoPath,
      videoDurationSec: result.durationSec,
      sceneCompilerReceipt,
      [COST_PATCH_KEY]: 0,
    };
  },
};

export const sceneCompilerBlocks: Block[] = [sceneCompiler];
