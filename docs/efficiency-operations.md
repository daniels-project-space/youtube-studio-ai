# Studio build and cache operations

## Deployment inputs

`node scripts/deployment-inputs.mjs --write` derives this repository's website,
Convex and Trigger dependency closures. It follows emitted imports, literal
dynamic imports and literal worker image `additionalFiles` patterns. It records
Git blob witnesses for all runtime inputs and the generator/classifier.

Commit the generated `deployment-inputs.json` together with source changes.
CI regenerates and compares the manifest, then executes the classifier contracts.
It also retains the complete repository typecheck, security/audit gates and
production-readiness suite.

Vercel's existing `bash vercel-ignore-build.sh` project setting now invokes the
dependency classifier before installation. Only a verified website-unaffected
change can return exit 0. Missing history, unrelated history, stale witnesses,
uncertain imports, changed shared build settings or unknown inputs build normally.
Set `VERCEL_FORCE_BUILD=1` to explicitly force a build. Both old and new dependency
sets are considered, including removed imports and metadata files with actual
runtime consumers. The classifier performs no provider writes or network fetches.

An explicit redeploy/promotion with the same previous and current Git revision
builds normally: its production environment or configuration may differ from
the preview. Vercel supplied that exact condition during native qualification.

Next's strict typecheck uses `tsconfig.website.json` for the website and imported
helpers. CI's `typecheck` still uses the original `tsconfig.json` for the entire
repository. No TypeScript errors are ignored. Tests and worker diagnostics remain
in CI rather than becoming standalone Next build entry points.

## Release safety

The native baseline website is commit `5033ba839d1e6fc76a6626d448fbb7d6384f55c5`
from `fix/youtube-manual-h3-release-20261005`, promoted to
`https://youtube-studio-ai.vercel.app`. The configured production branch is still
`main`; do not silently replace this relationship or discard the release fixes.
Native Trigger production is version `20261001.2`, source
`2777f4905f33af5863ef7a42e8e0c70630fc4ffb`. Its schedules are absent/paused.
The cloud CI publisher remains restricted to trusted main releases and its
existing serialized freshness check. A build classifier is not a deployment
receipt, and this change does not itself qualify independent cloud publication.

Preserve owner module locks and ongoing voice/music work. Keep private direct R2
delivery, exact model settings, paid admission gates and recovery behavior.
No paid generation/render task is needed to check this policy.

## Audit and remaining qualification

The 17 October billing baseline reports 2,996 Studio Vercel build CPU minutes for
the current cycle. This is accumulated usage, not a savings estimate. Native
Trigger's last seven days show one queued footage-prune task and no completed
compute; do not claim measured worker savings from that window.

Required release evidence includes a real runtime build, a later actual
metadata-only skip, the exact canonical alias and source, live cloud identities,
unchanged paid gates/schedules, and preservation of the ongoing worktree.
Continue auditing per-function Convex reads, Trigger dispatch/retry/waits,
temporary-directory ownership, caches and R2 lifecycle before describing the
complete optimization goal as finished.

## Managed readiness processes

Each readiness test receives its own temporary directory. Its `tsx` compiler
cache remains shared through a link to the existing cache; deleting disposable
test files does not delete the cache. On Unix, the runner owns a separate process
group for each test and stops remaining children after timeout, cancellation or
parent exit. The existing 180-second/360-second test deadlines and full test
selection remain in place. SIGINT/SIGTERM stops further admission and reports an
interrupted, incomplete gate.

The runner removes only its owned temporary directory after the process group
has stopped. An unresolved process or cleanup error fails the gate and reports
the retained path. Full stdout/stderr diagnostics remain in the CI log.

### Native candidate qualification, 17 October

Candidate `791882eb14f2d8ec28bb18be3a8dbd9b599302fc` passed complete CI
`39024962208`, including all readiness, dependency, structural and proof gates.
Git preview `dpl_FtQ1mowUFEqKU6fxEPuLm59qDMmT` is READY on Next 16.3.8;
authenticated `/api/health` returned the exact candidate revision. This operational
receipt is a non-runtime change for native ignored-build qualification.

## Shared website request contracts

Weekly script, music and image API dispatchers import their argument validators
from `src/lib/planWeekPrepared*Args.ts`. The Trigger modules re-export the same
functions and types for existing callers. Keep canonical manifest bindings,
shot/candidate limits, accepted providers/profiles and cost ceilings in those
shared validators; do not duplicate validation in the dispatchers.

The whiteboard render schedule and timing-repair schemas live in
`src/lib/whiteboardRenderSchedule.ts`. The renderer retains its public exports;
quality-evidence readers consume the schema without importing the renderer.
This does not change rendering, generation, repair policy or task admission.

