# Infrastructure usage audit - 2026-09-20

## Scope and constraints

User priority: reduce shared Trigger, Convex, and Vercel usage before further
testing. Thumbnail generation is excluded from tests; do not change the thumbnail
module. Preserve legacy channels/pipelines, channel personality, output quality,
approval gates, exact artifact lineage, and GPU shutdown safeguards. No provider
deployments, activation, publishing, paid generation, or provisioning in this audit.
Tests were paused on this instruction. Findings below are not implemented savings.

## Evidence baseline

Read-only production Trigger schedule inventory returned 24 schedules. Ten active
production schedules use `* * * * *`:

- `music-audition-continuation-dispatcher`
- `bundle-fanout-dispatcher`
- `factual-review-continuation-dispatcher`
- `reviewed-data-story-initial-dispatcher`
- `serialized-program-episode-retry-dispatcher`
- `route-qualification-benchmark-dispatcher`
- `automatic-thumbnail-replacement-dispatcher` (excluded from changes)
- `thumbnail-refresh-dispatcher` (excluded from changes)
- `openrelay-h3-idle-reaper` (safety critical)
- `openrelay-qwen-idle-reaper` (safety critical)

At configured cadence this represents 432,000 starts per 30 days. The six
non-thumbnail delivery dispatchers account for 259,200. These are cadence
estimates, not measured monthly billed runs or promised dollar savings.

A bounded production runs API sample at 2026-09-20T20:15:22Z returned 100 newest
runs spanning 20:05-20:15 UTC, with another page available. It is not a complete
hour or a random sample. It contained 57 runs of the six delivery dispatchers,
18 failed OpenRelay reaper runs (nine each), and one executing H3 reaper. Completed
dispatcher status does not prove no work was done. Failure reasons were not
retrieved; do not attribute these failures solely to historical credential issues.
No unchanged OpenRelay credentials were retried directly.

Convex and Vercel billing exports were not obtained. Their findings are supported
by source behavior, not a measured share of total spend. Provider API credentials,
run payloads, and log contents are intentionally not included here.

## Priority 1: Event-driven durable delivery

Replace six independent minute dispatchers with transactional durable outbox
wakeups and one bounded recovery mechanism. Enqueue when work is created or its
lease expires; coalesce duplicate wakeups. Keep payloads as identifiers, not large
snapshots. Claim indexed due work in bounded batches.

Source: `src/trigger/musicAuditionContinuationDispatcher.ts`,
`bundleFanoutDispatcher.ts`, `factualReviewContinuationDispatcher.ts`,
`reviewedDataStoryInitialDispatcher.ts`, `serializedProgramEpisodeRetryDispatcher.ts`,
and `routeQualificationBenchmarkDispatcher.ts` (under `src/trigger/`).
Music performs a queued-resume reaper mutation plus pending-resume query each tick;
bundle's empty tick is one indexed read. Do not assume every dispatcher has the
same database cost.

Potential impact: remove most of the 259,200 monthly delivery polling starts when
idle, plus their associated Convex calls. Recovery and useful deliveries still
cost resources. A single five-minute recovery sweep would be 8,640 starts/month,
96.7% fewer than those six loops, but is only an illustrative architecture budget:
existing delivery deadlines must be proven compatible before choosing cadence.

Required invariants: atomic claims, lost-wakeup recovery, retry backoff,
idempotency keys, approval/checkpoint ownership, fencing, exact worker deployment
pins, bounded queue age, and no duplicate paid generation. Do not transfer the
same minute polling to another paid platform and call that a saving.

Keep GPU reapers separate. Investigate repeated failures with bounded diagnostics
and an actionable alert. Any authentication circuit breaker must preserve an
independent means of detecting/stopping orphaned paid instances. The Novita
provider orphan scan cannot be skipped just because Convex has no leases.

## Priority 2: Compact Convex live state

`convex/channels.ts:listChannels` returns full channel documents. The global
`src/components/ChannelSwitcher.tsx` needs only ID, slug, name, and avatar-related
identity fields, not pipelines, reports, or full personality data.

Introduce a small owner-scoped channel directory maintained transactionally with
channel changes; use it in lightweight consumers. A projected query over the same
large documents reduces response bytes but does not remove large database reads
or their invalidation dependencies. Keep full personality and pipeline data for
the modules and editors that actually need them. Identical Convex subscriptions
can share work, so caller count is not a reliable cost multiplier.

`convex/runStages.ts:listRunStages` reads full stage documents before applying
`slim`. Split frequently changing status/progress from large inputs/results;
hydrate stage details on demand. Preserve immutable resume snapshots and artifact
references. Avoid duplicating large payloads into the summary table.

`src/components/LogConsole.tsx` subscribes to a 500-line tail even while closed.
Pause/follow currently changes scrolling, not subscription activity. First make
closed consoles lazy, preserving useful closed-state summaries via compact
counts. Then retain full forensic logs in immutable chunks with cursor-based
access rather than repeatedly reading a large live tail. The sink already batches
mutation calls; `convex/runLogs.ts` still inserts one document per line.

Success metrics: database bytes read/written, returned bytes, query re-executions,
and subscriptions per open/closed view. Do not reduce observability by silently
discarding warnings, errors, or audit logs.

## Priority 3: Remove repeated media work from Vercel

`src/app/api/asset-video/route.ts` is a fallback proxy, not the route for all
playback. Its probe can make three range checks per attempt over five attempts,
up to 15 object GETs. Range fallback can stream an entire master. These retries
exist for reliability reasons and must not simply be deleted.

Use private direct storage delivery or an authorized media gateway with correct
Range/CORS behavior. Vercel should authenticate and issue scoped access, not relay
large immutable bytes where avoidable. Cache upload-time availability receipts
against object identity/version; invalidate when the object changes. Measure the
actual fallback traffic before estimating savings.

`src/app/api/asset-image/route.ts` downloads image bytes even for probes; its size
cap is checked after the read, and probe handling returns before that cap. Bound
reads during transfer and reuse immutable availability evidence. This is shared
delivery infrastructure, not thumbnail generation work.

