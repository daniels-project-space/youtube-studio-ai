import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFunctionName } from "convex/server";
import type { StageContext } from "@/engine/types";
import { YuE2AssemblySourceSchema } from "@/engine/yue2AssemblySource";
import { canonicalJson } from "@/lib/canonicalJson";
import { contentLaneForFamily } from "@/engine/contentLane";

// Execute the real Short caller. Media, quality, storage and upload boundaries
// are fixtures; this suite proves source-authority ordering, not output quality.
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const source = YuE2AssemblySourceSchema.parse({
  version: "yue2-assembly-source/v1", approvalFingerprint: "a".repeat(64),
  candidateSha256: "b".repeat(64), arrangementFingerprint: "c".repeat(64),
  listeningAudioSha256: "d".repeat(64), preparedAudioSha256: "e".repeat(64),
  nativeFrames: 480000, preparedFrames: 384000, preparedAudioBytes: 3072044,
  crossfadeSec: 2, sampleRateHz: 48000, channels: 2, playback: "repeat", publishingApproved: false,
});
const objects = new Map<string, Buffer>();
const events: string[] = [];
let directory = "", checks = 0, revokeAt = 0, legacy = false;
let tamper: "none" | "remove" | "replace" | "inject" = "none";
let certificate: Record<string, unknown> | undefined;
const keyPrefix = "owner/short-owner/channel/short-channel/", runId = "short-run";
const certificateKey = (_prefix: string, _run: string, fingerprint: string) => `${keyPrefix}runs/${runId}/${fingerprint}.json`;
const client = { query: async (endpoint: unknown, args: Record<string, unknown>) => {
  assert.equal(getFunctionName(endpoint as never), "yue2Continuations:verifyReleaseSource");
  assert.deepEqual(Object.keys(args).sort(), ["channelId", "ownerId", "runId", ...(legacy ? [] : ["source"])].sort());
  assert.equal(args.ownerId, "short-owner"); assert.equal(args.channelId, "short-channel"); assert.equal(args.runId, runId);
  checks++; events.push(`authority:${checks}`);
  if (checks === revokeAt) throw new Error("fixture source approval revoked");
  if (legacy) return null;
  assert.equal(canonicalJson(args.source), canonicalJson(source));
  return structuredClone(source);
} };
const fileHash = async (path: string) => hash(await readFile(path));
const load = createRequire(__filename);
const overrides: Record<string, Record<string, unknown>> = {
  "./blockContext": { convex: () => client, recordAsset: async () => { events.push("asset"); } },
  "@/engine/qualityEvidence": {
    QualityEvidenceSchema: { safeParse: () => ({ success: true, data: { release: { hardGateReady: true } } }) },
    assessProductionEditorialAcceptance: () => ({ ready: true, blockers: [] }),
  },
  "@/lib/files": { makeRunTempDir: async () => directory },
  "@/lib/storage": {
    getObjectBytes: async (key: string) => { assert.ok(objects.has(key), `missing fixture object ${key}`); return objects.get(key)!; },
    putObject: async (key: string, bytes: Buffer) => {
      const value = JSON.parse(bytes.toString());
      if (value.finalMaster?.r2Key?.endsWith("/short.mp4")) {
        certificate = structuredClone(value);
        if (tamper === "remove") delete value.yue2AssemblySource;
        if (tamper === "replace" || tamper === "inject") value.yue2AssemblySource = { ...source, approvalFingerprint: "f".repeat(64) };
      }
      objects.set(key, Buffer.from(JSON.stringify(value)));
    },
    putObjectFromFile: async (key: string, path: string) => { objects.set(key, await readFile(path)); },
    publicUrl: (key: string) => `https://fixture.invalid/${key}`,
  },
  "@/lib/publishDispatcher": { fileSha256: fileHash },
  "@/lib/ffmpeg": {
    makeVerticalClip: async (_src: string, out: string) => { events.push("transform"); await writeFile(out, "raw portrait fixture"); },
    burnCaptions: async (_src: string, _cues: unknown, out: string) => { await writeFile(out, "captioned portrait fixture"); },
    probe: async () => ({ hasVideo: true, hasAudio: true, width: 1080, height: 1920, durationSec: 10 }),
    measureAudio: async () => ({ integratedLufs: -16, windowMeanDb: [-16] }),
  },
  "@/lib/visualReview": {
    channelVisualReviewProfile: () => ({ allowedVisualConditions: [], criticEmphasis: [], qualityCriteria: [] }),
    reviewRender: async (path: string) => {
      events.push("review");
      return { ran: true, verdict: "pass", referenceCriteriaComplete: true, summary: "fixture", defects: [], focusWindows: [], referenceCriteria: [],
        reviewFingerprint: "short-review", reviewReceiptVersion: "visual-review-receipt/v1", reviewReceiptFingerprint: "1".repeat(64),
        evidence: { source: { durationSec: 10, sha256: await fileHash(path) }, manifestKey: "fixture-manifest",
          frames: [{ id: "f1", tSec: 1, r2Key: "fixture-frame", contentSha256: "2".repeat(64), byteLength: 10 }] } };
    },
  },
  "@/lib/onScreenTextProof": {
    sha256OnScreenTextSource: fileHash,
    proveOnScreenText: async () => ({ passed: true, cues: [{ passed: true }], engine: { name: "fixture", version: "1" } }),
  },
  "@/engine/shortsOpeningEvidence": { createShortsOpeningEvidence: () => ({ fixture: true }) },
  "@/lib/narrationTranscriptProof": {
    sha256NarrationTranscriptSource: fileHash,
    proveNarrationTranscript: () => ({ expected: { textSha256: "3".repeat(64) } }),
    prepareFinalMasterNarrationTranscriptAudit: (audit: unknown) => ({ audit, bytes: Buffer.from(JSON.stringify(audit)), contentSha256: "4".repeat(64) }),
    sealFinalMasterNarrationSemanticEvidence: (value: unknown) => value,
    parseFinalMasterNarrationTranscriptAuditBytes: (bytes: Buffer) => JSON.parse(bytes.toString()),
    assertFinalMasterNarrationTranscriptAuditBinding: () => {},
  },
  "@/lib/finalMasterReleaseCertificate": {
    finalMasterReleaseCertificateKey: certificateKey,
    parseFinalMasterReleaseCertificateBytes: (bytes: Buffer) => JSON.parse(bytes.toString()),
    retainedFinalMasterReleaseObjectKeys: () => [],
    verifyFinalMasterReleaseEvidenceObjects: async () => { events.push("proof-objects"); },
    verifyFinalMasterReleaseEvidenceForLocalUpload: async () => { events.push("proof-local"); },
    createVisualReviewReleaseReceipt: (value: object) => ({ ...value, releaseReceiptFingerprint: "5".repeat(64) }),
    createFinalMasterReleaseCertificate: (value: object) => ({ ...value, certificateFingerprint: hash(canonicalJson(value)) }),
    createFinalMasterReleaseCertificateReference: () => ({ fixture: true }),
  },
  "@/lib/youtubeConnector": { requireYouTubeConnector: async () => {
    events.push("connector"); return { connectorId: "fixture", tokenVersion: 1, refreshToken: "fixture-not-a-token" };
  } },
  "@/lib/youtubeDurableUpload": { uploadDurableVideo: async () => {
    events.push("upload"); return { videoId: "fixture-video", watchUrl: "https://fixture.invalid", privacyStatus: "private" };
  } },
  "@/lib/ayrshare": { hasAyrshareKey: () => true, crosspost: async () => { events.push("crosspost"); return { ok: true, ids: [] }; } },
  "@/lib/channelPublishPolicy": { requireChannelPublishAction: async () => { events.push("publish-policy"); } },
};
const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load, originalFetch = globalThis.fetch;
loader._load = function (id, ...args) {
  const actual = originalLoad.call(this, id, ...args);
  return overrides[id] ? { ...actual as object, ...overrides[id] } : actual;
};
globalThis.fetch = async () => { throw new Error("Short authority tests forbid external networking"); };

