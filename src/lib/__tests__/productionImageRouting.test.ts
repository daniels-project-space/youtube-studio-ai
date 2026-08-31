import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generationProfile } from "@/engine/generationProfiles";
import { CATALOG_EXECUTION_BINDINGS } from "@/engine/goldenExecution";
import { createImageUsageScope } from "@/lib/imageUsage";
import { canonicalJson } from "@/lib/canonicalJson";
import { toNovitaPhaseProfile } from "@/lib/novitaRenderFarm";
import {
  renderAttestedNovitaImageBytes,
  settleNovitaImageProviderReceipt,
  type NovitaRenderedImage,
} from "@/lib/novitaMedia";

const HASH = "a".repeat(64);

function renderedImage(overrides: Partial<NovitaRenderedImage> = {}): NovitaRenderedImage {
  const profile = generationProfile("production");
  const costUsd = 0.0125;
  const billingReceipt = {
    provider: "novita" as const,
    currency: "USD" as const,
    receiptId: "receipt-test-1234",
    gpuSku: "L40S",
    gpuCount: 1,
    gpuSeconds: 10,
    gpuRateUsdPerSecond: 0.00125,
    startupUsd: 0,
    storageUsd: 0,
    costUsd,
  };
  const requestCanonicalJson = canonicalJson({
    jobs: [{ id: "candidate-0" }],
    jobsSel: "full",
    maxConcurrent: 1,
    maxCostUsd: 0.04,
    nshard: 1,
    prefix: "imagecraft/test",
    profile: toNovitaPhaseProfile(profile, "image"),
  });
  const base: NovitaRenderedImage = {
    url: "https://r2.example.test/image.png",
    key: "imagecraft/test/job/stills/still.png",
    jobId: `image-${"b".repeat(32)}`,
    model: `${profile.image.model}@${profile.image.revision}`,
    profileId: profile.id,
    width: profile.image.width,
    height: profile.image.height,
    costUsd,
    billingReceipt,
    runtimeAttestation: {
      provider: "novita",
      capacityMode: profile.infrastructure.capacityMode,
      weightStorage: profile.infrastructure.weightStorage,
      cacheMount: profile.infrastructure.cacheMount,
      checkpointing: profile.infrastructure.checkpointing,
      idleShutdownSeconds: profile.infrastructure.idleShutdownSeconds,
      gpuCount: 1,
      model: profile.image.model,
      revision: profile.image.revision,
      checkpoint: profile.image.checkpoint,
    },
    profileSha256: createHash("sha256")
      .update(canonicalJson(toNovitaPhaseProfile(profile, "image")))
      .digest("hex"),
    manifestSha256: HASH,
    requestSha256: createHash("sha256").update("image\0").update(requestCanonicalJson).digest("hex"),
    requestCanonicalJson,
    billingReceiptSha256: createHash("sha256").update(canonicalJson(billingReceipt)).digest("hex"),
  };
  return { ...base, ...overrides };
}

async function adapterProof(): Promise<void> {
  const scope = createImageUsageScope();
  const order: string[] = [];
  const result = await scope.run(() => renderAttestedNovitaImageBytes({
    prefix: "owners/o/channels/c/runs/run-1/thumbnail",
    id: "candidate-0",
    prompt: "text-free physical scene",
    profileId: "production",
    maxCostUsd: 0.04,
    beforeProviderSpend: () => { order.push("before-spend"); },
    onProviderReceipt: () => { order.push("provider-receipt"); },
  }, {
    renderImage: async (request) => {
      await request.beforeProviderSpend?.();
      order.push("render");
      assert.equal(request.prefix, "owners/o/channels/c/runs/run-1/thumbnail");
      assert.equal(request.id, "candidate-0");
      assert.equal(request.profileId, "production");
      assert.equal(request.maxCostUsd, 0.04);
      const rendered = renderedImage();
      await settleNovitaImageProviderReceipt(rendered, "production", request.onProviderReceipt);
      return rendered;
    },
    downloadImage: async (key) => {
      order.push("download");
      assert.equal(key, renderedImage().key);
      return new Uint8Array([1, 2, 3, 4]);
    },
  }));

  assert.deepEqual(order, ["before-spend", "render", "provider-receipt", "download"]);
  assert.deepEqual([...result.bytes], [1, 2, 3, 4]);
  const usage = scope.snapshot();
  assert.equal(usage.calls, 1);
  assert.equal(usage.costUsd, 0.0125);
  assert.equal(usage.records[0]?.provider, "novita");
  assert.equal(usage.records[0]?.route, "local-z-image-turbo");
}

async function rejectedAttestationStillAccounts(): Promise<void> {
  const scope = createImageUsageScope();
  let downloads = 0;
  await assert.rejects(
    scope.run(() => renderAttestedNovitaImageBytes({
      prefix: "owners/o/channels/c/runs/run-2/comic",
      id: "panel-0",
      prompt: "panel art",
      maxCostUsd: 0.35,
    }, {
      renderImage: async () => {
        const rendered = renderedImage({
          runtimeAttestation: {
            ...renderedImage().runtimeAttestation,
            model: "unapproved/model",
          },
        });
        await settleNovitaImageProviderReceipt(rendered, "production");
        return rendered;
      },
      downloadImage: async () => {
        downloads += 1;
        return new Uint8Array([9]);
      },
    })),
    (error: unknown) => {
      assert.equal((error as { retryable?: unknown }).retryable, false);
      assert.equal((error as { observedCostUsd?: unknown }).observedCostUsd, 0.0125);
      return /attestation/.test(String(error));
    },
  );
  assert.equal(downloads, 0, "unattested bytes must never be downloaded or accepted");
  assert.equal(scope.snapshot().costUsd, 0.0125, "paid work must remain in the ledger");
}

