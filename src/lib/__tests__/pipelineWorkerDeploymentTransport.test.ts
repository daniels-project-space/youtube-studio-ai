import assert from "node:assert/strict";
import {
  claimAutomaticResume,
  claimInvocationSnapshot,
  listAutomaticResumeCandidates,
  listDueSerializedProgramEpisodeRetries,
  listPendingPublishContinuations,
} from "../../../convex/runs";
import { claimNextPlanRun } from "../../../convex/contentPlan";
import { listPendingResumes as factualResumes } from "../../../convex/factualReviewCheckpoints";
import { listPendingResumes as musicResumes } from "../../../convex/musicAuditionCheckpoints";
import { verifiedWorkerDeploymentFields } from "../../../convex/pipelineWorkerDeploymentTransport";
import { createChannelMusicProgram } from "@/engine/channelMusicProgram";
import { createMusicAuditionCheckpoint } from "@/engine/musicAuditionCheckpoint";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import type { PipelineInvocationSnapshot } from "@/lib/pipelineInvocationSnapshot";
import { createNarrativeSeriesRunSelector } from "@/lib/narrativeSeriesRunAdmission";

const ownerId = "owner_transport";
const channelId = "channels:transport";
const runId = "runs:transport";
const workerDeployment = { version: "20260919.1", projectId: "proj_original", environmentId: "env_original" };
type Row = Record<string, unknown> & { _id: string; ownerId: string; channelId: string };

function snapshot(pinned: boolean): PipelineInvocationSnapshot {
  return {
    version: 1, ownerId, channelId, runId, source: "channel",
    entries: [{ block: "music" }], seedStore: {}, budgetUsd: 10,
    keyPrefix: `owner/${ownerId}/runs/${runId}/`, remoteBlocks: [], defaultRetries: 2,
    compilationFingerprint: "a".repeat(64), compilationPolicyId: "production-contract",
    compilationPolicyVersion: "2", compilationModules: [{ id: "music", version: "1.0.0" }],
    compilationCapabilities: [], reservedMaxCostUsd: 5,
    ...(pinned ? { workerDeployment } : {}),
  };
}

function harness(pinned: boolean) {
  const invocation = snapshot(pinned);
  const run: Row = {
    _id: runId, ownerId, channelId, status: "failed", startedAt: 1,
    pipelineInvocationSnapshot: invocation,
    pipelineInvocationSha256: pipelineInvocationSha256(invocation),
    // A mutable lookalike field must never become dispatch authority.
    workerDeployment: { ...workerDeployment, version: "forged-row-version" },
  };
  const channel: Row = { _id: channelId, ownerId, channelId, status: "active", identity: { cadence: "daily" }, schedule: {} };
  const tables: Record<string, Row[]> = { runs: [run], channels: [channel] };
  let writes = 0;
  const db = {
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => Object.values(tables).flat().find(row => row._id === id) ?? null,
    patch: async (id: string, patch: Record<string, unknown>) => {
      writes++;
      const row = await db.get(id);
      assert(row);
      Object.assign(row, patch);
    },
    query: (table: string) => {
      let rows = [...(tables[table] ?? [])];
      const range = {
        eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return range; },
        lte: (key: string, value: number) => { rows = rows.filter(row => typeof row[key] === "number" && (row[key] as number) <= value); return range; },
        gt: (key: string, value: number | undefined) => { rows = rows.filter(row => value === undefined ? row[key] !== undefined : (row[key] as number) > value); return range; },
      };
      const query = {
        withIndex: (_name: string, build: (indexRange: typeof range) => unknown) => { build(range); return query; },
        order: () => query,
        take: async (limit: number) => rows.slice(0, limit),
        first: async () => rows[0] ?? null,
        collect: async () => rows,
      };
      return query;
    },
  };
  const ctx = { db, auth: { getUserIdentity: async () => ({ subject: "service:youtube-studio-ai", role: "service", owner_id: ownerId }) } };
  const invoke = <T = Record<string, unknown>>(definition: unknown, args: unknown): Promise<T> =>
    (definition as { _handler: (ctx: unknown, args: unknown) => Promise<T> })._handler(ctx, args);
  return { run, channel, tables, invoke, writes: () => writes };
}

function assertBinding(row: Record<string, unknown>, pinned: boolean) {
  if (pinned) assert.deepEqual(row.workerDeployment, workerDeployment);
  else assert.equal(Object.hasOwn(row, "workerDeployment"), false, "historical omission must remain absent");
}

