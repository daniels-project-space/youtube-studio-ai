# EDL cached-master duration correction

## Scope

The operator-gated EDL caller remains `timelineAssemble` → `assembleViaEdl` → `renderTimeline`. EDL is not enabled by this change. No QA fallback, duration tolerance, family envelope, publishing policy, renderer configuration or provider deployment changes.

Previously, a whole-video cache hit returned `projectedDurationSec(t)` without inspecting the cached final file. The actual pre-edit function returned 93 seconds for a 93-second plan even when the backend's cached-master probe would return 45 seconds; that probe was never called. The focused failing-before test likewise returned 128 planned seconds instead of the supplied 127.551-second measurement.

## Correction

`renderTimeline` now uses one local `probeFinalDuration` helper for a whole-video cache hit and the existing fresh/pre-overlay-heal finalization path. It requires a positive, finite measured number. Cached success performs one probe on the exact cached final path, preserves fractional seconds, and performs no rendering, finishing, publishing or cache writes. A failed or invalid cached probe propagates failure: no eviction, pre-overlay fallback or automatic full render.

Fresh and healed output still probes after overlays/reframe/loudness normalization. Invalid measurements are rejected before the final-cache write and publication. The existing fresh pre-overlay checkpoint may already have been written; it is intentionally retained. This also closes the old fresh-path ordering weakness where receipt validation occurred only after final caching/publication and the generic receipt schema permitted zero seconds.

The authored Timeline, its projected duration, cache-key derivation, and independent narration inputs remain unchanged. This change records a truthful measurement; it does not declare that the measured duration satisfies the plan or channel's runtime envelope. The broader typed expectation/measurement contract remains separate work.

## Verification

The focused test runs the real `renderTimeline`; only backend operations are fixtures. It covers fractional cached duration, unchanged plan/cache, exactly one cached probe, zero/negative/non-finite/failed probes, no cache fallback, fresh and pre-overlay-heal finalization, and rejection before final-cache/publication. Existing validate-before-spend and overlay-warning assertions remain active.

```sh
node_modules/.bin/tsx src/lib/assembly/__tests__/renderTimeline.test.ts
EDL_RETAINED_MASTER=/absolute/existing-master.mp4 node_modules/.bin/tsx src/lib/assembly/__tests__/renderTimeline.test.ts
```

The opt-in retained-file integration uses the same `@/lib/ffmpeg.probe` wrapper as the real backend. It does not render, download, upload or overwrite the supplied file. It verifies unchanged SHA-256 and also rejects the test source file as non-media using a real FFprobe process. Default unit execution does not require media or FFprobe.

Verification completed locally:

- All 11 existing `src/lib/assembly/__tests__/*.test.ts` suites, including cutover and cinematic handoff.
- `scripts/assembly-parity.ts`: every deterministic legacy/EDL plan comparison matched.
- Focused ESLint and full TypeScript check with `--noEmit --incremental false`.
- Retained-master integration: `/tmp/assembly-smoke-vIiXqC/bk_smoke_2_loudnorm.mp4`, 17,576,594 bytes; measured and returned **31.021995 seconds**, unchanged SHA-256 `de7b07e460ee9c5e3fd4f5f7ad57e1b78a03aaaf7543ea9c21d2f06b1399d15c`. The independent fixture plan differs intentionally. A retained non-media cache failed without fallback or writes.

The initial focused subtask generated no new footage or render-parity matrix.
The later isolated qualification below adds that coverage. Neither the focused
test nor synthetic parity fixtures approve real channel footage.

### Isolated release qualification, 9 September

Candidate `01c35ac00ce15e16f16a7fc41d5f53b61448d548`, frozen at
`/tmp/ysa-run-edl-release-K3f1ZG/repo`, passed all **640 direct tests**,
nonincremental typecheck, full build, lint (0 errors, 33 existing warnings),
unchanged structural audits, the 24-defect executable proof page and actual
31.02-second assembly. It also passed the complete five-scenario real render
parity matrix with `PARITY_CARDS=1` and the unchanged default 60-second
narration fixture. Every scenario reports **IDENTICAL**, including decoded
audio, full-frame comparisons, selected frame hashes, duration and loudness.
No threshold or scenario was relaxed or omitted.

Logs are `/tmp/ysa-run-edl-direct-tests.log`, `-typecheck.log`, `-lint.log`,
`-build.log`, `-audit.log`, `-defect-proof.log`, `-assembly.log` and
`-render-parity.log` with the common `/tmp/ysa-run-edl` prefix. Render fixtures
are under `/tmp/assembly-render-parity-6q5JRe`. A transient Remotion
`Page.bringToFront: Target closed` diagnostic occurred during card-browser
cleanup; rendering continued and the complete matrix exited 0 with all five
identical results. It is retained in the log, not hidden as a perfect log.

The frozen retained-file probe also returned 31.021995 seconds against a
deliberately different 128-second plan, with one backend probe, unchanged
SHA-256 and zero writes; native non-media rejection passed. The companion
Run Media consumer passed all 22 actual-component/native-browser cases.

The exact candidate was pushed to main non-force. Cloud CI `34399746884` and
independent render-parity CI `34399747064` both completed successfully.
Canonical Convex was ready at 20:27:09 UTC; Trigger `20260909.26` completed at
20:29:23 UTC with content hash `b8a76dad0e589f8e56481b2beb470b63`.
Vercel deployment `dpl_4NgZGFkTdEAfN65xkoLRWNSuBHtN` is READY and its exact
canonical production alias returns this revision. See the companion
[Run Media release receipt](RUN_MEDIA_RECOVERY_REVIEW_2026-09.md) for the exact
Git-source deployment and direct production UI checks. The EDL operator gate
remains unchanged: deployed code is not an enabled or production-qualified
EDL channel route.

## Local audit evidence

Earlier read-only audit results initially existed in the task transcript only. The unchanged design/length observations were replayed into the files below; the cached-path counterexample was rerun against the archived, unmodified pre-edit implementation.

- `/tmp/ysa-edl-cache-duration-ZcekQU/design-length-counterexamples.log`: actual `designPipeline`, `enforceLengthContract` and `lengthCheck.run`; all twelve families and planned-versus-delivered scenarios.
- `/tmp/ysa-edl-cache-duration-ZcekQU/cached-counterexample-before.log`: actual archived cache-hit function, 93-second plan/receipt, 45-second probe fixture, zero probe calls.
- `/tmp/ysa-edl-cache-duration-ZcekQU/failing-before.log`: new focused assertion failing before the implementation edit, 128 versus 127.551 seconds.
- `/tmp/ysa-edl-cache-duration-ZcekQU/focused-after.log`, `assembly-suite.log`, `assembly-plan-parity.log`, `typecheck.log` and `retained-ffprobe-integration.log`: validation outputs.
- `/tmp/ysa-edl-cache-duration-ZcekQU/renderTimeline.before.ts` and `renderTimeline.test.before.ts`: scoped pre-edit snapshots for review; not deployment inputs.
- `/tmp/ysa-edl-cache-duration-ZcekQU/runtime.diff`, `tests.diff` and `review.diff`: review diffs for exactly the three scoped files.

These temporary paths are diagnostic evidence, not durable deployment or release receipts.
