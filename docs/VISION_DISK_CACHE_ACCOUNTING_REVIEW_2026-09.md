# Vision reuse — count completed disk hits

12 September 2026. Discovered by the complete data-insert regression run; a narrow accounting repair, not new vision-quality qualification.

The first 682-test run failed `visionInflightDedup.test.ts`: one provider POST, but zero cache hits instead of one. An isolated retry passed. Reading the actual `visionUrls` → preparation → `visionBuffers` path showed why: if the second preparation finished after the first response was persisted, the disk-cache early return bypassed run-scoped cache accounting. It was a timing-dependent path to a deterministic omission, not grounds to weaken the assertion.

Before changing production code, a new sequential disk-hit assertion failed reproducibly (`1 !== 2`). It uses the actual vision client and actual disk cache with a controlled fetch boundary. The repair records persisted reuse through the existing run-scoped accounting system, without recording another provider response, token usage or historical charge. The cache identity, provider, model, image preparation and paid dispatch behavior are unchanged.

The regression now checks concurrent reuse, completed disk reuse, reuse by a later accounting scope, model changes and failed-request cleanup. A later scope sees one cache hit, zero provider calls and zero new charge. Existing model-accounting, local/remote preparation, provider-scope and tier-routing tests pass. No live model request was made. The new frozen full suite and exact production release remain separate gates.

The frozen `db15159` runtime subsequently passed all 682 direct tests, actual 31.021995-second assembly, full build/typecheck/lint and unchanged audit bounds. Deployment observations are tracked with the containing [data-insert release](INSERT_EXACT_NUMBERS_REVIEW_2026-09.md).
