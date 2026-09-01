import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const schema = source("convex/schema.ts");
const ledger = source("convex/runArtifactRetentions.ts");
const upload = source("src/trigger/blocks/lofiBlocks.ts");
const sweeper = source("src/trigger/runArtifactRetentionSweeper.ts");

assert.match(
  schema,
  /runArtifactRetentions: defineTable\([\s\S]*?awaiting_release[\s\S]*?by_owner_status_retain_until/,
  "retention must have a durable release-aware table and indexed due-work queue",
);
assert.match(
  ledger,
  /requireStudioServiceIdentity\(ctx, args\.ownerId, "run artifact retention scheduling"\)[\s\S]*?releaseEvidenceStatus !== "release_evidence_recorded"[\s\S]*?expectedChannelKeyPrefix[\s\S]*?validateRunArtifactRetentionObjectKeys/,
  "scheduling must require service identity, exact run evidence, owned channel prefix, and run-local certificate keys",
);
assert.match(
  ledger,
  /existing[\s\S]*?immutable schedule[\s\S]*?claimDue[\s\S]*?leaseToken[\s\S]*?complete[\s\S]*?completion lease is missing, expired, or mismatched/,
  "schedule replay and cleanup completion must be immutable and lease fenced",
);
assert.match(
  ledger,
  /Browser projection only[\s\S]*?status: row\.status[\s\S]*?retainedObjectCount: row\.retainedObjectCount/,
  "the browser projection must not expose storage keys, worker errors, or cleanup leases",
);
assert.match(
  upload,
  /artifactRetentionRelease[\s\S]*?private_draft[\s\S]*?runArtifactRetentions\.schedule/,
  "the upload route must carry its actual release mode into retention scheduling",
);
assert.doesNotMatch(
  upload.slice(upload.indexOf("export const cleanup"), upload.indexOf("All lofi blocks")),
  /deleteObjects|assets\.pruneRun/,
  "the pipeline cleanup block must never delete uploaded-run artifacts immediately",
);
assert.match(
  sweeper,
  /cron: "17 \* \* \* \*"[\s\S]*?concurrencyLimit: 1/,
  "deferred cleanup must run serially on a bounded hourly cadence",
);
assert.match(
  sweeper,
  /parseFinalMasterReleaseCertificateBytes[\s\S]*?pruneRunObjectsWithVerifiedFinalMasterEvidence[\s\S]*?assets\.pruneRun[\s\S]*?runArtifactRetentions\.complete/,
  "the worker must reload release certificates, verify/prune R2, prune asset rows, and only then complete the ledger",
);

console.log("run artifact retention wiring tests passed");