The YuE candidate review reader downloads and verifies the native WAV and invokes
FFprobe/FFmpeg on repeated review GETs. Generalize a content-addressed quality
receipt computed once by the worker or ingestion path, keyed by artifact digest
and validator version. Web review can validate the receipt and sign playback
access. Changed artifacts, missing receipts, or new validators must fail closed
or require revalidation. Technical receipts never replace artistic/personality
review or human approval.

Success metrics: Vercel transferred bytes, invocation CPU/duration, repeated
validation count per artifact/version, storage GET count, and playback errors.

## Priority 4: Independent deployment fingerprints

`.github/workflows/ci.yml` deploys both Convex and Trigger for each eligible main
release. Introduce per-surface dependency-aware fingerprints so UI-only changes
do not rebuild unchanged worker images and backend-only changes do not rebuild
unrelated surfaces. Include shared code, lockfiles, runtime assets, configuration,
and security updates. Keep serialization and stale-release checks already present.

Crucially, a skipped deployment must reference its actual previous successful
deployment receipt, not claim that the newest source SHA is deployed. Preserve
worker pinning and cross-version compatibility for pending jobs.

## Avoid false savings claims

- Learning refresh, SEO reoptimization, generation scheduler, weekly niche
  research refresh, and six-hour stats refresh are already inactive in the live
  inventory. Disabling them again is not a saving.
- GPU polling already uses checkpoint-aware waits in `src/lib/novitaPollWait.ts`;
  parent orchestration already uses child `triggerAndWait`. Do not count all
  wall-clock waiting as paid compute.
- Parent `runPipeline` machine sizing deserves measurement, but do not blindly
  downsize rendering or lower precision/models to save cost.
- Review route bundle tracing was already reduced from 47,777 to 345 files in
  commit `3c9daa34`, excluding 529 graph files. This is an implemented packaging
  improvement, not evidence of a particular monthly bill reduction.

## Implementation sequence and verification gate

1. Establish a bounded baseline from provider usage exports and dispatcher
   useful-work/empty-tick counters; avoid per-line telemetry amplification.
2. Implement compact directory/live-stage contracts and lazy log subscriptions.
3. Migrate one durable delivery path to event wakeups, preserving recovery and
   exact idempotency; expand to the other five only after proving its contract.
4. Add immutable validation receipts and direct authenticated media delivery.
5. Add per-surface release fingerprints and measure safe machine sizing.

Testing was paused until this audit identified the general improvements. Use
non-generating fixtures and bounded integration checks: no thumbnail generation,
no paid provider work, no publishing. Validate duplicate/lost deliveries, expired
leases, stale deployment pins, unauthorized reads, artifact replacement, range
playback, and missing receipts before any separately authorized deployment.
Keep legacy pipeline outputs unchanged for later before/after comparison.

## Provider references

- Trigger run-list API and pagination: https://trigger.dev/docs/management/runs/list
- Trigger schedule inventory: https://trigger.dev/docs/management/schedules/list
- Convex dependency tracking and caching: https://stack.convex.dev/queries-that-scale
- Vercel cache eligibility: https://vercel.com/docs/caching/cdn-cache
- Vercel transfer usage: https://vercel.com/docs/manage-cdn-usage

## First implementation batch

Closed `LogConsole` instances now pass Convex's `skip` sentinel instead of
subscribing to 500 persisted lines. Opening restores the subscription. Closed
headers explicitly say `Log feed paused`, without asserting clean or zero logs;
live-follow indicators are disabled while closed. Failed and blocked runs retain
their existing initially-open behavior. The run-detail caller keys the console by
run ID so disclosure state cannot carry across different runs.

Full persisted log storage and the open console's warning/error counts are
unchanged. A compact closed-state count record remains future work. Presentation
regression cases were initially added without execution during the audit pause. This batch
is not deployed; production savings and browser behavior remain unverified.

## Second implementation batch

Shared image delivery now passes its 25 MiB cap into the streaming storage
reader, including availability probes. A typed size-limit failure prevents a
second download attempt; display requests return 413 and probes return unavailable.
Oversized ContentLength headers are rejected before consumption, and headerless
overruns are stopped during transfer by the existing bounded reader.

Overlapping reads of the same owner-validated key share one promise per server
instance, including their transient retry. At most four distinct reads are kept
in this coalescing map; overflow still works without coalescing. This bounds map
bookkeeping, not total server concurrency or memory. All settled promises are
removed, so failures can recover and replaced artwork is read afresh. No completed
byte cache, distributed cache, HEAD dependency, or direct-browser delivery change
is introduced. Savings depend on request overlap within a server instance.

Real-handler fixture cases cover coalescing, mutable-key freshness, size rejection,
retry sharing, failure cleanup, owner rejection, and distinct-key isolation. They
perform no generation. After the audit was complete, 25 local checks passed across
the image handler fixtures, existing image/video source contracts, bounded storage
reader, and log-console presentation. Scoped ESLint and repository TypeScript
checking (`tsc --noEmit --incremental`) also passed. No provider calls
or thumbnail generation were involved. This batch is not deployed; browser and
production behavior remain unverified. Broader delivery and validation-receipt
work remains open.

## Third implementation batch

`bundleFanoutDispatcher` and `serializedProgramEpisodeRetryDispatcher` no longer
invoke the general provider secret bootstrap. Their real execution paths use only
the authenticated Studio Convex client, pure receipt builders, and Trigger SDK
delivery. The Convex JWT private key is a deployment input in `trigger.config.ts`;
the client does not obtain it from provider hydration. Missing deployment
credentials still fail closed. Generation workers retain their own bootstrap.

Previously, each cold dispatcher process attempted to hydrate 21 service namespaces
before checking its outbox. `hydrateEnv` queries the central vault even when all
the corresponding provider keys are already in the environment. Successful reads
are cached only within the process. Removing this work avoids unnecessary vault
Convex requests, response bytes, and Trigger execution time; it also keeps unrelated
generation credentials out of these delivery-only paths.