Against release `e08dcf84`, these changes reduce the derived website runtime
closure from 553 to 531 files (26 removed, four shared contracts added), including
removal of all three producer task modules, script/music generation, the
whiteboard renderer and the Mastra agent implementation. This is source dependency
evidence, not a measured reduction in billed CPU or a production release receipt.

Cloud publication skipping must compare each runtime against a verified
successful publication. A previous Git commit alone is insufficient: a failed
or held publication must remain eligible on the next revision. Until independent
successful-publication receipts are wired into the serialized publisher, keep
the existing conservative main-only deployment behavior.

### Runtime file resources

The generator also includes repository-tracked non-code files referenced by
literal filenames or literal `join`/`resolve` calls in a runtime module. For
example, `scripts/narration_transcript_proof.py` affects the website's imported
narration-proof helper as well as the Trigger image; changing it must not skip
the website merely because it is already classified as a worker file.
Output names and remote object keys that do not identify tracked files are not
host file inputs. TS filenames stored in a code catalog remain data: emitted
imports determine module dependencies. This resource tracing adds no runtime
file reads, provider requests, model downloads or generation calls.

### Settled public evidence requests

The shared public-evidence cache owns request settlement cleanup. Both success
and failure release only the exact registered promise, after caller value
publication has had a microtask to finish. Callers no longer manually delete
requests in `finally`: a producer that returns synchronously can finish that
block before its promise is registered, and an old completion after `clear()`
must not remove a newer request.

The existing 128-entry/five-minute value cache, deadlines, defensive copies,
provider accounting and request coalescing remain unchanged. A deterministic
1,000-request fixture retains 1,000 completed promises with the previous cache
when caller cleanup is absent, and zero with the shared cleanup. That verifies
retained-reference prevention, not a claim of measured production memory or
billed CPU savings.

## Independent Convex and Trigger publication

The serialized main-only publisher plans each runtime against its latest GitHub
publication attempt before installing npm tooling. Verified unchanged inputs
skip Node setup, installation and both publishers without requiring provider
credentials. A changed layer verifies current native identity and publishes
independently. The full CI quality gate
still precedes planning; credentials remain in the Production environment;
source freshness is checked before setup, after install and before each write.

A successful publication records its Git revision, target, publisher recipe and
native fingerprint. Convex identity uses the canonical deployment's module
hashes/configuration. Trigger identity uses the canonical production project's
latest deployment, status and source commit. A later manual provider change
holds a requested write rather than silently overwriting ongoing work. An
unchanged layer is left alone, including manual provider changes; a skip does
not certify its current live source. Native state is rechecked against the
original verified plan immediately before a publication attempt.

An attempt is marked in progress before its publisher runs. Success is issued
only after that command succeeds and native identity can be read back. Failed
or interrupted attempts cannot be used as skip evidence; if their native state
has changed, recovery is held for explicit review. Complete Trigger receipts
also require the deployed source to match the workflow Git revision. Starting
or completing an attempt from a PR, another repository, stale checkout or a
different workflow attempt is rejected.

There are no initial qualified receipts. Ordinary pushes hold at this boundary;
a trusted manual workflow_dispatch on main is the existing explicit redeploy
operation and establishes/replaces baselines after complete CI. Do not dispatch
it merely to manufacture a savings demonstration or overwrite an unreviewed
native runtime. Current website release/main source divergence must first be
reconciled with ongoing work. No receipt is fabricated from a build plan.

Only layers selected for writing require provider credentials and current
native observations. Unchanged source inputs are skipped using their qualified
historical publication receipt, without probing or overwriting concurrent
provider work. Native observation failure for a requested write holds safely.
Convex component deployments need complete component identity support before
this root-deployment observer can certify them. Manual redeployments publish
normally to cover environment/configuration changes. Vercel retains its separate
same-revision promotion/redeploy safeguard.

GitHub deployment metadata follows the documented deployment/status APIs:
https://docs.github.com/en/rest/deployments/deployments
https://docs.github.com/en/rest/deployments/statuses

### Draft render qualification and current billing baseline

Assembly Render Parity explicitly handles `ready_for_review`. Draft updates
receive a deferral notice while the normal contract/security CI continues.
Ready PRs, main releases and manual runs retain all real-render scenarios,
PARITY_CARDS=1, the frozen dependency install and the existing 35-minute budget.
Full parity for the current head remains required before merge; a draft skip is
not qualification. Publishing queues and model/render settings are unchanged.

On 17 October, GitHub's live organization budget API returned four blocking
zero-dollar budgets (Actions, Codespaces, Packages, Git LFS), all unchanged.
The October Studio usage response contained 6,504 Linux runner minutes,
$39.024 gross fully offset by discounts, $0 net, plus 0.342235 GB-hours of
Actions storage with $0 net. These are billing-period baselines, not savings
attributable to this release. Publication plan/native-observer checks are
read-only and do not create a worker image, model job, schedule or GPU lease.
