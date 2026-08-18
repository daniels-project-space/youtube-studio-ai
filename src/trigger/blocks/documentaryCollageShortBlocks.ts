/**
 * Native documentary-collage Short lane.
 *
 * This intentionally does not alter `shorts_spinoff`: the legacy generic Shorts
 * path remains a stock-footage crop lane. These blocks render an independent
 * 9:16 master from a locked claim/source/beat manifest and finish through the
 * normal private-first `upload_draft` path.
 */
import { join } from "node:path";
import { StudioConvexHttpClient as ConvexHttpClient } from "@/lib/studioConvexHttpClient";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { COST_PATCH_KEY, type Block, type StageContext } from "@/engine/types";
import { buildEpisodeSpec } from "@/engine/qualityEvidence";
import {
  buildDocumentaryCollageShortStrategy,
  docuPlanForDocumentaryCollageShort,
  evaluateDocumentaryShortSceneQa,
  mineDocumentarySpinoffCandidates,
  shortRetentionManifestForStrategy,
} from "@/engine/documentaryCollageShort";
import { parseShortStrategyManifest, shortRenderDurationSec } from "@/engine/shortStrategyManifest";
import { craftDocuMotion, hasDocumotion } from "@/lib/documotion";
import { makeRunTempDir } from "@/lib/files";
import { putObject, putObjectFromFile } from "@/lib/storage";
import { safeFrameForDocuLayout } from "@/remotion/DocuMotion";

function convex(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  return new ConvexHttpClient(url);
}

async function recordAsset(
  ctx: StageContext,
  kind: string,
  r2Key: string,
  meta?: Record<string, unknown>,
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
    ctx.log(`recordAsset(${kind}) failed (non-fatal): ${error instanceof Error ? error.message : error}`);
  }
}

function textFromStore(ctx: StageContext, key: string): string {
  const value = ctx.store[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`documentary collage Short: ${key} is required`);
  return value.trim();
}