At two minute schedules, the cold-per-tick upper-bound scenario is 86,400 starts
times 21 namespaces = 1,814,400 vault requests per 30 days. This is not an observed
billing total: warm process reuse, absent vault access, and failures affect actual
calls. The vault is a separate Convex deployment from the Studio application.
Schedule count, cadence, outbox queries, and GPU safeguards are unchanged by this
batch; event-driven dispatch remains the larger follow-up.

Seven local checks passed across real-body provider-isolation fixtures and existing
bundle/serialized/worker-pin contracts. Fixtures reject any bootstrap/provider
import and exercise empty ticks, immutable bundle delivery, enqueue failure
deferral, busy claims, serialized worker pins, and foreign-project rejection.
Scoped ESLint and repository TypeScript checking also passed. No external API or
generation was invoked. Deployment and production savings are not yet verified.

## Fourth implementation batch

Two indexed recovery paths now avoid unnecessary reads and starvation:

- Serialized episode retries explicitly exclude missing retry timestamps before
  applying the due-time upper bound and 25-row cap per lifecycle state. Previously,
  ordinary queued/failed runs could fill both batches because Convex sorts missing
  fields before numbers. Filtering those rows after `take` could leave real retries
  undiscovered indefinitely, as well as reread unrelated full run documents.
- Music queued-resume recovery now has separate bounded slices for explicit due
  deadlines and missing-deadline legacy receipts, matching factual-review recovery.
  Future explicit deadlines are excluded by the index. Legacy rows cannot consume
  the entire batch ahead of expired modern receipts. Legacy timestamp fallback and
  all existing approval/integrity checks are unchanged.

No index migration, table change, new cron, or schedule slowdown is required.
The serialized fixture contains 200 ordinary runs plus two due retries and one
future retry; only the two due rows are materialized. The music fixture contains
100 legacy rows, an expired row, and a future row; with limit two, it reads the
expired row plus two legacy rows, not the future row. These are local controlled
read counts, not measured production bandwidth. Existing schemas are respected.

Seven checks passed across index-bound regressions, Convex authorization, worker
deployment transport, and music checkpoint wiring. The new harness models
Convex's missing-field ordering rather than JavaScript's `undefined <= number`.
Repository TypeScript checking and scoped ESLint also passed.
See https://docs.convex.dev/database/types for the provider ordering contract.
Production behavior and savings remain unverified until an authorized deployment.

## Fifth implementation batch

The serialized cloud-release job now runs its existing stale-revision policy
immediately after checkout, before Node setup/cache restoration and `npm ci`.
Superseded releases skip those steps. A second check still runs after installation
and directly before the Convex/Trigger deployment steps, so a main-branch advance
during installation cannot use an outdated admission decision.

This uses the existing built-in-only Node/Git policy and preserves trusted-SHA
validation, the verified docs-only exception, protected deployment credentials,
release queue serialization, and fail-closed remote errors. It does not skip
quality checks or cancel running deployments. The real-Git/real-CLI release-policy
test and parsed workflow wiring checks pass. No remote deployment was performed.

Per-runtime unchanged-source skipping is still unfinished. The workflow currently
has no verified per-runtime deployed-source receipt, and a previous successful CI
run alone is insufficient: missing credentials or stale policy can skip the actual
deployment. Add durable, independently verified Convex and Trigger receipts before
using runtime fingerprints to authorize reuse of a prior deployment.

## Sixth implementation batch

`channels:listChannelDirectory` now returns an explicit validated projection:
channel ID, name, slug, and identity image key/niche/palette. The global channel
switcher, Library filter, and SEO niche selector use this same query and owner
argument. Their types no longer pretend they require a complete channel record.
The existing `listChannels` query is unchanged for modules and full-context views.

The query preserves the existing owner authorization wrapper and indexed owner
filter. It does not mutate or truncate stored channel personality, pipeline,
budget, or architect data. A large-context fixture verifies more than 99% smaller
serialized output for that fixture only, absence of excluded fields, unchanged
full-query output, missing-artwork behavior, and rejection of owner spoofing before
database access. This is not a measured fleet-wide saving.

This projection reduces returned/subscription payload, not database document-read
bytes: it still reads full channel documents. A maintained compact directory table
is needed to remove those reads and unrelated document invalidations. Existing
identical subscriptions can already share work; do not multiply savings by the
number of mounted consumers.

Directory handler/wiring, Convex authorization, and operator UI contract checks
passed, as did repository TypeScript checking and scoped ESLint. The operator
contract now also asserts the run-keyed LogConsole introduced in the first batch.
No generation, deployment, or production bandwidth measurement was performed.
Deployment order must put the new Convex query live before the web callers.

## Seventh implementation batch: shared recovery schedule

`src/trigger/sharedDeliveryRecovery.ts` directly invokes the six existing
non-thumbnail delivery handlers in one scheduled task. It does not create six
child Trigger runs. Each handler retains its existing indexed queries, approval
checks, claims, bounded attempts, global idempotency, and worker-version logic.
The current project/environment context is forwarded to the three handlers that
require it. Rejected handlers do not prevent others from starting; the aggregate
waits for all settlements, then fails with handler names rather than arbitrary
provider error bodies. Aggregate automatic retries are disabled; durable outboxes
remain the retry authority on the next scheduled tick.

`STUDIO_DELIVERY_RECOVERY_MODE` is explicit: absent or `individual` retains the six
existing schedules; `shared` declares only the shared schedule. Invalid values
fail task declaration. Disabled task wrappers return before touching any outbox,
covering stray/manual invocations of the new-version tasks. Existing running old
versions are not cancelled and retain their original behavior and global keys.
Thumbnail dispatchers and GPU reapers are not part of this mode.

At a minute cadence, six schedules become one: 259,200 -> 43,200 starts per 30
days, or 216,000 fewer (83.3% for these six). This does not reduce the number of
underlying Convex calls or eliminate polling. Event-driven durable wakeups remain
unfinished. The default remains individual and no deployment/configuration change
has been made; no production saving is claimed.