async function providerReceiptSurvivesDeliveryCrash(): Promise<void> {
  const scope = createImageUsageScope();
  const order: string[] = [];
  let durableRequestHash: string | undefined;
  await assert.rejects(
    scope.run(() => renderAttestedNovitaImageBytes({
      prefix: "owners/o/channels/c/runs/run-crash/thumbnail",
      id: "candidate-crash",
      prompt: "text-free crash-boundary scene",
      maxCostUsd: 0.35,
      onProviderReceipt: (receipt) => {
        durableRequestHash = receipt.requestSha256;
        order.push("durable-receipt");
      },
    }, {
      renderImage: async (request) => {
        const rendered = renderedImage();
        await settleNovitaImageProviderReceipt(rendered, "production", request.onProviderReceipt);
        return rendered;
      },
      downloadImage: async () => {
        order.push("download");
        throw new Error("simulated crash after provider response before artifact upload");
      },
    })),
    /simulated crash/,
  );
  assert.equal(durableRequestHash, renderedImage().requestSha256);
  assert.deepEqual(order, ["durable-receipt", "download"]);
  assert.equal(scope.snapshot().costUsd, 0.0125);
}

async function routingProof(): Promise<void> {
  const thumbnailFiles = [
    "src/lib/thumbnailRenderer.ts",
    "src/lib/thumbnailLab.ts",
    "src/lib/speechThumbnail.ts",
    "src/trigger/planWeekAhead.ts",
    "src/trigger/blocks/intelligenceBlocks.ts",
  ];
  const forbiddenThumbnailRoute =
    /\bcreateAttestedNovitaImageGenerator\b|\brenderNovitaImage\b|\bgenerateBananaImage\b|\bgenerateFal(?:FluxPro)?Image\b|from\s+["']@\/lib\/(?:novitaMedia|falImage|replicate)["']/;
  for (const relative of thumbnailFiles) {
    const source = await readFile(join(process.cwd(), relative), "utf8");
    assert.doesNotMatch(source, forbiddenThumbnailRoute,
      `${relative} must not invoke Novita, Fal, or the generic image router for thumbnail pixels`);
  }

  const explicitInjection: Record<string, RegExp> = {
    "src/lib/thumbnailRenderer.ts": /generateNanoBananaImage/,
    "src/trigger/planWeekAhead.ts": /generateNanoBananaImageWithReceipt/,
    "src/trigger/blocks/intelligenceBlocks.ts": /generateNanoBananaImageWithReceipt/,
    "src/trigger/blocks/motionComicBlocks.ts": /createAttestedNovitaImageGenerator/,
    "src/trigger/blocks/whiteboardScribeBlocks.ts": /generateNanoBananaProWhiteboardArtWithReceipt/,
    "src/trigger/blocks/loreShortBlocks.ts": /createAttestedNovitaImageGenerator/,
    "src/trigger/blocks/lofiBlocks.ts": /renderNovitaImage/,
  };
  for (const [relative, expected] of Object.entries(explicitInjection)) {
    assert.match(await readFile(join(process.cwd(), relative), "utf8"), expected);
  }
  const whiteboardSource = await readFile(
    join(process.cwd(), "src/trigger/blocks/whiteboardScribeBlocks.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    whiteboardSource,
    /\bcreateAttestedNovitaImageGenerator\b|\brenderNovitaImage\b/,
    "Whiteboard art must stay on its sealed Nano Banana Pro route rather than falling back to Novita",
  );
  const triggerConfig = await readFile(join(process.cwd(), "trigger.config.ts"), "utf8");
  assert.match(triggerConfig, /FORWARDED_ENV[\s\S]*"GEMINI_API_KEY"/,
    "Trigger deploys must forward the direct Nano Banana credential when present");

  for (const key of ["motioncraft"] as const) {
    assert.equal(CATALOG_EXECUTION_BINDINGS[key]?.kind, "catalog-only");
    assert.deepEqual(CATALOG_EXECUTION_BINDINGS[key]?.executableIds, []);
  }
  // loreshort was catalog-only until its providers were inverted. Now that it is
  // wired, the binding must stay honest AND its pixels must run through the
  // attested farm — the whole reason it could not be wired as-written.
  assert.equal(CATALOG_EXECUTION_BINDINGS.loreshort.kind, "pipeline-module");
  assert.deepEqual(CATALOG_EXECUTION_BINDINGS.loreshort.executableIds, ["lore_short"]);
  assert.equal(CATALOG_EXECUTION_BINDINGS.documotion.kind, "pipeline-module");
  assert.deepEqual(CATALOG_EXECUTION_BINDINGS.documotion.executableIds, ["short_strategy", "documotion_short"]);
  assert.deepEqual(CATALOG_EXECUTION_BINDINGS.thumbnail.executableIds, ["thumbnail_gen"]);
  assert.deepEqual(CATALOG_EXECUTION_BINDINGS.whiteboard.executableIds, ["whiteboard_scribe"]);
  assert.deepEqual(CATALOG_EXECUTION_BINDINGS.comic.executableIds, ["motion_comic"]);
  assert.deepEqual(CATALOG_EXECUTION_BINDINGS["channel-planner"].executableIds, ["plan-week-ahead"]);
}

async function main(): Promise<void> {
  await adapterProof();
  await rejectedAttestationStillAccounts();
  await providerReceiptSurvivesDeliveryCrash();
  await routingProof();
  console.log("PRODUCTION IMAGE ROUTING PASS: strict Nano thumbnails; Novita footage stays attested and fail-closed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
