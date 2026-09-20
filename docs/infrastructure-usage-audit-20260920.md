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
