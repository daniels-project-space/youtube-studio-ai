import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  rehydrateOutputsWithStorage,
  type RehydrationStorage,
} from "@/lib/rehydrate";

const presentMetadata = {
  contentLength: 42,
  contentType: "video/mp4",
  metadata: {},
};

async function neededMediaStreamsToDisk(): Promise<void> {
  const streamed: string[] = [];
  const headed: string[] = [];
  const storage: RehydrationStorage = {
    async getObjectToFile(key, filePath) {
      streamed.push(key);
      await writeFile(filePath, `streamed:${key}`);
      return filePath;
    },
    async headObjectMetadata(key) {
      headed.push(key);
      return presentMetadata;
    },
  };
  const result = await rehydrateOutputsWithStorage(
    "needed_stream_fixture",
    {
      videoLocalPath: "/definitely-missing/needed-master.mp4",
      videoKey: "owners/test/runs/needed/final.mp4",
    },
    "rehydrate-needed-stream",
    { neededOutputKeys: new Set(["videoLocalPath"]) },
    storage,
  );
  try {
    assert.equal(result.ok, true, "a demanded master is restored");
    assert.deepEqual(streamed, ["owners/test/runs/needed/final.mp4"], "needed media uses the streamed storage boundary exactly once");
    assert.deepEqual(headed, [], "a demanded object is not redundantly HEAD-checked before its stream");
    assert.equal(typeof result.outputs.videoLocalPath, "string");
    assert.ok(existsSync(result.outputs.videoLocalPath as string), "the streamed master is materialised on local disk");
  } finally {
    if (typeof result.outputs.videoLocalPath === "string") {
      await rm(dirname(result.outputs.videoLocalPath), { recursive: true, force: true });
    }
  }
}

async function unusedMediaOnlyHeadsAndKeepsRawPatch(): Promise<void> {
  const streamed: string[] = [];
  const headed: string[] = [];
  const rawPath = "/definitely-missing/unused-master.mp4";
  const storage: RehydrationStorage = {
    async getObjectToFile(key) {
      streamed.push(key);
      throw new Error("unused media must not be downloaded");
    },
    async headObjectMetadata(key) {
      headed.push(key);
      return presentMetadata;
    },
  };
  const result = await rehydrateOutputsWithStorage(
    "unused_head_fixture",
    {
      videoLocalPath: rawPath,
      videoKey: "owners/test/runs/unused/final.mp4",
      downstreamMetadata: { retained: true },
    },
    "rehydrate-unused-head",
    { neededOutputKeys: new Set(["downstreamMetadata"]) },
    storage,
  );
  assert.equal(result.ok, true, "a durable but unused master does not block a resume");
  assert.deepEqual(streamed, [], "unused media avoids its R2 GET and byte transfer");
  assert.deepEqual(headed, ["owners/test/runs/unused/final.mp4"], "unused media is still existence-checked");
  assert.equal(result.outputs.videoLocalPath, rawPath, "the complete raw stage patch remains available for lineage");
}

async function missingUnusedMediaFailsClosed(): Promise<void> {
  let streamed = 0;
  let headed = 0;
  const storage: RehydrationStorage = {
    async getObjectToFile() {
      streamed += 1;
      throw new Error("a missing skipped object must fail before any stream");
    },
    async headObjectMetadata() {
      headed += 1;
      return null;
    },
  };
  const result = await rehydrateOutputsWithStorage(
    "missing_head_fixture",
    {
      videoLocalPath: "/definitely-missing/deleted-master.mp4",
      videoKey: "owners/test/runs/missing/final.mp4",
    },
    "rehydrate-missing-head",
    { neededOutputKeys: new Set() },
    storage,
  );
  assert.equal(result.ok, false, "a missing omitted R2 object remains a failed restoration");
  assert.equal(headed, 1, "the durable-object fence probes the omitted object");
  assert.equal(streamed, 0, "a confirmed missing object never wastes a download");
}

async function main(): Promise<void> {
  await neededMediaStreamsToDisk();
  await unusedMediaOnlyHeadsAndKeepsRawPatch();
  await missingUnusedMediaFailsClosed();
  console.log("rehydrateDemandDriven: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