async function setup() {
  objects.clear(); events.length = 0; checks = 0; certificate = undefined;
  const parentPath = join(directory, "parent.mp4");
  await writeFile(parentPath, "parent fixture");
  const parent = { finalMaster: { r2Key: `${keyPrefix}runs/${runId}/parent.mp4`, sha256: await fileHash(parentPath), durationSec: 60 },
    certificateFingerprint: "parent-fingerprint", ...(legacy ? {} : { yue2AssemblySource: source }) };
  const parentKey = certificateKey(keyPrefix, runId, parent.certificateFingerprint);
  objects.set(parentKey, Buffer.from(JSON.stringify(parent)));
  return { ownerId: "short-owner", channelId: "short-channel", runId, keyPrefix, budgetUsd: 1,
    params: { shortDurSec: 10, crosspostShort: true }, log: () => {}, store: {
      videoLocalPath: parentPath, videoKey: parent.finalMaster.r2Key, title: "Quiet history", qaPassed: true,
      qualityEvidence: {}, finalMasterReleaseCertificateKey: parentKey, contentLane: contentLaneForFamily("narrated_stock"),
      sentenceTimings: [{ text: "A clear opening sentence", start: 0, end: 10 }],
      yue2AssemblySource: { ...source, approvalFingerprint: "f".repeat(64) },
    } } satisfies StageContext;
}
async function main() {
  directory = await mkdtemp(join(tmpdir(), "short-yue2-authority-"));
  const { shortsSpinoff } = load("../lofiBlocks") as typeof import("../lofiBlocks");
  const success = await shortsSpinoff.run(await setup());
  assert.equal(success.shortVideoId, "fixture-video");
  assert.deepEqual(certificate?.yue2AssemblySource, source, "inherit only the verified parent, never the ambient store");
  assert.equal(checks, 6);
  assert.ok(events.indexOf("authority:2") < events.indexOf("review"));
  assert.ok(events.indexOf("authority:4") < events.indexOf("connector"));
  assert.equal(events[events.indexOf("upload") - 1], "authority:5");
  assert.equal(events[events.indexOf("crosspost") - 1], "authority:6");
  for (revokeAt of [1, 2, 3, 4, 5]) {
    await assert.rejects(shortsSpinoff.run(await setup()), /approval revoked/);
    assert.equal(events.includes("upload"), false);
    assert.equal(events.includes("crosspost"), false);
    if (revokeAt <= 2) assert.equal(events.includes("review"), false, "revoked permission must not buy a review");
    if (revokeAt <= 4) assert.equal(events.includes("connector"), false);
  }
  revokeAt = 6;
  assert.equal((await shortsSpinoff.run(await setup())).shortVideoId, "fixture-video");
  assert.equal(events.includes("upload"), true);
  assert.equal(events.includes("crosspost"), false, "revocation after upload still stops optional crossposting");
  revokeAt = 0;
  for (tamper of ["remove", "replace"] as const) {
    await assert.rejects(shortsSpinoff.run(await setup()), /derivative music source differs/);
    assert.equal(events.includes("connector"), false);
  }
  tamper = "none"; legacy = true;
  await shortsSpinoff.run(await setup());
  assert.equal(checks, 1, "legacy sources incur no extra source-authority requests");
  assert.equal(certificate?.yue2AssemblySource, undefined);
  tamper = "inject";
  await assert.rejects(shortsSpinoff.run(await setup()), /derivative music source differs/);
  assert.equal(events.includes("connector"), false);
  console.log("Short YuE2 source authority: real caller handoff, six boundaries, revocation and certificate substitution passed");
}
void main().finally(async () => {
  loader._load = originalLoad; globalThis.fetch = originalFetch;
  if (directory) await rm(directory, { recursive: true, force: true });
}).catch(error => { console.error(error); process.exitCode = 1; });