function seedMusic(h: ReturnType<typeof harness>) {
  const program = createChannelMusicProgram({
    channelId, channelIdentityFingerprint: "b".repeat(64), family: "music_loop", contentLaneKey: "music_loop",
    topic: "Rain", providerPreference: "minimax_music3", durationSec: 20,
  });
  const digest = "c".repeat(64);
  const checkpoint = createMusicAuditionCheckpoint({
    ownerId, channelId, runId, invocationSha256: h.run.pipelineInvocationSha256 as string,
    channelMusicProgramKey: `owner/${ownerId}/runs/${runId}/audio/program.json`,
    musicRuntimeReceiptKey: `owner/${ownerId}/runs/${runId}/audio/runtime.json`,
    musicNativeWavKey: `owner/${ownerId}/runs/${runId}/audio/minimax-music3-native-${digest}.wav`,
    program,
    runtimeReceipt: { programFingerprint: program.fingerprint, durationSec: 20,
      output: { contentSha256: digest, byteLength: 2560044, sampleRateHz: 32000, channels: 2, codec: "pcm_s16le" } },
  });
  Object.assign(h.run, {
    status: "awaiting_music_audition", musicAuditionState: "approved", musicAuditionResumeState: "pending",
    musicAuditionCheckpointId: "music:checkpoint", musicAuditionCheckpointFingerprint: checkpoint.checkpointFingerprint,
    musicAuditionQualityReceiptFingerprint: "d".repeat(64), musicAuditionApprovalFingerprint: "e".repeat(64),
    musicAuditionQualityReceiptKey: "quality.json",
  });
  h.tables.musicAuditionCheckpoints = [{
    _id: "music:checkpoint", ownerId, channelId, runId, decision: "approved", checkpoint,
    qualityReceiptFingerprint: h.run.musicAuditionQualityReceiptFingerprint,
    approvalFingerprint: h.run.musicAuditionApprovalFingerprint, qualityReceiptKey: "quality.json",
  }];
  h.tables.runStages = [{ _id: "stage:music", ownerId, channelId, runId, block: "music", status: "ok", outputs: {
    musicProvider: "minimax_music3", channelMusicProgramKey: checkpoint.channelMusicProgramKey,
    musicRuntimeReceiptKey: checkpoint.musicRuntimeReceiptKey, musicNativeWavKey: checkpoint.musicNativeWavKey,
  } }];
}