### Activation prerequisites

1. Obtain deployment/activation authorization. Keep the mode consistent between
   task indexing and runtime; do not change only a live worker environment setting.
2. Verify realistic six-outbox batch latency, concurrent SDK calls, and transport
   stalls in an isolated environment. Shared recovery now inherits the project
   ceiling, preserving serialized recovery's previous limit (currently 7,200
   seconds), rather than imposing a new 120-second cutoff. This ceiling does not
   bound individual requests or prove that a batch completes within one cadence.
   Promise settlement isolates rejection, not CPU hangs or process termination.
3. Deploy with the intended mode and inspect the live schedule inventory. Trigger
   synchronizes declarative cron additions/removals on deployment; separately
   reconcile any manually created schedules. Confirm exactly one active shared
   schedule and zero active individual schedules for these six task IDs. An old
   schedule producing no-op runs is not a cost reduction.
4. Verify approved deliveries, expired-queue recovery, worker pins, and queue age
   from actual receipts. No new generation or publication may be admitted merely
   to benchmark the dispatcher. Compare scheduled starts and compute separately.
5. Roll back by deploying consistent `individual` mode, verifying all six old
   schedules and no shared schedule. Never merely disable every recovery schedule.

Local tests cover declarations in both modes, disabled-wrapper zero-work behavior,
invalid-mode rejection, context transport, six-handler invocation, synchronous
failure isolation, waiting for unfinished handlers, and aggregate error redaction.
Existing individual delivery, review, serialized, benchmark, and worker-pin checks
also passed. TypeScript and scoped ESLint passed. Provider synchronization, load,
and production behavior remain unverified.

Provider schedule semantics: https://trigger.dev/docs/tasks/scheduled

## Eighth implementation batch: live schedule verification

`scripts/verify-delivery-recovery-schedules.mjs` is a GET-only migration verifier.
It reads all schedule pages with a bounded page count and request timeout, checks
pagination completeness, and requires two agreeing observations. It verifies the
explicit production environment and exact recovery task set/cadence. Missing,
duplicate, wrong-mode, wrong-cadence, or manually managed recovery schedules fail.
Unrelated thumbnail and GPU safety schedules are outside its scope and unchanged.
It neither creates/deletes schedules nor triggers tasks or edits provider state.

From the repository, with the production read credential already present locally:

```sh
node --env-file=.env.local scripts/verify-delivery-recovery-schedules.mjs --mode individual --environment cmpu4i98gfghqn70jp33s1diz
```

Use `--mode shared` after separately authorized deployment/synchronization. A zero
exit proves only the observed schedule inventory, not handler load, delivery,
worker version, billing, or deployment health. The output explicitly states this.
It does not output API credentials or raw provider error bodies.

Live read-only verification on 2026-09-20 at 20:54:20 UTC passed individual mode:
exactly the six expected active minute schedules in the production environment.
At 20:54:21 UTC, shared-mode verification correctly failed with exit 1: all six
individual schedules remain active and the shared schedule is absent. Production
therefore has not received the shared-mode savings. This negative check is expected,
not an outage. Six local verifier tests and scoped ESLint also passed.

## Implementation Batch 9: Reuse Verified Native Audio Analysis

The retained YuE review reader now coalesces and reuses successful native probe
and full-file signal measurements in a process-local, eight-entry cache keyed by
the exact audio receipt and native result. Each request still reads and verifies
the complete receipt chain and fresh WAV hash before cache lookup. Channel
personality, requested duration, unresolved artistic checks, and approval remain
outside the cache; production approval remains false.

Failures are evicted, returned measurements are cloned, and only settled entries
can be evicted for another key. Overflow runs uncached when all entries are
pending: this bounds retained entries, not total concurrent analysis. No WAV bytes
are intentionally retained as cached results. Restart/deployment clears the cache.

Local integration checks use real FFprobe and signal analysis with synthetic WAV
fixtures, including concurrent reuse, fresh storage reads, post-cache tampering,
mutation isolation, failure retry, distinct artifacts, and eviction. This reduces
repeat analysis CPU only within a warm process; it does not reduce WAV download
bandwidth or guarantee cross-instance reuse. No paid generation, thumbnails, or
production deployment is part of this batch. Production savings remain unmeasured.

## Implementation Batch 10: Bound Serialized Recovery Delivery Concurrency

The existing serialized-episode recovery handler now services its same maximum
50 receipts with at most four concurrent delivery chains. Previously a rejected
receipt ended the entire loop; now other selected receipts are serviced and all
started work settles before the first failure is reported. A foreign or malformed
worker pin still fails before idempotency-key creation or enqueue. Frozen payloads,
global keys, channel concurrency keys, and not-before times are unchanged.

This applies to both individual and shared mode. It adds no database reads,
mutations, provider bootstrap, task children, or generation admission. The shared
task inherits the project duration ceiling to avoid shortening the old serialized
handler's allowance. The aggregate still has one attempt; shared mode is not active.

Deterministic delayed-transport tests execute the real handler and payload builders:
four calls remain in flight, one fails, the other 49 selected receipts complete,
and receipt 51 is not dispatched. Another case rejects a foreign worker while
delivering the valid sibling. These prove concurrency and rejection isolation,
not production latency or billing savings. Hung calls can still occupy slots;
repeated poison receipts can still consume batch capacity. Durable retry backoff,
transport cancellation, and actual six-handler load verification remain open.

## Implementation Batch 11: Bound Prepared Music Transfers

The shared music executor validates prepared master size, digest type and duration
before storage I/O. Its master read now enforces the exact sealed byte length
during transfer, with the existing five-minute music-output download allowance.
The size ceiling matches the weekly receipt contract's 250,000,000-byte limit;
valid audio is not trimmed, recompressed, or replaced.

For the legacy MiniMax prepared route, runtime and quality JSON are each bounded
to 2 MiB/30 seconds and verified before fetching the additional native WAV. That
WAV transfer is then capped at the verified runtime receipt's exact byte length.
The existing provider pin, quality receipt, exact native hash, and release gates
remain enforced. Failed or corrupt reuse does not authorize new generation.

