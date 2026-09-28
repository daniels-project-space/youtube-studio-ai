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
  /id: "run-artifact-retention-sweeper"[\s\S]*?concurrencyLimit: 1/,
  "deferred cleanup must remain serial while its production cadence is frozen",
);
assert.match(
  sweeper,
  /parseFinalMasterReleaseCertificateBytes[\s\S]*?pruneRunObjectsWithVerifiedFinalMasterEvidence[\s\S]*?await authorizeNextBatch\(\)[\s\S]*?runArtifactRetentions\.complete/,
  "the worker must reload certificates, verify evidence, reauthorize release, and only then seal the ledger",
);
assert.doesNotMatch(sweeper, /deleteObjects|assets\.pruneRun/, "the hourly worker cannot delete mutable R2 keys or prune live asset rows");
assert.match(
  sweeper,
  /id: "studio-retention-maintenance"[\s\S]*?cron: studioRetentionMaintenanceCron\("17 3 \* \* \*"\)[\s\S]*?run: async \(\) => runStudioRetentionMaintenance\(\)/,
  "the dedicated schedule is gated independently and calls only maintenance work",
);
const maintenanceOnly = sweeper.slice(
  sweeper.indexOf("async function observeAndCopyReleasedFinalMasters"),
  sweeper.indexOf("async function runStudioRetentionMaintenance"),
);
assert.match(maintenanceOnly, /listReleaseChecks[\s\S]*?listFinalCopyChecks[\s\S]*?recordReleaseObservations[\s\S]*?createVerifiedReleasedFinalCopy/);
assert.doesNotMatch(maintenanceOnly, /claimDue|runArtifactRetentions\.complete|tasks\.trigger|run-pipeline|dispatch-publish-intent|shared-delivery-recovery|publishIntents/,
  "maintenance observation/copy work must never claim cleanup rows or dispatch render/publish tasks");
assert.match(
  sweeper,
  /id: "run-artifact-retention-sweeper"[\s\S]*?cron: studioScheduleCron\("17 3 \* \* \*"\)/,
  "the existing cleanup sweeper remains behind the global schedule gate",
);
assert.match(sweeper, /if \(!studioRetentionMaintenanceEnabled\(\)\) \{[\s\S]*?observeAndCopyReleasedFinalMasters[\s\S]*?\n  \}/,
  "the legacy cleanup sweep delegates only its observation/copy phase to dedicated maintenance");
assert.match(sweeper, /runRetentionMaintenanceHandoff\([\s\S]*?observe: \(\) => observeAndCopyReleasedFinalMasters[\s\S]*?cleanup: \(\) => sweepDueRunArtifactRetentions/,
  "the dedicated controller hands fresh observation state to globally gated cleanup in order");

console.log("run artifact retention wiring tests passed");
