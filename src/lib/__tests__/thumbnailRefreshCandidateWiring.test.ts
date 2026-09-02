import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const schema = read("convex/schema.ts");
const convex = read("convex/thumbnailRefresh.ts");
const route = read("src/app/api/thumbnail-refresh/route.ts");
const task = read("src/trigger/thumbnailRefreshCandidate.ts");
const replay = read("src/lib/thumbnailRefreshReplay.ts");
const successor = read("src/lib/thumbnailRefreshSuccessor.ts");
const moduleContracts = read("src/engine/moduleContracts.ts");

assert.match(schema, /thumbnailRefreshSourceRunId: v\.optional\(v\.id\("runs"\)\)/);
assert.match(schema, /by_owner_thumbnail_refresh_source/);
assert.match(schema, /by_owner_thumbnail_refresh_dispatch/);
assert.match(schema, /by_channel_thumbnail_refresh_source/);
assert.match(schema, /by_channel_status_thumbnail_refresh_source/);
assert.match(convex, /export const createCandidateShell = mutation/);
assert.match(convex, /await requireStudioServiceIdentity\(ctx, args\.ownerId, "thumbnail refresh candidate shell"\)/);
assert.match(convex, /thumbnailRefreshSourceRunId: source\._id/);
assert.match(convex, /thumbnailRefreshDispatchState: "awaiting_approval"/);
assert.match(convex, /material: replay\.material/);
assert.match(convex, /refreshMaterial\.material\.replayFingerprint/);
assert.match(convex, /assessThumbnailRefreshSuccessor/);
assert.match(convex, /ready_for_private_successor/);
assert.match(convex, /Retired legacy videos cannot purchase replacement thumbnails/);
assert.match(convex, /export const importErnieBatchCandidate = mutation/);
assert.match(convex, /thumbnail-ernie-batch-import/);
assert.match(convex, /providerRoute !== "ernie-image-novita-4090"/);
assert.match(convex, /thumbnailRefreshDispatchState: "consumed"/);
assert.match(convex, /pipelineInvocationSha256: run\.pipelineInvocationSha256/);
assert.match(convex, /export const consumeCandidateDispatch = mutation/);
assert.doesNotMatch(
  convex.match(/export const createCandidateShell = mutation\(\{([\s\S]*?)\n\}\);/)?.[1] ?? "",
  /ctx\.db\.patch\(source\._id/,
  "candidate allocation must never patch the source run",
);

assert.match(route, /confirmCandidateSpend must be true/);
assert.match(route, /action: "thumbnail-refresh-candidate"/);
assert.match(route, /sourceChanged: false/);
assert.match(route, /youtubeChanged: false/);
assert.match(route, /shell\.dispatchState === "consumed"/);
assert.doesNotMatch(route, /setThumbnail|youtube\.thumbnails|videos\.update/);

const contentPlan = read("convex/contentPlan.ts");
const channels = read("convex/channels.ts");
assert.match(
  contentPlan,
  /by_channel_status_thumbnail_refresh_source[\s\S]*?thumbnailRefreshSourceRunId", undefined/,
  "packaging candidates must not block normal cadence admission",
);
assert.match(
  channels,
  /by_channel_thumbnail_refresh_source[\s\S]*?thumbnailRefreshSourceRunId", undefined/,
  "packaging candidates must not distort channel output cards",
);

assert.match(task, /id: "thumbnail-refresh-candidate"/);
assert.match(task, /getCandidateExecution/);
assert.match(task, /verifyStudioActionApproval/);
assert.match(task, /validatePipeline\(entries, Object\.keys\(seedStore\)\)/);
assert.match(task, /preflight\(resolved, \{ budgetUsd: sealed\.maximumCostUsd \}\)/);
assert.match(task, /runPipeline as runEngine/);
assert.match(task, /makeConvexSink\(convex, payload\.ownerId, executionLease\)/);
assert.match(task, /id: "thumbnail-refresh-dispatcher"/);
assert.match(task, /scope: "global"/);
assert.doesNotMatch(task, /youtube|upload_draft/i);

for (const key of [
  "styleDNA",
  "thumbnailPlaybook",
  "channelProgramRoute",
  "contentLane",
  "criticDoctrine",
  "competitors",
  "seoDatabank",
  "scenarioVisualTreatment",
]) {
  assert.match(replay, new RegExp(`"${key}"`), `frozen replay store must retain ${key}`);
  assert.match(moduleContracts, new RegExp(`"${key}"`), `thumbnail ABI must declare ${key}`);
}
assert.match(moduleContracts, /const iterations[\s\S]*Math\.min\(3/);
assert.match(moduleContracts, /return iterations \* \(/);
assert.match(replay, /hashPipelineInvocation\(normalized\) === input\.pipelineInvocationSha256/);
assert.match(successor, /one current thumbnail module/);
assert.match(successor, /createPackageToOpeningPlan/);
assert.match(successor, /replayFingerprint: sha256Hex\(canonicalJson\(materialWithoutFingerprint\)\)/);

console.log("thumbnail refresh candidate wiring: PASS");