Actual shared-handler checks cover invalid bounds before I/O, exact transport
options, malformed receipts avoiding the native download, successful legacy reuse,
and corrupt-master refusal. The separate shared-storage tests exercise real stream
size/deadline cancellation. These are bounded resource-use guarantees and early
rejection improvements, not measured production bandwidth or billing savings.

## Offline Compatibility Sweep (Thumbnail Work Excluded)

The readiness runner now accepts `--exclude-thumbnail`, explicitly lists excluded
paths, and labels the result partial. The default CI gate still selects every
test. Selection is based on filenames, not a claim that all remaining integration
fixtures contain no thumbnail-related contract assertions. Live progress now
identifies completed tests without waiting for the whole sweep.

On September 20, an isolated Linux network namespace with only loopback enabled
ran 832 selected test files: 831 passed and one failed; 30 thumbnail-named files
were excluded. External provider access was unavailable, and no thumbnail
generation or paid generation was performed. Three selector checks also passed.
This is compatibility evidence, not full production readiness or a billing test.

The failure is `src/lib/__tests__/documotionQuoteCard.test.ts`: actual Remotion
quote-card rendering requests pinned Anton WOFF2 files from Google Fonts and
fails with `ERR_INTERNET_DISCONNECTED`. A targeted isolated rerun reproduced it.
The four font families currently use Remotion's native readiness loader; no
font substitution, relaxed layout checks, or renderer edits were made. Vendoring
the exact licensed font bytes while preserving loader readiness is follow-up
work, below the requested infrastructure-usage priority.

Shared recovery remains opt-in and unactivated. The six-to-one schedule change
would remove 216,000 starts per 30 days at one-minute cadence, but production
billing savings cannot be claimed until deployment, topology verification, and
observation. Thumbnail schedules and GPU safety reapers remain untouched.

## Implementation Batch 12: Atomic Continuation Preparation

Music-audition and factual-review delivery now each call one
`prepareResumeDispatch` Convex mutation instead of a recovery mutation followed
by a separate pending query. Plain shared helpers run the original bounded due
and legacy recovery scans, then select pending receipts in the same transaction.
The old endpoints remain for already-deployed workers and diagnostics. Both
individual schedules and the opt-in shared schedule use the new path.

This removes one function round trip per tick per lane: two rather than four
Convex calls on their combined idle tick, or 86,400 fewer calls per 30 days at
one-minute cadence. It does not remove the indexed database scans, guarantee
lower database bytes, or establish a dollar saving. The old separate query could
reuse Convex query-cache results; the transactional pending read cannot use that
separate cache and may therefore increase database reads. The larger transaction
may retry under contention; live cache, contention and billing measurements
remain open and must be compared before activation.
If pending selection fails, recovery writes now roll back with the transaction;
the next tick retries recovery and no Trigger delivery is authorized by that
failed response. Global delivery keys and execution fences still own concurrency.

Local actual-handler fixtures cover exact recovered envelopes, original worker
pins, repeat preparation without attempt consumption, bounded due/legacy reads,
service/owner isolation, invalid timestamps, and exhausted factual deliveries.
Actual dispatcher fixtures cover the single idle call, preparation failure,
accepted enqueue with a lost acknowledgement, enqueue failure accounting, and
unchanged same-run worker pins. These are controlled fixtures, not a deployed
Convex concurrency or paid-provider qualification. No thumbnail tests or
generation were run for this batch.

Deployment order remains Convex before Trigger: new workers require the new
endpoints, while old workers remain compatible with the retained endpoints.
No production deployment, schedule activation, or settings change was performed.

## Implementation Batch 13: Bounded Prepared Image Transfers

The weekly image producer previously verified every retained still with one
unbounded `Promise.all`, then copied all H3 conditioning frames the same way.
Both paths now admit at most four concurrent operations. On failure they stop
admitting new operations and drain already-started work before rejecting, so a
task retry cannot overlap abandoned local transfer/copy promises. Successful
create-only copies remain reusable; failures never authorize image replacement.

Retained stills, H3 source frames, and create-only collision reads now enforce
the exact receipt/source byte length during download with a five-minute deadline.
Fresh image downloads use the existing prepared-image contract's 50 MiB ceiling.
The shared image-stage consumer validates all receipt bounds and digests before
its first media read, then applies each exact byte cap. Hashes, candidate order,
generation quality, and native H3 inputs remain unchanged; no thumbnail code or
generation is involved.

Controlled storage fixtures execute the actual sidecar verifier, consumer
admission helper, and H3 copy/dispatch function. Twelve retained images produce
a measured peak of four active transfers; a failed transfer stops new admission,
waits for its three active siblings, and prevents H3 dispatch. Invalid later
receipts cause zero consumer media reads; changed bytes still fail their digest.
These are concurrency and transfer-bound proofs, not measured fleet RAM, latency,
or billing reductions. JSON manifest/sidecar reads remain a separate open bound.

## Implementation Batch 14: Compact Dashboard Stage Progress

`listRecent` and `listOverviewRuns` now use a separate per-run progress record
containing stage ID, block, status and optional start time. Previously both
queries loaded full `runStages` documents solely to calculate those fields.
The normal fenced stage upsert initializes this record only before a run's first
stage exists, and updates it in the same transaction as the authoritative ledger.
Self-heal updates existing and newly inserted stages together. Cost/output-only
writes leave the progress record unchanged; child-cost receipts do not affect
its fields. Channel deletion also removes the progress record.

Legacy runs are explicitly marked for full-ledger fallback, never represented by
a partial mirror. This avoids a large backfill, preserves old comparisons, and
means these runs do not receive the new read savings. Detailed stage views,
Pipeline Doctor, and resume readers remain unchanged and still read full rows.
Compact writes add a small row read per normal stage update, a first-write
enrollment probe, and a compact write only when progress changes. This trade-off
targets repeated dashboard reads and payload-driven subscription invalidations;
it is not a blanket reduction in database operations.

