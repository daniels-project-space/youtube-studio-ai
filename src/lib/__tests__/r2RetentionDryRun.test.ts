import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";

const loader = Module as unknown as { _load: (id: string, ...args: unknown[]) => unknown };
const originalLoad = loader._load;
const now = Date.UTC(2026, 8, 27);
const keyPrefix = "owner/daniel/channel/show/";
const runId = "run-1";
const key = `${keyPrefix}runs/${runId}/introcard-${"a".repeat(64)}.mp4`;
const lastModified = new Date(now - 40 * 24 * 60 * 60 * 1_000);
const etag = '"immutable-object"';
const api = { r2Retention: {
  pendingExpirationsPage: Symbol("pending-expirations"),
  runScopesPage: Symbol("run-scopes"),
  protectedKeysPage: Symbol("protected-keys"),
} };
let head: { etag?: string; lastModified?: Date; metadata: Record<string, string> } | null = null;
let headReads = 0;
let mutations = 0;
let deletes = 0;

loader._load = function(id, ...args) {
  if (id.includes("convex/_generated/api")) return { api };
  if (id === "@/lib/bootstrap") return { bootstrapSecrets: async () => [] };
  if (id === "@/lib/finalMasterReleaseCertificate") return {
    parseFinalMasterReleaseCertificateBytes: () => ({ finalMaster: { r2Key: `${keyPrefix}runs/${runId}/final.mp4` } }),
    retainedFinalMasterReleaseObjectKeys: () => [],
  };
  if (id === "@/lib/youtubeR2Account") return { assertYouTubeStudioR2Account: () => undefined };
  if (id === "@/lib/r2RetentionProtectedKeys") return { loadR2RetentionProtectedKeys: async () => new Set<string>() };
  if (id === "@/lib/studioConvexHttpClient") return { StudioConvexHttpClient: class {
    async query(reference: unknown) {
      if (reference === api.r2Retention.protectedKeysPage) return { page: [], isDone: true, continueCursor: "" };
      if (reference === api.r2Retention.runScopesPage) return { page: [scope], isDone: true, continueCursor: "" };
      throw new Error("dry run must not query pending expiration intents");
    }
    async mutation() { mutations++; throw new Error("dry run must not mutate Convex"); }
  } };
  if (id === "@/lib/storage") return {
    deleteObjects: async () => { deletes++; throw new Error("dry run must not delete R2 objects"); },
    getObjectBytes: async () => Buffer.from("fixture certificate"),
    headObjectMetadata: async () => { headReads++; return head; },
    listObjectRecords: async () => [{ key, lastModified, etag }],
  };
  if (id === "@/lib/youtubeConnector") return { requireYouTubeConnector: async () => { throw new Error("dry run must not call YouTube"); } };
  if (id === "@/lib/youtube") return { getAccessToken: async () => { throw new Error("dry run must not call YouTube"); } };
  if (id === "@/lib/youtubeReleaseObservation") return { fetchRunArtifactReleaseObservations: async () => { throw new Error("dry run must not call YouTube"); } };
  if (id === "@/lib/runArtifactRetention") return { RUN_ARTIFACT_RELEASE_OBSERVATION_MAX_AGE_MS: 60_000 };
  return originalLoad.call(this, id, ...args);
};

const scope = {
  runId, channelId: "channel-1", releaseVideoId: "video-1", keyPrefix,
  runStatus: "ok", retentionStatus: "completed", releaseAt: now - 40 * 24 * 60 * 60 * 1_000,
  retainUntil: now - 10 * 24 * 60 * 60 * 1_000, finishedAt: now - 40 * 24 * 60 * 60 * 1_000,
  channelLocked: false, certificateKey: `${keyPrefix}runs/${runId}/certificate.json`,
  additionalCertificateKeys: [], keepNames: [], retainedReleaseEvidence: [], assets: [],
};

async function main() {
  const names = ["YOUTUBE_STUDIO_R2_ACCOUNT_ID", "R2_BUCKET", "NEXT_PUBLIC_CONVEX_URL"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  process.env.YOUTUBE_STUDIO_R2_ACCOUNT_ID = "verified-account";
  process.env.R2_BUCKET = "youtube-studio-ai";
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://fixture.convex.cloud";
  head = { etag, lastModified, metadata: { retentionIntroSha256: "a".repeat(64), retentionWriter: "intro-card/v1" } };
  const { sweepR2AssetRetention } = createRequire(import.meta.url)("../../trigger/r2AssetRetentionSweeper") as typeof import("../../trigger/r2AssetRetentionSweeper");
  try {
    headReads = 0; mutations = 0; deletes = 0;
    const valid = await sweepR2AssetRetention({ now, dryRun: true });
    assert.equal(valid.expiredAssets, 1, "a fresh exact HEAD and matching immutable writer proof is counted");
    assert.equal(valid.expiredFinals, 0);
    assert.equal(valid.deleted, 0);
    assert.equal(headReads, 1, "dry run performs one read-only HEAD for the proposed asset");
    assert.equal(mutations, 0);
    assert.equal(deletes, 0);

    headReads = 0;
    head = { etag: '"replaced-object"', lastModified, metadata: { retentionIntroSha256: "a".repeat(64), retentionWriter: "intro-card/v1" } };
    const replaced = await sweepR2AssetRetention({ now, dryRun: true });
    assert.equal(replaced.expiredAssets, 0, "changed object identity is excluded");
    assert.equal(headReads, 1);

    headReads = 0;
    head = { etag, lastModified, metadata: { retentionIntroSha256: "b".repeat(64), retentionWriter: "intro-card/v1" } };
    const unproven = await sweepR2AssetRetention({ now, dryRun: true });
    assert.equal(unproven.expiredAssets, 0, "mismatched content digest is excluded");
    assert.equal(headReads, 1);
    assert.equal(mutations, 0, "all dry-run paths remain read-only in Convex");
    assert.equal(deletes, 0, "all dry-run paths remain read-only in R2");
    console.log("R2 retention dry-run integrity tests passed");
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    loader._load = originalLoad;
  }
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
