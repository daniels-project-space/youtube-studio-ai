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
  const liveFiles = [
    "src/lib/thumbnailRenderer.ts",
    "src/lib/thumbnailLab.ts",
    "src/trigger/planWeekAhead.ts",
    "src/trigger/blocks/intelligenceBlocks.ts",
    "src/lib/motionComic.ts",
    "src/trigger/blocks/motionComicBlocks.ts",
    "src/lib/whiteboardSync.ts",
    "src/trigger/blocks/whiteboardScribeBlocks.ts",
    "src/trigger/blocks/lofiBlocks.ts",
  ];
  const forbidden = /\bgenerateBananaImage\b|\bgenerateFal(?:FluxPro)?Image\b|from\s+["']@\/lib\/(?:banana|falImage|replicate)["']/;
  for (const relative of liveFiles) {
    const source = await readFile(join(process.cwd(), relative), "utf8");
    assert.doesNotMatch(source, forbidden, `${relative} must not invoke a legacy production image route`);
  }

  const explicitInjection: Record<string, RegExp> = {
    "src/trigger/planWeekAhead.ts": /createAttestedNovitaImageGenerator/,
    "src/trigger/blocks/intelligenceBlocks.ts": /createAttestedNovitaImageGenerator/,
    "src/trigger/blocks/motionComicBlocks.ts": /createAttestedNovitaImageGenerator/,
    "src/trigger/blocks/whiteboardScribeBlocks.ts": /createAttestedNovitaImageGenerator/,
    "src/trigger/blocks/lofiBlocks.ts": /renderNovitaImage/,
  };
  for (const [relative, expected] of Object.entries(explicitInjection)) {
    assert.match(await readFile(join(process.cwd(), relative), "utf8"), expected);
  }

  for (const key of ["documotion", "motioncraft", "loreshort"] as const) {
    assert.equal(CATALOG_EXECUTION_BINDINGS[key]?.kind, "catalog-only");
    assert.deepEqual(CATALOG_EXECUTION_BINDINGS[key]?.executableIds, []);
  }
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
  console.log("PRODUCTION IMAGE ROUTING PASS: Novita-only, attested, accounted, and fail-closed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