Actual mutation/query handler fixtures preserve progress across creation,
completion, timing changes, self-heal, legacy fallback, stale-worker rejection,
owner/viewer boundaries and remote-child cost updates. A two-stage fixture with
over 400,000 serialized characters of input/output data produces a progress record
under 1,000 characters; the actual dashboard/list queries perform zero `runStages`
reads for that enrolled run and match the old summary. These are fixture payload
sizes and logical reads, not production wire bytes or measured billing savings.

Deployment is pending. Deploy the complete Convex schema and all stage writers
together. A rollback must retain projection maintenance or invalidate the compact
records before restoring a writer that does not maintain them; otherwise the
new reader could trust stale progress after a later rollout. No bulk migration,
production mutation, thumbnail work or paid generation was performed.

The network-isolated compatibility sweep completed 835 selected test files:
834 passed and the unchanged DocuMotion Google Fonts fetch failed offline.
Thirty thumbnail-named files were excluded. Focused progress, enrichment,
stage-reuse, cost, self-heal, lease and authorization checks passed, as did
TypeScript and scoped lint. A subsequent focused cleanup fixture verifies the
new record follows channel deletion without deleting another run's record.
This is not a complete green production release gate.

## Implementation Batch 15: Remove Runtime Font CDN Dependency

The remaining offline gate failure came from DocuMotion fetching Google Fonts
during browser initialization. Six exact versioned WOFF2 files (215,364 bytes)
are now bundled locally, with original license texts and SHA-256 provenance.
All nine selected faces retain their family, weight, subset and Unicode ranges.
Remotion's native `loadFontFromInfo` lifecycle still blocks rendering until fonts
are ready. Unknown font URLs after a dependency update fail explicitly; there is
no CDN or substitute-font fallback. The acquisition script is maintenance-only,
not a build-time download. No thumbnail files or generation were changed.

This removes one external failure/retry source from renders at the cost of about
210 KiB of static font assets in the bundle. It does not remove local font reads,
prove fewer production retries, or establish dollar savings on any provider.
The existing quote-card fixture rendered all four styles at 1920x1080, 960x540
and 1080x1920 with external networking disabled. All twelve stills were visually
inspected: no missing text, clipping or attribution overlap. This is a typography
and layout regression check, not channel-specific artistic approval or a full
motion review. Detective-board red accents have weak visual contrast, especially
the small attribution, and remain a separate quality follow-up; no palette was
silently changed as part of this infrastructure fix.

Offline parity tests verify every selected face maps to the retained source
receipt, all font/license hashes and byte lengths match, shared metadata is not
mutated, and unvendored dependency changes fail closed. Render evidence is local
at `/tmp/youtube-studio-ai-documotion-quote-regression/`. Production deployment
and provider billing comparisons remain pending.

Final verification: all 836 selected readiness test files passed in the
network-isolated sweep, with 30 thumbnail-named files excluded. TypeScript,
scoped lint and authored-code whitespace checks passed. Vendored license texts
retain upstream whitespace and line endings to preserve their source hashes.
Graphify was refreshed after
code edits. This partial offline gate is not complete production readiness.

## Implementation Batch 16: Persist The Channel Navigation Index

Batch 6 reduced response size but still read every full channel document.
`listChannelDirectory` now reads a small owner readiness record and, once that
owner's backfill is complete, only `channelDirectory` rows for its current
generation. The response contract and existing Navigation/Library/SEO callers
are unchanged. Full channel personality, pipelines, reports and detail queries
remain authoritative and unmodified. Rows preserve channel creation order.

Creation, guarded name/slug/navigation-identity edits, and deletion maintain the
index in the same Convex transaction as the channel. Changes only to persona,
pipeline, status, inception, locks, or external YouTube facts do not touch the
index. A banner or other identity edit that leaves imageKey/niche/palette unchanged
also avoids index reads and writes. Channel locks and ownership checks still
precede writes; maintenance copies derived navigation fields, never changes a
locked channel or its creative configuration.

Legacy owners continue using the full-channel query until an explicit service-only
`channels.backfillChannelDirectory({ ownerId })` completes. Each call processes
at most four channels using a server-held cursor, commits those rows and cursor
together, and returns `processed`, `isDone`, and `generation`. Repeat with the
same owner until `isDone`; a completed call returns zero processed without
scanning channels. No caller-provided cursor can skip ahead. Concurrent creation,
editing and deletion use the same maintained records; queries never present an
incomplete backfill as the full directory. No production migration was run.

Deployment/rollback order:

1. Deploy the complete schema, channel writer helpers, and query together.
2. Using the existing owner-bound Studio service client, run the bounded backfill
   above for the intended owner and verify full-query/directory parity.
3. Before restoring old writers, call service-only
   `channels.invalidateChannelDirectory({ ownerId })` for each enrolled owner.
   This immediately restores full reads and advances the generation.
4. After redeploying maintained writers, backfill again. Old-generation orphan
   records from a rollback cannot reappear in navigation; they remain compact
   storage records until separately cleaned up. Do not re-enable a stale ready
   record manually or skip invalidation when rolling back.

Actual handler fixtures cover paged migration, incomplete fallback, create/reseed,
rename/art change, delete during/after migration, an empty owner's first channel,
no-op replay, owner/viewer/service authorization, locked-channel refusal, an
owner-conflicting projection, and old-writer rollback recovery. Their independent
source projection has exact field/order parity. On six large synthetic channels,
serialized read bytes fall by over 99% and navigation performs zero full-channel
reads after enrollment. These are logical handler reads and fixture JSON bytes,
not production storage billing, wire size, or measured subscription invalidations.

The trade-off is one small state read per directory query and, for changed
navigation identity, a state/index read plus a small write. Creation additionally
reads its newly inserted channel once. Migration is a one-time bounded scan;
legacy fallback retains full reads until explicitly enrolled. No Trigger task,
Vercel API, model, thumbnail generation, channel pipeline, or paid route changed.

