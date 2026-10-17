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

### Native candidate qualification, 17 October

Candidate `791882eb14f2d8ec28bb18be3a8dbd9b599302fc` passed complete CI
`39024962208`, including all readiness, dependency, structural and proof gates.
Git preview `dpl_FtQ1mowUFEqKU6fxEPuLm59qDMmT` is READY on Next 16.3.8;
authenticated `/api/health` returned the exact candidate revision. This operational
receipt is a non-runtime change for native ignored-build qualification.
