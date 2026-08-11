import { VisualMatterManifestSchema, attachVisualMatterReferenceAssets, planVisualMatter, visualMatterAssetRequests, type VisualMatterReferenceAsset } from "@/engine/visualMatter";
import { COST_PATCH_KEY, type Block } from "@/engine/types";
import {
  generateFalNanoBanana2Image,
  type FalNanoBanana2ReferenceImage,
} from "@/lib/falNanoBanana";
import { putObject } from "@/lib/storage";

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
  return Math.max(min, Math.min(max, safe));
}

function safeAssetId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "reference";
}

/**
 * Builds a reusable Visual Matter package for a cinematic story. Reference
 * pixels are generated only when the operator explicitly enables that paid
 * option; otherwise the structured visual lock is still consumed downstream.
 */
const visualMatter: Block = {
  id: "visual_matter",
  consumes: ["topic", "narrativeBeats", "continuityLedger", "shotList", "dpVisualSpecs"],
  produces: ["visualMatterManifest"],
  paid: true,
  run: async (ctx) => {
    const manifest = planVisualMatter({
      topic: String(ctx.store["topic"]),
      channelName: typeof ctx.store["channelName"] === "string" ? ctx.store["channelName"] : undefined,
      styleDNA: (ctx.store["styleDNA"] as Record<string, unknown> | null | undefined) ?? null,
      visualBrief: (ctx.store["visualBrief"] as Record<string, unknown> | null | undefined) ?? null,
      continuityLedger: ctx.store["continuityLedger"],
      narrativeBeats: ctx.store["narrativeBeats"],
      shotList: ctx.store["shotList"],
      dpVisualSpecs: ctx.store["dpVisualSpecs"],
      maxCharacters: boundedInteger(ctx.params["maxCharacters"], 3, 0, 6),
      maxSettings: boundedInteger(ctx.params["maxSettings"], 3, 0, 6),
    });
    if (ctx.params["enabled"] === false) {
      const disabled = VisualMatterManifestSchema.parse({ ...manifest, status: "disabled" });
      ctx.log("visual_matter: disabled — emitted a typed no-op handoff; renderers will use their normal story spine");
      return { visualMatterManifest: disabled, [COST_PATCH_KEY]: 0 };
    }

    if (ctx.params["renderReferenceAssets"] !== true) {
      ctx.log(
        `visual_matter: planned ${manifest.characters.length} character, ${manifest.settings.length} setting, ` +
        `${manifest.storyboard.length} storyboard locks (reference-image spend not authorized)`,
      );
      return { visualMatterManifest: manifest, [COST_PATCH_KEY]: 0 };
    }

    const requests = visualMatterAssetRequests(
      manifest,
      boundedInteger(ctx.params["maxReferenceImages"], 8, 1, 12),
    );
    const assets: VisualMatterReferenceAsset[] = [];
    const generatedAnchors: Array<{
      id: string;
      kind: VisualMatterReferenceAsset["kind"];
      bytes: Uint8Array;
      contentType: string;
    }> = [];
    let costUsd = 0;
    for (const request of requests) {
      const frameReferenceIds = request.kind === "storyboard_frame"
        ? new Set(
            manifest.storyboard.find((frame) => frame.shotId === request.shotId)?.referenceAssetIds ?? [],
          )
        : request.kind === "character_sheet" || request.kind === "setting_sheet"
          ? new Set([manifest.moodBoard.id])
          : new Set<string>();
      const referenceImages: FalNanoBanana2ReferenceImage[] = generatedAnchors
        .filter((asset) => frameReferenceIds.has(asset.id))
        .slice(0, 6)
        .map((asset) => ({ bytes: asset.bytes, contentType: asset.contentType }));
      const prompt = referenceImages.length
        ? request.kind === "storyboard_frame"
          ? `${request.prompt} Use every supplied character, setting, and mood image as a locked visual continuity source. Preserve identity, wardrobe, silhouette, palette, and environment while composing this exact shot.`
          : `${request.prompt} Use the supplied mood board only as the locked palette, texture, lighting, and art-direction source for this sheet.`
        : request.prompt;
      const rendered = await generateFalNanoBanana2Image({
        prompt,
        aspectRatio: request.kind === "storyboard_frame" ? "16:9" : "3:2",
        resolution: "1K",
        outputFormat: "png",
        referenceImages,
        idempotencyContext: `${ctx.runId}:visual-matter:${safeAssetId(request.id)}`,
      });
      const r2Key = `${ctx.keyPrefix}runs/${ctx.runId}/visual-matter/${safeAssetId(request.id)}.png`;
      await putObject(r2Key, rendered.bytes, {
        contentType: rendered.contentType,
        ifNoneMatch: "*",
        metadata: {
          visualmatter: "v1",
          kind: request.kind,
          requestsha256: rendered.receipt.requestSha256,
          responsesha256: rendered.receipt.responseSha256,
        },
      });
      assets.push({
        id: request.id,
        kind: request.kind,
        label: request.label,
        prompt,
        ...(request.shotId ? { shotId: request.shotId } : {}),
        r2Key,
        contentType: rendered.contentType,
        receipt: {
          provider: rendered.receipt.provider,
          model: rendered.receipt.model,
          responseId: rendered.receipt.responseId,
          requestSha256: rendered.receipt.requestSha256,
          responseSha256: rendered.receipt.responseSha256,
          providerResponseMetadataSha256: rendered.receipt.providerResponseMetadataSha256,
          costUsd: rendered.receipt.costUsd,
          createdAt: rendered.receipt.createdAt,
          route: rendered.receipt.route,
          resolution: rendered.receipt.resolution,
          seed: rendered.receipt.seed,
          sourceReferenceSha256: rendered.receipt.referenceSha256,
          ...(rendered.receipt.width !== undefined ? { width: rendered.receipt.width } : {}),
          ...(rendered.receipt.height !== undefined ? { height: rendered.receipt.height } : {}),
        },
      });
      generatedAnchors.push({
        id: request.id,
        kind: request.kind,
        bytes: rendered.bytes,
        contentType: rendered.contentType,
      });
      costUsd += rendered.receipt.costUsd;
    }
    const anchored = attachVisualMatterReferenceAssets(manifest, assets);
    ctx.log(`visual_matter: rendered and attested ${assets.length} fal.ai Nano Banana 2 reference asset(s)`);
    return { visualMatterManifest: anchored, [COST_PATCH_KEY]: costUsd };
  },
};

export const VISUAL_MATTER_BLOCKS: Block[] = [visualMatter];