Final local verification: all 837 selected readiness test files passed with
external networking disabled; 30 thumbnail-named files were excluded. Seven new
persistence cases, the existing directory and owner-lock suites, TypeScript,
scoped lint, whitespace checks and the post-edit Graphify refresh passed.
Production deployment, migration, reactive subscription measurement, and billing
comparison have not been performed. This is not the full production release gate.

## Implementation Batch 17: Pack Shared Run Logs Without Dropping Evidence

The existing `runLogSink` already batches HTTP mutations, but the mutation wrote
one database document and its repeated owner/run metadata per line. Eligible
new batches now write immutable `runLogChunks`: at most 25 lines and 64 KiB of
serialized UTF-8 line data per chunk. A per-run head is read and advanced in the
same transaction. Only a strictly newer `(at, seq)` range may become a chunk;
late or overlapping worker ranges stay individually indexed in `runLogs`.
Tiny packets (under four lines), oversized single messages, and non-finite legacy
values retain individual storage. No line, message, level or structured evidence
is truncated or discarded by packing. Existing best-effort sink transport failure
behavior is unchanged and is not promoted to durable audit delivery by this work.

The existing `listRunLogs` API merges the two storage forms using Convex's value
ordering, then returns the same newest-capped, oldest-first tail. Chunk-line IDs
are stable opaque strings, not IDs of individual `runLogs` documents; current
consumers use them only as display keys. Legacy row IDs remain unchanged.
Strictly disjoint chunk ranges allow the reader to stop after enough newest
chunk lines instead of scanning arbitrary overlapping batches. It reads at most
the requested legacy tail plus the requested chunk tail and one partial chunk
(up to 24 surplus lines). Mixed histories can therefore read more line content
than a single legacy tail; chunk-only new runs avoid that duplication. The reader
does not depend on the mutable write head. Channel deletion also removes its
chunks and head, leaving other channels/runs intact.

An actual sink-to-mutation fixture persists a 1,000-line synchronous burst as
40 immutable chunks plus one head (41 document writes instead of 1,000), with
one HTTP mutation in both old and new designs. Its 500-line query reads 20 chunk
documents. For that short-message fixture, stored serialized JSON shrinks by
over 20% from eliminating repeated document/owner/run fields. These are fixture
document counts and JSON bytes, not measured production billing or wire bytes;
large messages will show a smaller proportional saving. Ordinary 25-line flushes
use one chunk and one head write. Tiny batches keep one write per line and no
head read; overlapping eligible batches add a head read without write savings.

The independent chronological oracle covers legacy rows, late workers, reversed
arrival, rolled-back clocks, equal timestamps/sequence numbers, missing sequence
numbers, duplicate delivery, and multiple tail sizes. Byte-bound tests include
non-ASCII text and a 100 KiB message retained intact outside chunks. Additional
cases cover signed zero/non-finite legacy ordering, owner isolation, viewer
write refusal, and actual channel cleanup. The existing sink, API call sites,
LogConsole layout, thumbnail modules, provider routes and pipeline contracts are
unchanged. No log migration, deletion or cloud test was run in production.

Deploy schema, writer, merged reader and cleanup together. Rollback must retain
the merged reader and chunk cleanup even if writes return to individual rows;
an old reader alone would hide already-persisted chunk history. Do not delete
chunks to make an old deployment appear compatible. Historic individual rows
remain readable without a backfill. Production deployment, concurrent-transaction
qualification, observed fleet packing ratio and actual usage deltas remain open.

Final local verification: all 838 selected readiness files passed with external
networking disabled, with 30 thumbnail-named files excluded. The six new logging
cases, prior channel/progress cleanup suites, TypeScript, scoped lint, whitespace
checks and post-edit Graphify refresh passed. No production release or complete
production-readiness claim follows from this partial offline gate.

## Batch 18: Cancel abandoned private-video work

The shared `asset-video` route previously used independent 30-second storage
timeouts and non-cancellable retry waits. A client leaving a preview could leave
its aggregate proof (up to 15 GETs), retry loop or full-master fallback running.
The route now combines the incoming request signal with each existing storage
timeout, checks abandonment before and after signing, and cancels backoff waits.
The same signal remains attached to the upstream response body after headers,
so cancellation can stop a streaming full-source fallback as well as probes.
Aborted handlers return a non-cacheable 499 when a response is still possible.

Active requests retain the same three range checks, five attempts, signing-second
backoff, exact-range retries, source bytes and full-source recovery. No positive
availability cache was introduced: deleted or replaced objects still get fresh
checks. This does not remove Vercel media proxying or reduce successful playback
bytes; a direct private media gateway remains a separate larger opportunity.

Seven executable video cases plus the existing shared image/video contract and
six image-delivery cases pass offline (14 checks). They cover pre-aborted requests,
abort during signing, all three in-flight probes, real abortable backoff, unchanged
fallback/range behavior, and a real loopback HTTP response whose storage socket
closes after the downstream request signal aborts. TypeScript and scoped lint
pass. No generated media, thumbnails, paid providers or production requests were
used. The prior 838-file offline gate was not rerun for this route-only change.

This proves route-level cancellation, not deployed Vercel disconnect propagation
or a measured billing reduction. Provider disconnect behavior and actual avoided
bytes/duration require qualification after an authorized deployment. No model,
quality setting, channel pipeline, authentication boundary or schedule changed.

## Batch 19: Remove test media from native Trigger uploads

The production CI Trigger step now temporarily adds the root `/test-fixtures/`
exclusion to `.gitignore`, the policy actually consumed by pinned CLI 4.5.9's
native context archiver. An EXIT trap restores the original file on successful
and failed deployment, preserving the deployment exit code. This is confined to
the disposable CI checkout after the existing quality, credential, current-main
and canonical Convex deployment gates. It does not change the committed ignore
policy, delete fixture evidence, skip tests or alter manual deployment commands.
An uncatchable runner termination can leave the disposable checkout modified;
it does not change Git source or affect another checkout.

