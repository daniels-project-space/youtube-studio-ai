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
