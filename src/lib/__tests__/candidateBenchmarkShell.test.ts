import assert from "node:assert/strict";
import { createShell, assertRouteQualificationBenchmarkDispatchLease } from "../../../convex/routeQualificationBenchmarkRuns";
import { channelPipelineWriteFence } from "@/lib/channelPipelineWriteFence";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

async function main() {
  const channel = { _id: "channel-a", ownerId: "owner-a", family: "music_loop", pipeline: [{ block: "music" }], moduleConfig: {} };
  const baselineFingerprint = channelPipelineWriteFence(channel);
  const content = { version: "duration-draft-candidate/v3", ownerId: "owner-a", channelId: "channel-a", baselineFingerprint, family: "music_loop", requestedSeconds: 60, baselineModuleConfig: {}, moduleConfig: {}, pipeline: [{ block: "music", params: { duration: 60 } }], sourceInception: null };
  const candidate = { ...content, _id: "draft-a", status: "untested", fingerprint: sha256Hex(canonicalJson(content)) };
  const target = { candidateId: "draft-a", fingerprint: candidate.fingerprint, baselineFingerprint };
  const records: Record<string, unknown> = { "channel-a": channel, "draft-a": candidate };
  let inserted: Record<string, unknown> | undefined;
  const ctx = {
    auth: { getUserIdentity: async () => ({ role: "service", owner_id: "owner-a" }) },
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => records[id] ?? null,
      query: () => ({ withIndex: () => ({ unique: async () => inserted ? { ...inserted, _id: "run-a" } : null }) }),
      insert: async (_table: string, row: Record<string, unknown>) => { inserted = row; return "run-a"; },
    },
  };
  const invoke = (args: unknown) => (createShell as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler(ctx, args);
  const args = { ownerId: "owner-a", channelId: "channel-a", dispatchKey: "request-a", candidate: target, now: 1 };
  assert.deepEqual(await invoke(args), { state: "created", runId: "run-a" });
  assert.deepEqual(inserted?.routeQualificationBenchmarkCandidate, target);
  assert.deepEqual(await invoke(args), { state: "shell", runId: "run-a" });
  await assert.rejects(() => invoke({ ...args, candidate: undefined }), /different candidate/);
  await assert.rejects(() => invoke({ ...args, ownerId: "owner-b" }), /owner access denied/);
  await assert.rejects(() => invoke({ ...args, candidate: { ...target, fingerprint: "a".repeat(64) } }), /unavailable or changed/);
  records["channel-a"] = { ...channel, budget: 999 };
  await assert.rejects(() => invoke(args), /unavailable or changed/);
  assert.throws(() => assertRouteQualificationBenchmarkDispatchLease({ routeQualificationBenchmarkCandidate: target } as never, {}), /worker admission is not available/);
  console.log("Candidate benchmark shell: ownership, immutable target, stale baseline and worker denial passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
