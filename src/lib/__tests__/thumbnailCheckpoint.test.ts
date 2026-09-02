import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ExecutionError } from "@/engine/executionErrors";
import {
  SCENARIO_VISUAL_TREATMENT_THUMBNAIL_BINDING_VERSION,
  scenarioVisualTreatmentThumbnailBindingFingerprint,
  type ScenarioVisualTreatmentThumbnailBinding,
} from "@/engine/scenarioVisualTreatment";
import { canonicalJson } from "@/lib/canonicalJson";
import { FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE } from "@/lib/falNanoBananaLofiThumbnailContract";
import { FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE } from "@/lib/falNanoBananaProThumbnailContract";
import {
  NANO_BANANA_THUMBNAIL_PROFILE,
  nanoBananaThumbnailCostUsd,
  nanoBananaThumbnailPromptCostUsd,
} from "@/lib/nanoBananaThumbnailContract";
import {
  beginThumbnailPaidWork,
  openThumbnailCheckpoint,
  saveThumbnailGenerationCheckpoint,
  saveThumbnailQaCheckpoint,
  thumbnailNanoBananaRequestContext,
  thumbnailRequestHash,
  type ThumbnailCheckpointIo,
} from "@/lib/thumbnailCheckpoint";

class MemoryCheckpointIo implements ThumbnailCheckpointIo {
  readonly objects = new Map<string, Uint8Array>();
  failNextImagePut = false;

  async getObjectBytes(key: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (!value) {
      throw Object.assign(new Error(`missing ${key}`), {
        name: "NoSuchKey",
        $metadata: { httpStatusCode: 404 },
      });
    }
    return Uint8Array.from(value);
  }

  async putObject(
    key: string,
    body: Uint8Array | string,
    options?: { ifNoneMatch?: "*" },
  ): Promise<void> {
    if (options?.ifNoneMatch === "*" && this.objects.has(key)) {
      throw Object.assign(new Error(`already exists ${key}`), {
        name: "PreconditionFailed",
        $metadata: { httpStatusCode: 412 },
      });
    }
    if (this.failNextImagePut && key.endsWith(".jpg")) {
      this.failNextImagePut = false;
      throw Object.assign(new Error("simulated R2 upload outage"), {
        $metadata: { httpStatusCode: 503 },
      });
    }
    this.objects.set(
      key,
      typeof body === "string" ? Buffer.from(body) : Uint8Array.from(body),
    );
  }
}

function treatmentBinding(seed: string): ScenarioVisualTreatmentThumbnailBinding {
  const unsigned = {
    version: SCENARIO_VISUAL_TREATMENT_THUMBNAIL_BINDING_VERSION,
    routeFingerprint: `${seed}1`.repeat(32),
    programBriefFingerprint: `${seed}2`.repeat(32),
    topicFingerprint: `${seed}3`.repeat(32),
    scenarioFingerprint: `${seed}4`.repeat(32),
    profile: "ai_town" as const,
    treatmentFingerprint: `${seed}5`.repeat(32),
  };
  return {
    ...unsigned,
    fingerprint: scenarioVisualTreatmentThumbnailBindingFingerprint(unsigned),
  };
}