async function main() {
  for (const definition of [claimAutomaticResume, listDueSerializedProgramEpisodeRetries]) {
    const schema = JSON.parse((definition as unknown as { exportReturns: () => string }).exportReturns());
    const fields = schema.type === "array" ? schema.value.value : schema.value;
    assert.deepEqual(fields.workerDeployment, {
      optional: true,
      fieldType: { type: "object", value: Object.fromEntries(
        ["version", "projectId", "environmentId"].map(key => [key, { fieldType: { type: "string" }, optional: false }]),
      ) },
    });
  }
  for (const pinned of [false, true]) {
    const h = harness(pinned);
    assertBinding(verifiedWorkerDeploymentFields(h.run), pinned);
    const before = JSON.stringify(h.run);
    const candidates = await h.invoke<Record<string, unknown>[]>(listAutomaticResumeCandidates, { ownerId, now: Date.now() });
    assert.equal(candidates.length, 1);
    assertBinding(candidates[0], pinned);
    assert.equal(JSON.stringify(h.run), before);
    const claim = await h.invoke(claimAutomaticResume, { ownerId, channelId, runId, now: Date.now() });
    assertBinding(claim, pinned);
    assertBinding(await h.invoke(claimAutomaticResume, { ownerId, channelId, runId, now: Date.now() }), pinned);
    assert.equal(h.run.pipelineInvocationSha256, pipelineInvocationSha256(snapshot(pinned)));
    h.run.publishContinuationState = "pending";
    assertBinding((await h.invoke<Record<string, unknown>[]>(listPendingPublishContinuations, { ownerId }))[0], pinned);

    const serial = harness(pinned);
    Object.assign(serial.run, { status: "queued", serializedProgramEpisodeRetryAt: 10, serializedProgramEpisodeRetryAttempts: 1 });
    const receipts = await serial.invoke<Record<string, unknown>[]>(listDueSerializedProgramEpisodeRetries, { ownerId, now: 20 });
    assert.equal(receipts.length, 1);
    assertBinding(receipts[0], pinned);
    assert.equal(receipts[0].invocationSha256, serial.run.pipelineInvocationSha256);
    assert.equal(receipts[0].attempt, 1);
    assert.equal(receipts[0].retryAt, 10);
    serial.run.pipelineInvocationSha256 = "0".repeat(64);
    assert.deepEqual(await serial.invoke(listDueSerializedProgramEpisodeRetries, { ownerId, now: 20 }), []);

    const factual = harness(pinned);
    Object.assign(factual.run, {
      status: "awaiting_factual_review", factualReviewState: "approved", factualReviewResumeState: "pending",
      factualReviewCheckpointId: "factual:checkpoint", factualReviewCheckpointFingerprint: "b".repeat(64),
      factualReviewApprovalFingerprint: "c".repeat(64),
    });
    const factualRows = await factual.invoke<Record<string, unknown>[]>(factualResumes, { ownerId });
    assert.equal(factualRows.length, 1);
    assertBinding(factualRows[0], pinned);
    factual.run.pipelineInvocationSha256 = "0".repeat(64);
    assert.deepEqual(await factual.invoke(factualResumes, { ownerId }), []);

    const music = harness(pinned);
    seedMusic(music);
    const musicRows = await music.invoke<Record<string, unknown>[]>(musicResumes, { ownerId });
    assert.equal(musicRows.length, 1);
    assertBinding(musicRows[0], pinned);
    music.run.pipelineInvocationSha256 = "0".repeat(64);
    assert.deepEqual(await music.invoke(musicResumes, { ownerId }), []);

    for (const recovery of [false, true]) {
      for (const planned of [false, true]) {
        const scheduler = harness(pinned);
        Object.assign(scheduler.run, { status: recovery ? "failed" : "queued", leaseRecoveryPending: recovery });
        if (planned) {
          Object.assign(scheduler.run, { planItemId: "plan:transport", plannedTopic: "Topic", plannedTitle: "Title", plannedThumbnailKey: "thumbnail.png" });
          scheduler.tables.contentPlan = [{ _id: "plan:transport", ownerId, channelId, status: "ready",
            scheduledRunId: runId, topic: "Topic", title: "Title", thumbnailKey: "thumbnail.png", order: 1 }];
        }
        const result = await scheduler.invoke(claimNextPlanRun, { ownerId, channelId, dueBefore: Date.now() + 60_000 });
        assert.equal(result.state, planned ? "claimed" : "cadence");
        assert.equal(result.runId, runId);
        assert.equal(result.reused, true);
        assertBinding(result, pinned);
        assert.equal(scheduler.writes(), 0);
      }
      const serialScheduler = harness(pinned);
      const narrativeSeriesSelector = createNarrativeSeriesRunSelector({
        version: "narrative-series-run-selector/v1", seriesPlanFingerprint: "a".repeat(64),
        seriesIdentity: "series", routeFingerprint: "b".repeat(64),
        routeRunSeedFingerprint: "c".repeat(64), programBriefFingerprint: "d".repeat(64),
      });
      serialScheduler.channel.identity = { narrativeSeriesPlan: { fingerprint: narrativeSeriesSelector.seriesPlanFingerprint } };
      Object.assign(serialScheduler.run, { status: recovery ? "failed" : "queued", leaseRecoveryPending: recovery, narrativeSeriesSelector });
      const serialResult = await serialScheduler.invoke(claimNextPlanRun, { ownerId, channelId, narrativeSeriesSelector, dueBefore: Date.now() + 60_000 });
      assert.equal(serialResult.state, "cadence");
      assert.equal(serialResult.reused, true);
      assertBinding(serialResult, pinned);
      assert.equal(serialScheduler.writes(), 0);
    }

    // A plan-linked run excluded from the ordinary queue index is found by
    // the later scheduledRunId lookup, which must retain the same binding.
    const linked = harness(pinned);
    const scheduledAt = Date.now() + 4 * 60 * 60_000;
    Object.assign(linked.run, { status: "queued", thumbnailRefreshSourceRunId: "runs:source",
      planItemId: "plan:linked", plannedTopic: "Topic", plannedTitle: "Title", plannedThumbnailKey: "thumbnail.png", plannedPublishAt: scheduledAt });
    linked.tables.contentPlan = [{ _id: "plan:linked", ownerId, channelId, status: "ready", order: 1,
      scheduledRunId: runId, topic: "Topic", title: "Title", thumbnailKey: "thumbnail.png", scheduledAt }];
    const linkedResult = await linked.invoke(claimNextPlanRun, { ownerId, channelId, dueBefore: scheduledAt + 60_000 });
    assert.equal(linkedResult.state, "claimed");
    assert.equal(linkedResult.reused, true);
    assertBinding(linkedResult, pinned);
    assert.equal(linked.writes(), 0);

    const fresh = harness(pinned);
    delete fresh.run.pipelineInvocationSnapshot;
    delete fresh.run.pipelineInvocationSha256;
    Object.assign(fresh.run, { status: "running", leaseOwner: "worker", executionAttempts: 1, leaseExpiresAt: Date.now() + 60_000 });
    const args = { ownerId, channelId, runId, leaseOwner: "worker", executionLeaseToken: 1,
      snapshot: snapshot(pinned), sha256: pipelineInvocationSha256(snapshot(pinned)) };
    const claimed = await fresh.invoke(claimInvocationSnapshot, args);
    assertBinding(claimed.snapshot as Record<string, unknown>, pinned);
    assert.deepEqual(fresh.run.pipelineInvocationSnapshot, claimed.snapshot);
    assert.equal((await fresh.invoke(claimInvocationSnapshot, args)).reused, true);
    const altered = { ...snapshot(pinned), workerDeployment: { ...workerDeployment, version: "replacement" } };
    await assert.rejects(fresh.invoke(claimInvocationSnapshot, { ...args, snapshot: altered, sha256: pipelineInvocationSha256(altered) }));
  }

  const notStarted = harness(false);
  delete notStarted.run.pipelineInvocationSnapshot;
  delete notStarted.run.pipelineInvocationSha256;
  notStarted.run.status = "queued";
  assertBinding(await notStarted.invoke(claimNextPlanRun, { ownerId, channelId, dueBefore: Date.now() + 60_000 }), false);
  assert.equal(notStarted.writes(), 0);

  for (const badVersion of ["", " 20260919.1", "20260919.1 "]) {
    const fresh = harness(false);
    delete fresh.run.pipelineInvocationSnapshot;
    delete fresh.run.pipelineInvocationSha256;
    Object.assign(fresh.run, { status: "running", leaseOwner: "worker", executionAttempts: 1, leaseExpiresAt: Date.now() + 60_000 });
    await assert.rejects(fresh.invoke(claimInvocationSnapshot, {
      ownerId, channelId, runId, leaseOwner: "worker", executionLeaseToken: 1,
      snapshot: { ...snapshot(true), workerDeployment: { ...workerDeployment, version: badVersion } },
      sha256: "a".repeat(64),
    }), /worker deployment/);
    assert.equal(fresh.writes(), 0);
  }

  for (const changed of ["hash", "owner", "run", "channel", "version", "empty", "whitespace", "partial"]) {
    const h = harness(true);
    const invocation = structuredClone(h.run.pipelineInvocationSnapshot) as PipelineInvocationSnapshot;
    if (changed === "hash") h.run.pipelineInvocationSha256 = "0".repeat(64);
    else if (changed === "owner") invocation.ownerId = "other";
    else if (changed === "run") invocation.runId = "other";
    else if (changed === "channel") invocation.channelId = "other";
    else if (changed === "partial") delete h.run.pipelineInvocationSha256;
    else invocation.workerDeployment!.version = changed === "empty" ? "" : changed === "whitespace" ? " 20260919.1" : "replacement";
    h.run.pipelineInvocationSnapshot = invocation;
    assert.throws(() => verifiedWorkerDeploymentFields(h.run));
    if (changed === "partial") {
      assert.equal((await h.invoke(claimAutomaticResume, { ownerId, channelId, runId, now: Date.now() })).state, "blocked");
    } else {
      await assert.rejects(h.invoke(claimAutomaticResume, { ownerId, channelId, runId, now: Date.now() }));
    }
    assert.equal(h.writes(), 0);
    h.run.status = "queued";
    await assert.rejects(h.invoke(claimNextPlanRun, { ownerId, channelId, dueBefore: Date.now() + 60_000 }));
    assert.equal(h.writes(), 0);
  }
  console.log("pipeline worker deployment transport tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