`scripts/verify-trigger-build-context.mjs` runs the installed CLI's local
`createContextArchive` function, not its unsafe native `--dry-run` deploy path.
It creates a disposable copy of tracked working-tree inputs, packages the old
context, executes the real parsed CI shell with an archive-only npm stand-in,
then compares SHA-256/size/type for every retained archive entry and checks the
original ignore bytes were restored. No credential or provider request is needed.
Run it from this repository with the absolute path to the installed pinned CLI's
`dist/esm/deploy/archiveContext.js`; the script verifies package name/version.

Measured locally with external networking disabled: compressed upload context
fell from 132,097,759 to 88,420,833 bytes (33.06%). Exactly 90 test-fixture files
were excluded; all 2,574 other archived files were byte-identical, apart from the
intentional temporary `.gitignore` policy. Public Golden references, fonts,
Remotion sources, Python renderers, requirements, locks and task sources remain.
These numbers measure archive transfer bytes, not final image size, live build
duration, task execution costs or provider billing. Current runtime sources and
packaged renderer scripts do not reference the removed fixture directory.

The actual-shell regression covers success/failure restoration, exact deploy
arguments, a known-bad baseline retaining media, rooted exclusion boundaries,
unchanged runtime/security policies and CI ordering. It and the existing release
policy/config suites pass offline, as does scoped lint. The full offline suite
was not repeated for a deployment-packaging-only change. Actual cloud build and
runtime qualification remain pending an authorized deployment; no deployment,
thumbnail generation or paid testing was performed. Safe unchanged-runtime
fingerprints/receipts remain open and were not replaced with JS-only hash skips.

## Batch 20: Resolve guarded media proxy URLs without a Vercel request

`resolveAssetUrl`, the shared client resolver used by media previews and players,
now derives the existing same-origin image/video proxy URL for a configured-owner
key with a supported extension and the proxy's length/traversal constraints.
Previously `/api/asset-url` performed no signing or Convex lookup for these
objects: it returned exactly that deterministic path after an extra HTTP request.
The media endpoints still enforce their own owner/key admission and availability
checks. A local URL is not proof that the asset exists or permission to bypass
those endpoints. No storage credentials enter the browser.

Audio, voice auditions, subtitle files, unknown formats and out-of-scope keys
retain the server resolver. Its shared pending requests, nine-minute signed-URL
cache, bounded eviction, invalidation, timeouts and failure recovery are unchanged.
Actual source bytes, native seeking, media probes and legacy pipelines are
unchanged. This eliminates the URL-resolution request for eligible media, not
the subsequent probe/media requests or R2 bandwidth. Browser cache hits already
avoided some previous invocations; no fleet billing percentage is inferred.

The executable parity test invokes the existing route handler independently for
all nine supported extension/case examples, including reserved URL characters.
The shared resolver returns exactly those URLs and resolves a 100-card corpus
with zero fetch/signing calls. Audio/shared auditions still call the real handler
fixture and retain cache reuse; foreign/traversal keys retain server rejection.
The existing cache/expiry/invalidation and media-selection suites also pass.

Actual React/Chromium proof passes all 13 cases with existing local image/video
bytes and external networking disabled. New cases cover owner image/video URLs
without signing requests and missing-proxy fallback; native playback decodes the
15-second frame. Existing cases cover source choice, denial, recovery, concurrent
resolution, expiry with stable mounted media and callback rerenders. The inspected
video screenshot is nonblank. This is functional media evidence, not a new render
or artistic-quality approval. Initial failures exposed an outdated proof server
returning binary media to availability probes; its response now models the JSON
receipt expected by the current component. Fatal failures now retain diagnostics.
Evidence: `/tmp/ysa-media-preview-proof-Pxt8E9/results.json` and adjacent screenshots.

No thumbnail generation, paid provider requests or deployment was performed.
Production invocation/latency measurements remain pending authorized deployment.

Final frozen local gate: all 841 selected readiness files passed with external
networking disabled and 30 thumbnail-named files excluded. TypeScript, scoped
lint, whitespace checks and the post-edit Graphify refresh passed. This is a
partial offline gate, not complete production readiness or production approval.

## Batch 21: Stop checkpoint read failures from repurchasing candidates

The shared narrated hook and entity-imagery iteration checkpoint reader previously
treated every read or JSON parse failure as a cache miss. An R2 outage, access
denial, missing credentials or damaged saved result could therefore initiate
another paid draft/extraction instead of retaining the existing work.

Only a `NoSuchKey` response with HTTP 404 now permits first-run production.
Missing buckets, ambiguous errors and corrupt receipts stop with the existing
non-retryable `PAID_STAGE_RECONCILIATION_REQUIRED` classification. JSON reads are
bounded to 1 MiB and 30 seconds, with fatal UTF-8 decoding and per-caller candidate
shape validation. Oversized metadata is held, never truncated or regenerated.
Finite nonnegative cost and optional nonempty receipt IDs are required; legacy
receipts without IDs retain their canonical-content accounting identity.
Saved candidates still undergo the existing quality review. No model, prompt,
quality threshold, channel configuration or legacy pipeline was changed.

The real registered blocks and pipeline runner pass 44 offline cases covering
access/storage failures, malformed payloads, both legacy/current receipt reuse,
and explicit absence. With three retries configured, each uncertain read causes
one read, no write, no automatic retry and zero paid draft/critic calls. Valid
hook reuse still calls its independent critic. Confirmed absence allows one
normal candidate purchase and checkpoint write. The existing ambiguous-provider
test now supplies an explicit missing-object fixture rather than relying on absent
storage configuration to masquerade as a cache miss.

This prevents one avoidable replay path, not exactly-once generation: writes are
still best-effort, and a genuinely absent receipt after a lost write or concurrent
first attempts is not covered by a pre-dispatch claim. No deployment, paid call
or thumbnail generation was performed. Production savings are not measured.

Final local gate: all 842 selected readiness files passed with external networking
disabled and 30 thumbnail-named files excluded. TypeScript, scoped lint, whitespace
checks and the post-code-edit Graphify refresh passed. This remains a partial
offline gate, not complete production readiness or production approval.
