# Selected module contracts govern parallel execution

## Reproduced defect

The runner's curated parallel groups were selected exclusively by block ID.
Exact-version registry selection, compilation and artifact validation already
worked, but a selected version could add a required/optional input from a sibling
without changing its group membership. A topologically valid sequential pipeline
then failed during execution because its consumer ran before the producer had
persisted its output. An optional-input consumer could instead buy a fallback
while its intended input was still being generated.

The new real-runner regression fails under the previous group-construction code:
`dp_brief` reports that `fixtureCue` is absent even though the preceding selected
pipeline producer supplies it. Restoring contract-aware group construction makes
the same fixture succeed. All providers in these tests are local fake block
bodies; no model requests, thumbnails or deployment are involved.

## Execution change

Curated group membership remains necessary but is no longer sufficient. Every
candidate member must be independent of every already-selected member according
to the exact resolved manifests. Required/optional reads, required/optional writes
and required capabilities are considered. Read/write conflicts in either
direction, write/write conflicts or sibling capability dependencies end the wave
before the conflicting entry. Pipeline order is preserved; no general inferred
DAG scheduler, provider substitution or automatic module-version promotion is
introduced.

Independent members still execute concurrently. A three-module fixture verifies
that two independent producers start together while a dependent third module
waits. A failed upstream module prevents the dependent paid fixture from starting
or writing its stage. Existing wave completion/drain, durable stage receipts,
cost accounting, review-stop restrictions and legacy pipeline definitions are
unchanged. This avoids an unnecessary failure/retry path; no fleet savings or
production latency improvement is inferred.

## Evidence and limits

Eight real-runner fixtures cover required and optional reads, an optional output
that is actually emitted, capability-only ordering, exact selected-version
execution, unchanged independent concurrency, upstream failure, three-member
splitting and a later writer racing an earlier optional reader. They assert
fresh artifact lineage, stage persistence and observed fake charges. The existing
default-manifest wave test additionally checks that default siblings have no
declared capability dependencies, preserving their current parallelism.

This only reasons over declared contracts inside already-vetted groups. It cannot
prove independence of undeclared external side effects, qualify new providers or
fix missing module declarations. Those remain module-admission responsibilities.
The requested whole MVP, real YuE GPU/audio qualification and production rollout
are not completed by this scheduler repair.

Final local verification: all 844 selected readiness test files passed with
external networking disabled; 30 thumbnail-named files were excluded. The two
focused wave suites, TypeScript, scoped ESLint and whitespace checks passed.
Graphify was refreshed after the code changes. This is a partial offline gate,
not complete production readiness. No deployment or paid generation occurred.
