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

On 17 November 2026 the cached official Convex backend binary
`precompiled-2026-10-22-1447815` passed a disposable localhost qualification:
a synthetic function was deployed, a record was written and read, and the
same record survived a backend restart. Run `scripts/qualify-local-convex.py`
with `--backend` pointing to the binary to repeat it. This does not prove the
Studio schema, real authentication, import, production recovery, backup or
capacity. The official GHCR image registry returned HTTP 403 from this VPS;
the binary is an evaluated alternative, not an image deployment.

Studio's signing code and Convex authentication configuration now accept
deployment-specific `STUDIO_CONVEX_ISSUER`, `STUDIO_CONVEX_JWKS_URL`, and
`STUDIO_CONVEX_AUDIENCE` values, while retaining the existing production
defaults. Use distinct issuer, audience and signing keys for each project and
set matching values in its app and backend. Never expose the private key.
The local configuration and signed-token behavior have unit evidence only;
real backend verification and private owner authentication remain required.

Follow-up on 17 November 2026: the full Automation Convex schema and functions
were deployed to a disposable loopback backend from an isolated source copy.
The real Studio signer produced a service JWT accepted for its own owner;
anonymous and cross-owner queries and channel mutations were refused. A real
channel mutation created one synthetic draft, and the channel survived a
backend restart. Repeat with `scripts/qualify-local-studio-convex.py --backend
<absolute-binary-path>` (Python `cryptography` is required). The proof removes
its temporary data and uses a throwaway key. It does not authenticate a human,
import actual channels, deploy a persistent service, or run a video job.

The two apps need independent state and service credentials. Import a verified
snapshot to the Automation instance only after establishing an idempotent,
reversible mapping and checking channel, run, connector and artifact counts.
Never copy cloud credentials into a client bundle or source repository. Keep
the original system authoritative until private local end-to-end evidence and
the transition have been reviewed.

On 17 November 2026 an owner-scoped read-only capture retrieved 13 channels
and four connector status records, using the production Trigger environment's
service identity and cross-checking the deployment URL against the Hub Vault.
The protected local snapshot is
`/var/lib/youtube-automation/baselines/channels-2026-11-17T13-28-06-834Z.json`
(root-owned, mode 0600; SHA-256
`4183f97434de9ae89fcef1e89e20d735df3c1c895fb9ee67368c3af8dda7464e`).
Independent readback matched the source channel and connector status records.
Every channel was paused, and every stored pipeline entry was unversioned.
The two source queries are separate, not an atomic database snapshot. This is
configuration and connector metadata only: it does not contain connector
secrets, run history or media, and it does not freeze executable worker builds.
Use `scripts/capture-channel-baselines.ts --capture` with the Vault-injected
production Trigger key, project ref and expected Convex URL to capture again.
The production Trigger schedules API returned zero schedules at the same
inspection. This is not proof about other scheduling systems or future state.

The saved pipelines passed the current structural flow compiler without
adding or removing blocks; policy completion left their stored entries and
parameters unchanged. This does not verify runtime configuration, worker
availability, duration, audio quality or actual video output.

The read-only `scripts/audit-channel-narration.ts` check materializes the
saved channel module controls and applies Automation's new preflight. Six
channels with `narration_tts` require an explicit Qwen provider. Chalk &
Compound's `whiteboard_scribe` selects Fish/ElevenLabs, while Inked Histories'
`motion_comic` invokes ElevenLabs dialogue; neither has a qualified Qwen path
yet. The other five captured pipelines have none of these inspected blocks;
that is not a provider or output readiness claim. Automation now rejects these
unqualified narration paths before running pipeline blocks. Saved channels
and selected voices are not silently rewritten. Qwen integration for the
specialist modules and channel-level voice selection remain required work.
The separate `plan-week-prepared-narration` task is not covered by the
`run-pipeline` preflight and still accepts non-Qwen providers. Its existing
prepared-narration sidecar does not carry provider provenance; it needs its
own fail-closed admission and a migration-safe receipt before that path can be
declared Qwen-only. Do not enable that preparation flow as an Automation
shortcut until it is fixed and verified.

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