function targetSeconds(ctx: StageContext): number | undefined {
  const value = ctx.params["targetSeconds"];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function documotionRenderReceipt(value: unknown): {
  width: number;
  height: number;
  layout: string;
  durationSec: number;
  beatWindows: Array<{ id: string; durationSec: number }>;
  captionSafeFrame: { top: number; right: number; bottom: number; left: number };
  assetReceipts: Array<{
    receiptId: string;
    assetId: string;
    rendererAssetId: string;
    beatId: string;
    approvalSha256: string[];
  }>;
} {
  if (!value || typeof value !== "object") throw new Error("short_scene_qa: missing DocuMotion render receipt");
  const receipt = value as Record<string, unknown>;
  const geometry = receipt["geometry"] as Record<string, unknown> | undefined;
  const windows = receipt["beatWindows"];
  const safeFrame = receipt["captionSafeFrame"] as Record<string, unknown> | undefined;
  const assetReceipts = receipt["assetReceipts"];
  if (
    !geometry ||
    typeof geometry["width"] !== "number" ||
    typeof geometry["height"] !== "number" ||
    typeof geometry["layout"] !== "string" ||
    typeof receipt["durationSec"] !== "number" ||
    !Array.isArray(windows) ||
    !safeFrame ||
    !["top", "right", "bottom", "left"].every((key) => typeof safeFrame[key] === "number") ||
    !Array.isArray(assetReceipts)
  ) {
    throw new Error("short_scene_qa: invalid DocuMotion render receipt");
  }
  const beatWindows = windows.map((window) => {
    if (!window || typeof window !== "object") throw new Error("short_scene_qa: invalid beat render window");
    const typed = window as Record<string, unknown>;
    if (typeof typed["id"] !== "string" || typeof typed["durationSec"] !== "number") {
      throw new Error("short_scene_qa: invalid beat render window");
    }
    return { id: typed["id"], durationSec: typed["durationSec"] };
  });
  const parsedAssetReceipts = assetReceipts.map((assetReceipt) => {
    if (!assetReceipt || typeof assetReceipt !== "object") throw new Error("short_scene_qa: invalid asset receipt");
    const typed = assetReceipt as Record<string, unknown>;
    if (
      typeof typed["receiptId"] !== "string" ||
      typeof typed["assetId"] !== "string" ||
      typeof typed["rendererAssetId"] !== "string" ||
      typeof typed["beatId"] !== "string" ||
      !Array.isArray(typed["approvalSha256"]) ||
      !(typed["approvalSha256"] as unknown[]).every((hash) => typeof hash === "string")
    ) {
      throw new Error("short_scene_qa: invalid asset receipt");
    }
    return {
      receiptId: typed["receiptId"],
      assetId: typed["assetId"],
      rendererAssetId: typed["rendererAssetId"],
      beatId: typed["beatId"],
      approvalSha256: typed["approvalSha256"] as string[],
    };
  });
  return {
    width: geometry["width"],
    height: geometry["height"],
    layout: geometry["layout"],
    durationSec: receipt["durationSec"],
    beatWindows,
    captionSafeFrame: {
      top: safeFrame["top"] as number,
      right: safeFrame["right"] as number,
      bottom: safeFrame["bottom"] as number,
      left: safeFrame["left"] as number,
    },
    assetReceipts: parsedAssetReceipts,
  };
}

export const shortStrategy: Block = {
  id: "short_strategy",
  consumes: ["topic", "narrationText"],
  produces: ["shortStrategyBrief", "beatManifest", "shortRetentionManifest", "episodeSpec"],
  run: async (ctx) => {
    const topic = textFromStore(ctx, "topic");
    const narrationText = textFromStore(ctx, "narrationText");
    const manifest = buildDocumentaryCollageShortStrategy({
      runId: ctx.runId,
      channelId: ctx.channelId,
      topic,
      narrationText,
      targetDurationSec: targetSeconds(ctx),
      treatmentPreset: typeof ctx.params["treatmentPreset"] === "string" ? ctx.params["treatmentPreset"] : undefined,
      // Structured source references are an explicit pipeline parameter so a
      // channel can pass auditable research without ambient store reads.
      sources: ctx.params["sourceReferences"],
      claimEvidence: ctx.params["claimEvidence"],
    });
    const retention = shortRetentionManifestForStrategy(manifest);
    const episodeSpec = buildEpisodeSpec({
      lane: { key: "documentary_collage_short", renderer: "documotion_short" },
      topic,
      durationSec: retention.durationSec,
      story: {
        source: "short-strategy-manifest/v1",
        beatCount: manifest.beats.length,
        shotCount: manifest.beats.length,
        coverageRatio: 1,
      },
      candidateSelection: {
        generated: manifest.candidateSet?.candidates.length,
        selected: manifest.candidateSelection ? 1 : undefined,
        evidence: ["locked-source-claim-beat-manifest"],
      },
    });
    ctx.log(
      `short_strategy: locked ${manifest.beats.length} native 9:16 beats for ${retention.durationSec.toFixed(1)}s ` +
      `with ${manifest.sources.length} source reference(s)`,
    );
    return {
      shortStrategyBrief: manifest.strategy,
      beatManifest: manifest,
      shortRetentionManifest: retention,
      episodeSpec,
    };
  },
};

/**
 * Planning-only long-form documentary miner. It is intentionally separate from
 * the legacy crop-and-upload block: this produces an auditable shortlist, then
 * a fresh documentary-collage Short run owns rendering and private-first upload.
 */
export const documentaryShortCandidates: Block = {
  id: "documentary_short_candidates",
  consumes: ["sentenceTimings", "title"],
  produces: ["shortCandidateSet", "shortCandidateSelection"],
  run: async (ctx) => {
    const title = textFromStore(ctx, "title");
    const sourceVideoId = typeof ctx.store["youtubeVideoId"] === "string"
      ? ctx.store["youtubeVideoId"]
      : undefined;
    const result = mineDocumentarySpinoffCandidates({
      documentaryId: typeof ctx.params["sourceDocumentaryId"] === "string"
        ? ctx.params["sourceDocumentaryId"]
        : ctx.runId,
      sourceVideoId,
      title,
      sentenceTimings: ctx.store["sentenceTimings"],
      targetDurationSec: targetSeconds(ctx),
      maxCandidates: typeof ctx.params["maxCandidates"] === "number"
        ? ctx.params["maxCandidates"]
        : undefined,
    });
    ctx.log(
      `documentary_short_candidates: selected ${result.candidateSelection.selectedCandidateId} ` +
      `from ${result.candidateSet.candidates.length} full-documentary windows; no render or upload was created`,
    );
    return {
      shortCandidateSet: result.candidateSet,
      shortCandidateSelection: result.candidateSelection,
    };
  },
};

export const documotionShort: Block = {
  id: "documotion_short",
  consumes: ["topic", "beatManifest"],
  produces: ["videoKey", "videoLocalPath", "videoDurationSec", "documotionVerdict", "documotionRender"],
  paid: true,
  run: async (ctx) => {
    if (!hasDocumotion()) {
      throw new Error("documotion_short: FAL-hosted Nano Banana Flash configuration is required; no crop fallback is allowed");
    }
    const topic = textFromStore(ctx, "topic");
    const manifest = parseShortStrategyManifest(ctx.store["beatManifest"]);
    const styleId = typeof ctx.params["styleId"] === "string" ? ctx.params["styleId"] : "archival_collage";
    const plan = docuPlanForDocumentaryCollageShort(manifest, styleId);
    const runDir = await makeRunTempDir(ctx.runId, "documotion_short");
    const outPath = join(runDir, "final.mp4");
    const targetDurationSec = shortRenderDurationSec(manifest);
    ctx.log(
      `documotion_short: native portrait render ${targetDurationSec.toFixed(1)}s, ${plan.shots.length} locked beats, style=${styleId}`,
    );
    const result = await craftDocuMotion({
      topic,
      style: styleId,
      durationSec: targetDurationSec,
      runDir,
      outPath,
      format: "short",
      plan,
      lockShotDurations: true,
      maxRefineRounds: 2,
      log: (message) => ctx.log(`documotion_short: ${message}`),
    });
    const videoKey = `${ctx.keyPrefix}runs/${ctx.runId}/final.mp4`;
    await putObjectFromFile(videoKey, result.outPath, { contentType: "video/mp4" });
    const beatWindows = manifest.beats.map((beat, index) => ({
      id: beat.id,
      durationSec: result.shotDurationsSec[index] ?? beat.scene.durationSec,
    }));
    const durationSec = Math.round(result.shotDurationsSec.reduce((total, duration) => total + duration, 0) * 1000) / 1000;
    const assetReceipts = manifest.assets.map((asset, index) => {
      const receiptId = asset.provenance.generationReceiptId;
      if (!receiptId) throw new Error(`documotion_short: ${asset.id} is missing its planned generation receipt id`);
      const rendererAsset = result.assetReceipts.find(
        (candidate) => candidate.shotIdx === index && candidate.rendererAssetId === asset.id,
      );
      if (!rendererAsset) {
        throw new Error(`documotion_short: no approved renderer receipt matches planned asset ${asset.id}`);
      }
      return {
        receiptId,
        assetId: asset.id,
        rendererAssetId: rendererAsset.rendererAssetId,
        beatId: manifest.beats[index]?.id ?? `beat:${index + 1}`,
        approvalSha256: [rendererAsset.approvalSha256],
      };
    });
    const captionSafeFrame = safeFrameForDocuLayout(
      result.geometry.width,
      result.geometry.height,
      result.geometry.layout,
    );
    const assetReceiptKey = `${ctx.keyPrefix}runs/${ctx.runId}/documotion-asset-receipts.json`;
    await putObject(
      assetReceiptKey,
      Buffer.from(JSON.stringify({ version: "documotion-asset-receipts/v1", assetReceipts })),
      { contentType: "application/json" },
    );
    const documotionRender = {
      version: "documotion-short-render/v1",
      geometry: result.geometry,
      durationSec,
      beatWindows,
      captionSafeFrame,
      assetReceiptKey,
      assetReceipts,
    };
    await recordAsset(ctx, "video", videoKey, {
      engine: "documotion_short",
      lane: "documentary_collage_short",
      durationSec,
      width: result.geometry.width,
      height: result.geometry.height,
      beatCount: beatWindows.length,
      assetReceiptKey,
      sourceBacked: true,
    });
    ctx.log(`documotion_short: rendered native ${result.geometry.width}x${result.geometry.height} master → ${videoKey}`);
    return {
      // This block normally runs on the isolated large-2x render task, outside
      // the parent's usage scope. Return the child's exact observed spend so
      // the parent stage ledger and frozen run budget remain authoritative.
      [COST_PATCH_KEY]: result.usage.totalCostUsd,
      videoKey,
      videoLocalPath: result.outPath,
      videoDurationSec: durationSec,
      documotionVerdict: result.verdict,
      documotionRender,
    };
  },
};

export const shortSceneQa: Block = {
  id: "short_scene_qa",
  consumes: ["beatManifest", "documotionVerdict", "documotionRender"],
  produces: ["shortSceneQa"],
  run: async (ctx) => {
    const manifest = parseShortStrategyManifest(ctx.store["beatManifest"]);
    const verdict = ctx.store["documotionVerdict"] as { pass?: boolean; audioOk?: boolean } | undefined;
    const render = documotionRenderReceipt(ctx.store["documotionRender"]);
    const sceneQa = evaluateDocumentaryShortSceneQa({
      manifest,
      width: render.width,
      height: render.height,
      layout: render.layout,
      durationSec: render.durationSec,
      beatWindows: render.beatWindows,
      captionSafeFrame: render.captionSafeFrame,
      assetReceipts: render.assetReceipts,
      visualVerifierPassed: verdict?.pass === true,
      audioOk: verdict?.audioOk === true,
    });
    if (sceneQa.status !== "passed") {
      throw new Error(`short_scene_qa: failed release gate (${sceneQa.blockers.join("; ")})`);
    }
    ctx.log(`short_scene_qa: ${sceneQa.checks.length} native-portrait scene checks passed`);
    return { shortSceneQa: sceneQa };
  },
};

export const documentaryCollageShortBlocks: Block[] = [
  shortStrategy,
  documentaryShortCandidates,
  documotionShort,
  shortSceneQa,
];