async function nanoEvidenceSurvivesRemoteRecovery(root: string): Promise<void> {
  const io = new MemoryCheckpointIo();
  const requestHash = thumbnailRequestHash({ title: "Bound Nano receipt", pattern: 1 });
  const requestContext = thumbnailNanoBananaRequestContext({
    keyPrefix: "owner/o/channel/c/",
    runId: "run-bound-1",
    requestHash,
  });
  const profile = NANO_BANANA_THUMBNAIL_PROFILE;
  const providerRequestCanonicalJson = canonicalJson({
    apiVersion: profile.apiVersion,
    context: requestContext,
    model: profile.model,
    operation: "generateContent",
    body: {
      contents: [{ parts: [{
        text: "Cinematic scene. ABSOLUTE RULE — PICTURE ONLY, NO TEXT: no words.",
      }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: profile.aspectRatio },
      },
    },
  });
  const prompt = (
    JSON.parse(providerRequestCanonicalJson) as {
      body: { contents: Array<{ parts: Array<{ text: string }> }> };
    }
  ).body.contents[0].parts[0].text;
  const promptTokenCount = 80;
  const providerResponseMetadataCanonicalJson = canonicalJson({
    modelVersion: "gemini-2.5-flash-image-2025-08",
    responseId: "checkpoint-response-1",
    usageMetadata: { promptTokenCount, candidatesTokenCount: 1_290, totalTokenCount: 1_370 },
  });
  const evidence = {
    version: "thumbnail-nano-banana-evidence/v1" as const,
    requestContext,
    receipt: {
      provider: profile.provider,
      model: profile.model,
      apiVersion: profile.apiVersion,
      modelVersion: "gemini-2.5-flash-image-2025-08",
      responseId: "checkpoint-response-1",
      route: profile.route,
      width: profile.providerOutputWidth,
      height: profile.providerOutputHeight,
      promptUtf8Bytes: Buffer.byteLength(prompt, "utf8"),
      promptTokenCount,
      promptCostUsd: nanoBananaThumbnailPromptCostUsd(promptTokenCount),
      outputCostUsd: profile.outputImageUsd,
      costUsd: nanoBananaThumbnailCostUsd(promptTokenCount),
      sourceContentType: "image/png",
      providerRequestCanonicalJson,
      providerRequestSha256: createHash("sha256")
        .update(`nano-banana-provider\0${providerRequestCanonicalJson}`)
        .digest("hex"),
      providerResponseMetadataCanonicalJson,
      providerResponseMetadataSha256: createHash("sha256")
        .update(`nano-banana-response-metadata\0${providerResponseMetadataCanonicalJson}`)
        .digest("hex"),
      responseSha256: "a".repeat(64),
      createdAt: 1_900_000_000_000,
    },
  };
  const localImagePath = join(root, "nano-evidence", "thumbnail.jpg");
  await mkdir(join(root, "nano-evidence"), { recursive: true });
  let session = await openThumbnailCheckpoint({
    checkpointRoot: "owner/o/channel/c/runs/run-bound-1/thumbnail-checkpoints",
    requestHash,
    localImagePath,
  }, io);
  session = await beginThumbnailPaidWork(session, io);
  await writeFile(localImagePath, Buffer.from("composited thumbnail bytes"));
  session = await saveThumbnailGenerationCheckpoint(session, evidence.receipt.costUsd, evidence, io);
  assert.equal(session.manifest?.version, 2);
  assert.equal(
    session.manifest?.version === 2
      ? session.manifest.providerEvidence?.receipt.providerRequestSha256
      : undefined,
    evidence.receipt.providerRequestSha256,
  );

  await rm(join(root, "nano-evidence"), { recursive: true, force: true });
  const restored = await openThumbnailCheckpoint({
    checkpointRoot: "owner/o/channel/c/runs/run-bound-1/thumbnail-checkpoints",
    requestHash,
    localImagePath: join(root, "nano-restored", "thumbnail.jpg"),
  }, io);
  assert.equal(restored.source, "remote");
  assert.equal(restored.manifest?.version, 2);
  assert.equal(
    restored.manifest?.version === 2
      ? restored.manifest.providerEvidence?.receipt.route
      : undefined,
    "nano-banana-flash",
  );
}

async function nativeProEvidenceBindsPromptAndCopy(root: string): Promise<void> {
  const io = new MemoryCheckpointIo();
  const requestHash = thumbnailRequestHash({ title: "Native Pro receipt", pattern: 1 });
  const requestContext = thumbnailNanoBananaRequestContext({
    keyPrefix: "owner/o/channel/c/",
    runId: "run-native-pro-1",
    requestHash,
  });
  const profile = FAL_NANO_BANANA_PRO_THUMBNAIL_PROFILE;
  const prompt = `Scene with headline "$1K/MO" then "CASH ENGINE".`;
  const providerRequestCanonicalJson = canonicalJson({
    apiVersion: profile.apiVersion,
    context: requestContext,
    endpoint: profile.model,
    body: {
      prompt,
      num_images: 1,
      aspect_ratio: profile.aspectRatio,
      output_format: "png",
      safety_tolerance: "4",
      resolution: profile.resolution,
      limit_generations: true,
      enable_web_search: false,
    },
  });
  const providerResponseMetadataCanonicalJson = canonicalJson({
    requestId: "fal-native-pro-response",
    description: "",
    image: { width: 2048, height: 1152, content_type: "image/png" },
  });
  const evidence = {
    version: "thumbnail-fal-nano-banana-pro-evidence/v1" as const,
    requestContext,
    mode: "native-scene-and-typography" as const,
    expectedWords: ["$1K/MO", "CASH ENGINE"],
    receipt: {
      provider: profile.provider,
      model: profile.model,
      apiVersion: profile.apiVersion,
      providerRequestId: "fal-native-pro-response",
      route: profile.route,
      width: 2_048,
      height: 1_152,
      promptUtf8Bytes: Buffer.byteLength(prompt, "utf8"),
      outputCostUsd: profile.outputImageUsd,
      costUsd: profile.outputImageUsd,
      sourceContentType: "image/png",
      providerRequestCanonicalJson,
      providerRequestSha256: createHash("sha256")
        .update(`fal-nano-banana-pro-provider\0${providerRequestCanonicalJson}`)
        .digest("hex"),
      providerResponseMetadataCanonicalJson,
      providerResponseMetadataSha256: createHash("sha256")
        .update(`fal-nano-banana-pro-response-metadata\0${providerResponseMetadataCanonicalJson}`)
        .digest("hex"),
      responseSha256: "8".repeat(64),
      createdAt: 1_900_000_000_000,
    },
  };
  const localImagePath = join(root, "native-pro", "thumbnail.jpg");
  await mkdir(join(root, "native-pro"), { recursive: true });
  let session = await openThumbnailCheckpoint({
    checkpointRoot: "owner/o/channel/c/runs/run-native-pro-1/thumbnail-checkpoints",
    requestHash,
    localImagePath,
  }, io);
  session = await beginThumbnailPaidWork(session, io);
  await writeFile(localImagePath, Buffer.from("native Pro thumbnail bytes"));
  session = await saveThumbnailGenerationCheckpoint(session, evidence.receipt.costUsd, evidence, io);
  const restoredEvidence = session.manifest?.version === 2 || session.manifest?.version === 3
    ? session.manifest.providerEvidence
    : undefined;
  assert.equal(restoredEvidence?.version, "thumbnail-fal-nano-banana-pro-evidence/v1");
  assert.deepEqual(
    restoredEvidence?.version === "thumbnail-fal-nano-banana-pro-evidence/v1"
      ? restoredEvidence.expectedWords
      : undefined,
    ["$1K/MO", "CASH ENGINE"],
  );
  await assert.rejects(
    saveThumbnailGenerationCheckpoint(
      session,
      evidence.receipt.costUsd,
      { ...evidence, expectedWords: ["MUTATED COPY"] },
      io,
    ),
    /provider evidence is invalid/,
  );
}

async function completedCheckpointReusesPixelsAndQa(root: string): Promise<void> {
  const io = new MemoryCheckpointIo();
  const requestHash = thumbnailRequestHash({ title: "Crash proof", pattern: 2 });
  assert.equal(
    requestHash,
    thumbnailRequestHash({ pattern: 2, title: "Crash proof" }),
    "request hashing is stable across object key order",
  );
  const firstPath = join(root, "first", "thumbnail.jpg");
  await mkdir(join(root, "first"), { recursive: true });
  let providerPurchases = 0;
  let qaPurchases = 0;

  let first = await openThumbnailCheckpoint(
    { checkpointRoot: "owners/o/runs/r/thumbnail-checkpoints", requestHash, localImagePath: firstPath },
    io,
  );
  assert.equal(first.source, "new");
  first = await beginThumbnailPaidWork(first, io);
  providerPurchases += 1;
  await writeFile(firstPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  first = await saveThumbnailGenerationCheckpoint(first, 0.047321, undefined, io);
  qaPurchases += 1;
  const qaRequestHash = thumbnailRequestHash({ requestHash, quality: "production" });
  first = await saveThumbnailQaCheckpoint(
    first,
    {
      requestHash: qaRequestHash,
      costUsd: 0.003,
      verdict: {
        textOk: false,
        faceClear: true,
        punch: 5,
        styleMatch: 6,
        storyMatch: 6,
        uiClean: true,
        reason: "below production bar",
      },
    },
    io,
  );

  await rm(join(root, "first"), { recursive: true, force: true });
  const restoredPath = join(root, "fresh-worker", "thumbnail.jpg");
  const restored = await openThumbnailCheckpoint(
    { checkpointRoot: "owners/o/runs/r/thumbnail-checkpoints", requestHash, localImagePath: restoredPath },
    io,
  );
  assert.equal(restored.source, "remote");
  assert.equal(restored.manifest?.generationCostUsd, 0.047321);
  assert.equal(restored.manifest?.qa?.costUsd, 0.003);
  assert.equal(restored.manifest?.qa?.requestHash, qaRequestHash);
  assert.equal(
    (restored.manifest?.qa?.verdict as { reason?: string })?.reason,
    "below production bar",
    "a failed gate verdict is checkpointed instead of buying another judge call",
  );
  assert.deepEqual([...await readFile(restoredPath)], [0xff, 0xd8, 0xff, 0xd9]);
  assert.equal(providerPurchases, 1, "fresh-worker retry reuses purchased pixels");
  assert.equal(qaPurchases, 1, "fresh-worker retry reuses purchased QA");
}

async function scenarioTreatmentHashIsolationAndTamperFailClosed(root: string): Promise<void> {
  const io = new MemoryCheckpointIo();
  const checkpointRoot = "owners/o/runs/r/thumbnail-checkpoints";
  const legacyHash = thumbnailRequestHash({
    contract: "thumbnail-gen-checkpoint-v4-nano-banana-only",
    title: "Fictional town bridge",
  });
  const treatmentBoundHash = thumbnailRequestHash({
    contract: "thumbnail-gen-checkpoint-v5-nano-banana-scenario-treatment",
    title: "Fictional town bridge",
    scenarioVisualTreatment: { fingerprint: "a".repeat(64) },
  });
  assert.notEqual(treatmentBoundHash, legacyHash, "treatment-bound thumbnails must not reuse a generic checkpoint key");

  const legacyPath = join(root, "legacy-scenario-isolation", "thumbnail.jpg");
  await mkdir(join(root, "legacy-scenario-isolation"), { recursive: true });
  let legacy = await openThumbnailCheckpoint(
    { checkpointRoot, requestHash: legacyHash, localImagePath: legacyPath },
    io,
  );
  legacy = await beginThumbnailPaidWork(legacy, io);
  await writeFile(legacyPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await saveThumbnailGenerationCheckpoint(legacy, 0, undefined, io);

  const treatmentPath = join(root, "treatment-scenario-isolation", "thumbnail.jpg");
  await mkdir(join(root, "treatment-scenario-isolation"), { recursive: true });
  const treatmentSession = await openThumbnailCheckpoint(
    { checkpointRoot, requestHash: treatmentBoundHash, localImagePath: treatmentPath },
    io,
  );
  assert.equal(treatmentSession.source, "new", "a treatment-bound retry cannot reuse legacy generic pixels");

  const tamperedHash = thumbnailRequestHash({ title: "tampered scenario treatment checkpoint" });
  io.objects.set(
    `${checkpointRoot}/${tamperedHash}.manifest.json`,
    Buffer.from(JSON.stringify({
      version: 3,
      requestHash: tamperedHash,
      generationCostUsd: 0,
      artifactSha256: "b".repeat(64),
      scenarioVisualTreatment: { forged: true },
    })),
  );
  await assert.rejects(
    openThumbnailCheckpoint(
      {
        checkpointRoot,
        requestHash: tamperedHash,
        localImagePath: join(root, "tampered-scenario-isolation", "thumbnail.jpg"),
      },
      io,
    ),
    /scenario visual treatment binding is invalid/i,
    "a forged treatment checkpoint must fail before a retry can begin paid work",
  );

  const unboundV3Hash = thumbnailRequestHash({ title: "unbound v3 scenario treatment checkpoint" });
  io.objects.set(
    `${checkpointRoot}/${unboundV3Hash}.manifest.json`,
    Buffer.from(JSON.stringify({
      version: 3,
      requestHash: unboundV3Hash,
      generationCostUsd: 0,
      artifactSha256: "c".repeat(64),
    })),
  );
  await assert.rejects(
    openThumbnailCheckpoint(
      {
        checkpointRoot,
        requestHash: unboundV3Hash,
        localImagePath: join(root, "unbound-v3-scenario-isolation", "thumbnail.jpg"),
      },
      io,
    ),
    /treatment version and binding disagree/i,
    "v3 cannot omit the binding that makes its fictional thumbnail reusable",
  );
}

async function treatmentBoundCheckpointRejectsMismatchedRestore(root: string): Promise<void> {
  const io = new MemoryCheckpointIo();
  const checkpointRoot = "owners/o/runs/treatment-bound/thumbnail-checkpoints";
  const requestHash = thumbnailRequestHash({ title: "A sealed fictional town", candidate: 1 });
  const binding = treatmentBinding("a");
  const mismatchedBinding = treatmentBinding("b");
  const localImagePath = join(root, "treatment-bound", "thumbnail.jpg");
  await mkdir(join(root, "treatment-bound"), { recursive: true });

  let first = await openThumbnailCheckpoint({
    checkpointRoot,
    requestHash,
    localImagePath,
    scenarioVisualTreatmentBinding: binding,
  }, io);
  first = await beginThumbnailPaidWork(first, io);
  await writeFile(localImagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  first = await saveThumbnailGenerationCheckpoint(first, 0, undefined, io);
  assert.equal(first.manifest?.version, 3, "an admitted treatment must be persisted by the shared checkpoint API");
  await assert.rejects(
    saveThumbnailGenerationCheckpoint(first, 0, undefined, io, mismatchedBinding),
    /does not match its session/i,
    "generation checkpoint writes cannot substitute a different treatment binding",
  );
  await saveThumbnailQaCheckpoint(first, {
    requestHash: thumbnailRequestHash({ requestHash, qa: "fictional-treatment" }),
    verdict: { visualTreatmentCompliant: true },
    costUsd: 0,
    scenarioVisualTreatment: { binding, visualTreatmentCompliant: true },
  }, io);

  await rm(join(root, "treatment-bound"), { recursive: true, force: true });
  const restored = await openThumbnailCheckpoint({
    checkpointRoot,
    requestHash,
    localImagePath: join(root, "treatment-bound-restored", "thumbnail.jpg"),
    scenarioVisualTreatmentBinding: binding,
  }, io);
  assert.equal(restored.source, "remote", "the exact treatment binding may reuse sealed pixels");

  let providerAttempts = 0;
  await assert.rejects(
    openThumbnailCheckpoint({
      checkpointRoot,
      requestHash,
      localImagePath: join(root, "treatment-bound-mismatch", "thumbnail.jpg"),
      scenarioVisualTreatmentBinding: mismatchedBinding,
      beforeClaim: () => { providerAttempts += 1; },
    }, io),
    /does not match the admitted request/i,
    "a forged route/scenario/treatment binding cannot recover paid pixels",
  );
  assert.equal(providerAttempts, 0, "mismatched treatment fails before a provider can be claimed");

  await assert.rejects(
    openThumbnailCheckpoint({
      checkpointRoot,
      requestHash,
      localImagePath: join(root, "treatment-bound-generic", "thumbnail.jpg"),
    }, io),
    /does not match the admitted request/i,
    "generic callers cannot downgrade a treatment-bound checkpoint",
  );

  await assert.rejects(
    saveThumbnailQaCheckpoint(restored, {
      requestHash: thumbnailRequestHash({ requestHash, qa: "missing-treatment-binding" }),
      verdict: { visualTreatmentCompliant: true },
      costUsd: 0,
    }, io),
    /requires the admitted scenario visual treatment binding/i,
    "treatment-bound QA cannot be checkpointed without its matching witness",
  );
}

async function legacyV1CheckpointStillRestoresForGenericCallers(root: string): Promise<void> {
  const io = new MemoryCheckpointIo();
  const checkpointRoot = "owners/o/runs/legacy-v1/thumbnail-checkpoints";
  const requestHash = thumbnailRequestHash({ title: "Legacy generic thumbnail" });
  const localImagePath = join(root, "legacy-v1", "thumbnail.jpg");
  await mkdir(join(root, "legacy-v1"), { recursive: true });
  await writeFile(localImagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(`${localImagePath}.checkpoint.json`, JSON.stringify({
    version: 1,
    requestHash,
    generationCostUsd: 0,
  }));
  const restored = await openThumbnailCheckpoint({
    checkpointRoot,
    requestHash,
    localImagePath,
  }, io);
  assert.equal(restored.source, "local");
  assert.equal(restored.manifest?.version, 1, "legacy generic thumbnail checkpoints stay recoverable");
}

async function uploadFailureUsesLocalCheckpoint(root: string): Promise<void> {
  const io = new MemoryCheckpointIo();
  const requestHash = thumbnailRequestHash({ title: "Storage recovery" });
  const localImagePath = join(root, "storage-failure", "thumbnail.jpg");
  await mkdir(join(root, "storage-failure"), { recursive: true });
  let providerPurchases = 0;

  let session = await openThumbnailCheckpoint(
    { checkpointRoot: "owners/o/runs/r2/thumbnail-checkpoints", requestHash, localImagePath },
    io,
  );
  session = await beginThumbnailPaidWork(session, io);
  providerPurchases += 1;
  await writeFile(localImagePath, Buffer.from("real rendered jpeg bytes"));
  io.failNextImagePut = true;
  await assert.rejects(
    saveThumbnailGenerationCheckpoint(session, 0.051, undefined, io),
    /simulated R2 upload outage/,
  );

  session = await openThumbnailCheckpoint(
    { checkpointRoot: "owners/o/runs/r2/thumbnail-checkpoints", requestHash, localImagePath },
    io,
  );
  assert.equal(session.source, "local");
  assert.equal(session.manifest?.generationCostUsd, 0.051);
  await saveThumbnailGenerationCheckpoint(session, 0.051, undefined, io);
  assert.equal(providerPurchases, 1, "storage retry cannot repurchase the thumbnail");
}

async function incompleteClaimFailsClosed(root: string): Promise<void> {
  const io = new MemoryCheckpointIo();
  const requestHash = thumbnailRequestHash({ title: "Worker died after claim" });
  const abandoned = await openThumbnailCheckpoint(
    {
      checkpointRoot: "owners/o/runs/r3/thumbnail-checkpoints",
      requestHash,
      localImagePath: join(root, "dead-worker", "thumbnail.jpg"),
    },
    io,
  );

  await assert.rejects(
    openThumbnailCheckpoint(
      {
        checkpointRoot: "owners/o/runs/r3/thumbnail-checkpoints",
        requestHash,
        localImagePath: join(root, "replacement-worker", "thumbnail.jpg"),
      },
      io,
    ),
    (error: unknown) =>
      error instanceof ExecutionError &&
      error.code === "THUMBNAIL_CHECKPOINT_BUSY" &&
      error.retryable === true,
    "a live pre-spend owner is retryable and cannot be duplicated",
  );

  const claimEntry = [...io.objects.entries()].find(([key]) => key.endsWith(".claim.json"));
  assert.ok(claimEntry, "the pre-spend claim is durable");
  const claim = JSON.parse(Buffer.from(claimEntry[1]).toString("utf8")) as Record<string, unknown>;
  io.objects.set(claimEntry[0], Buffer.from(JSON.stringify({ ...claim, createdAt: 0 })));

  let replacement = await openThumbnailCheckpoint(
    {
      checkpointRoot: "owners/o/runs/r3/thumbnail-checkpoints",
      requestHash,
      localImagePath: join(root, "replacement-worker", "thumbnail.jpg"),
    },
    io,
  );
  replacement = await beginThumbnailPaidWork(replacement, io);
  assert.equal(replacement.spendStarted, true, "an expired pre-spend claim has a recovery route");
  await assert.rejects(
    beginThumbnailPaidWork(abandoned, io),
    (error: unknown) =>
      error instanceof ExecutionError &&
      error.code === "THUMBNAIL_CHECKPOINT_INCOMPLETE" &&
      error.retryable === false,
    "the atomic spend fence elects only one provider caller",
  );
  await assert.rejects(
    openThumbnailCheckpoint(
      {
        checkpointRoot: "owners/o/runs/r3/thumbnail-checkpoints",
        requestHash,
        localImagePath: join(root, "third-worker", "thumbnail.jpg"),
      },
      io,
    ),
    (error: unknown) =>
      error instanceof ExecutionError &&
      error.code === "THUMBNAIL_CHECKPOINT_INCOMPLETE" &&
      error.retryable === false,
    "once paid work starts, retry is recovery-only and cannot repurchase",
  );
}

async function lofiReferenceEvidenceBindsInputFrame(root: string): Promise<void> {
  const io = new MemoryCheckpointIo();
  const requestHash = thumbnailRequestHash({ lane: "lofi-15s-reference", iteration: 1 });
  const requestContext = thumbnailNanoBananaRequestContext({
    keyPrefix: "owner/o/channel/lofi/",
    runId: "run-lofi-reference",
    requestHash,
  });
  const profile = FAL_NANO_BANANA_LOFI_THUMBNAIL_PROFILE;
  const reference = Buffer.from("exact-resized-15-second-reference-frame");
  const sourceFrameSha256 = createHash("sha256").update(reference).digest("hex");
  const typographyMatte = Buffer.from("exact-chroma-typography-matte");
  const typographyMatteSha256 = createHash("sha256").update(typographyMatte).digest("hex");
  const prompt = "Edit the reference. Add exactly \"4K\". No other text.";
  const providerRequestCanonicalJson = canonicalJson({
    apiVersion: profile.apiVersion,
    context: requestContext,
    endpoint: profile.model,
    body: {
      prompt,
      num_images: 1,
      aspect_ratio: profile.aspectRatio,
      output_format: "png",
      safety_tolerance: "4",
      image_urls: [
        `data:image/png;base64,${typographyMatte.toString("base64")}`,
        `data:image/jpeg;base64,${reference.toString("base64")}`,
      ],
      limit_generations: true,
    },
  });
  const providerResponseMetadataCanonicalJson = canonicalJson({
    requestId: "lofi-reference-response",
    description: "fixture",
    image: { url: "https://fal.media/fixture.png", content_type: "image/png" },
  });
  const evidence = {
    version: "thumbnail-lofi-fal-nano-banana-evidence/v1" as const,
    requestContext,
    mode: "lofi-render-frame-reference" as const,
    sourceFrameSha256,
    typographyMatteSha256,
    typographyMatteUniformity: 0.991,
    backgroundSsim: 0.999,
    expectedText: ["4K"],
    receipt: {
      provider: profile.provider,
      model: profile.model,
      apiVersion: profile.apiVersion,
      providerRequestId: "lofi-reference-response",
      route: profile.route,
      width: profile.accountingWidth,
      height: profile.accountingHeight,
      promptUtf8Bytes: Buffer.byteLength(prompt, "utf8"),
      referenceSha256: sourceFrameSha256,
      typographyMatteSha256,
      outputCostUsd: profile.outputImageUsd,
      costUsd: profile.outputImageUsd,
      sourceContentType: "image/png",
      providerRequestCanonicalJson,
      providerRequestSha256: createHash("sha256")
        .update(`fal-nano-banana-lofi-provider\0${providerRequestCanonicalJson}`)
        .digest("hex"),
      providerResponseMetadataCanonicalJson,
      providerResponseMetadataSha256: createHash("sha256")
        .update(`fal-nano-banana-lofi-response-metadata\0${providerResponseMetadataCanonicalJson}`)
        .digest("hex"),
      responseSha256: "9".repeat(64),
      createdAt: 1_900_000_000_000,
    },
  };
  const localImagePath = join(root, "lofi-reference", "thumbnail.jpg");
  await mkdir(join(root, "lofi-reference"), { recursive: true });
  let session = await openThumbnailCheckpoint({
    checkpointRoot: "owner/o/channel/lofi/runs/run-lofi-reference/thumbnail-checkpoints",
    requestHash,
    localImagePath,
  }, io);
  session = await beginThumbnailPaidWork(session, io);
  await writeFile(localImagePath, Buffer.from("Nano Banana Lo-Fi edit"));
  session = await saveThumbnailGenerationCheckpoint(session, evidence.receipt.costUsd, evidence, io);
  const restoredEvidence = session.manifest?.version === 2 || session.manifest?.version === 3
    ? session.manifest.providerEvidence
    : undefined;
  assert.equal(restoredEvidence?.version, "thumbnail-lofi-fal-nano-banana-evidence/v1");
  assert.equal(
    restoredEvidence?.version === "thumbnail-lofi-fal-nano-banana-evidence/v1"
      ? restoredEvidence.mode
      : undefined,
    "lofi-render-frame-reference",
  );

  await assert.rejects(
    saveThumbnailGenerationCheckpoint(
      session,
      evidence.receipt.costUsd,
      { ...evidence, sourceFrameSha256: "0".repeat(64) },
      io,
    ),
    /provider evidence is invalid/,
    "the paid checkpoint must reject a Lo-Fi evidence record detached from its inline frame bytes",
  );
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "thumbnail-checkpoint-test-"));
  try {
    await completedCheckpointReusesPixelsAndQa(root);
    await scenarioTreatmentHashIsolationAndTamperFailClosed(root);
    await treatmentBoundCheckpointRejectsMismatchedRestore(root);
    await legacyV1CheckpointStillRestoresForGenericCallers(root);
    await uploadFailureUsesLocalCheckpoint(root);
    await incompleteClaimFailsClosed(root);
    await nanoEvidenceSurvivesRemoteRecovery(root);
    await nativeProEvidenceBindsPromptAndCopy(root);
    await lofiReferenceEvidenceBindsInputFrame(root);
    console.log("thumbnail checkpoint tests: ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
