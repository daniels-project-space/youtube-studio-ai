import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ExecutionError } from "@/engine/executionErrors";
import {
  beginThumbnailPaidWork,
  openThumbnailCheckpoint,
  saveThumbnailGenerationCheckpoint,
  saveThumbnailQaCheckpoint,
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
  first = await saveThumbnailGenerationCheckpoint(first, 0.047321, io);
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
    saveThumbnailGenerationCheckpoint(session, 0.051, io),
    /simulated R2 upload outage/,
  );

  session = await openThumbnailCheckpoint(
    { checkpointRoot: "owners/o/runs/r2/thumbnail-checkpoints", requestHash, localImagePath },
    io,
  );
  assert.equal(session.source, "local");
  assert.equal(session.manifest?.generationCostUsd, 0.051);
  await saveThumbnailGenerationCheckpoint(session, 0.051, io);
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

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "thumbnail-checkpoint-test-"));
  try {
    await completedCheckpointReusesPixelsAndQa(root);
    await uploadFailureUsesLocalCheckpoint(root);
    await incompleteClaimFailsClosed(root);
    console.log("thumbnail checkpoint tests: ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
