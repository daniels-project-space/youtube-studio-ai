# VPS split migration map

Status: design and local safety changes in progress. Neither VPS-first app nor
the release handoff is operational yet. The existing cloud deployment and the
older VPS site remain the current services; do not transfer their traffic or
data on the strength of this document.

## Ownership

| Concern | Current source | Target owner | Migration boundary |
| --- | --- | --- | --- |
| Channel identity, pipeline, configuration and locks | `convex/channels.ts`, `convex/schema.ts` | YouTube Automation | Preserve each channel and snapshot its selected settings; do not bulk apply an upgrade. |
| Runs, stages, invocation snapshots and video library | `convex/runs.ts`, `convex/videos.ts`, `src/engine/runner.ts`, `src/trigger/runPipeline.ts` | YouTube Automation | Preserve run and artifact identity, leases, retry and cost records; validate import counts and hashes. |
| YouTube connections, publish intents and approvals | `convex/youtubeAuth.ts`, `convex/publishIntents.ts`, `src/lib/publishDispatcher.ts` | YouTube Automation | Isolate credentials; reconcile connector identity and preserve manual release gates. |
| Module catalog, design, compiler and candidate evaluations | `src/engine/moduleCatalog.ts`, `src/engine/pipelineCompiler.ts`, `src/trigger/designChannelInception.ts` | YouTube Studio AI | Separate personal channel records from candidate data; do not write live Automation channels. |
| Executable blocks and artifact contracts | `src/engine/registry.ts`, `src/engine/moduleContracts.ts`, `src/trigger/blocks/` | Versioned execution component | Retain exact executable build and dependencies for every approved release; never resolve an unpinned default as immutable. |
| Final media and receipt | `src/lib/storage.ts` | Requesting project | Output to its R2 bucket and verify object hash and receipt; local disk is bounded scratch only. |
| Project navigation | Project Hub `src/lib/apps.ts`, `src/lib/app-icons.tsx`, `convex/projects.ts` | Project Hub | Two verified VPS links and distinct entries; app catalog and project records are separate. |

## Local runtime selection

The current UI and workers directly use Convex and Trigger. Select and qualify
self-hosted implementations or local replacements before moving real data.
Convex's self-hosted backend can preserve its existing query model. Trigger's
documented self-hosted v4 lacks cloud checkpointed waits; worker occupancy,
child tasks, idempotency, version pinning and recovery need real qualification
under this app's long-running workload before choosing it. Measure VPS memory,
disk and concurrency; do not share or disturb another project's database.

The two apps need independent state and service credentials. Import a verified
snapshot to the Automation instance only after establishing an idempotent,
reversible mapping and checking channel, run, connector and artifact counts.
Never copy cloud credentials into a client bundle or source repository. Keep
the original system authoritative until private local end-to-end evidence and
the transition have been reviewed.

## Release handoff

Studio AI creates a candidate containing its ordered modules, exact executable
versions, settings, capability contracts, policy version, worker build digest
and test evidence. Automation validates that the named build is available and
compatible and requires an explicit channel-specific approval before it can
activate the candidate. Keep the previous executable build for rollback. A
failed validation must not fall back to the current default implementation.

Local changes in this worktree make the Doctor's fleet sync and legacy sync
entry points preview-only, and make the architect task proposal-only. They are
not yet a persisted release registry, approval UI, installed worker build or
complete protection against every possible direct channel write.

## Outstanding proof

Establish two independent VPS apps and data stores; qualify the selected local
job runner and authenticated UI; verify the import; implement the release
handoff and rollback; then generate and inspect one private existing-channel
video and its R2 receipt. Validate Project Hub links and readiness from the
actual interface. Public publishing and scheduling remain gated.
