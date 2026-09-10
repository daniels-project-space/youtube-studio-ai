# Ordinary narration source preflight — held review

Base: exact production `98ca6829bfebff84dcc8a2b95abe1bbfccbbe33e`.
Isolated checkout: `/tmp/ysa-ordinary-source-preflight-lnMt7T/repo`.
This is a clean ordinary-only port, not the held arithmetic implementation.
No planner, provider, admission, model, threshold, schema, cache policy, or price changes.
Only `narratedBlocks.ts`, `qaNarrationSourcePreflight.test.ts`, and this review change.

## Boundary and savings

`qaVisual.run` now performs its existing production narration performance,
exact-spoken-script, source transcript/fidelity, and source cue-timing checks
immediately before `reviewRender`. A failed required performance receipt or
missing/empty exact spoken script stops before source GET or ASR as well.
These are existing input/quality requirements, not lower-cost substitutes.
The original production master SHA anchor remains before preflight.

The attempt retains its one resolved source path and proof for the original
later final-master transcript/audit and waveform-correlation checks. Good runs
still have one source proof, one master proof, one reviewer invocation, and zero
or one source GET. No duplicate ASR pass, paid-work authority, or reuse journal.
The source is rehashed after its proof, immediately after visual review, and
before later audit/mix work. The existing post-review master fence and later
master-transcript hash comparison remain intact.

Draft source handling stays after review, including download-first handling
when exact text is absent, advisory/error logs, and correlation. Cached ordinary
QA uses the unchanged existing restore path: this port does not add cache
validation or retroactively certify old receipts. No-narration behavior is unchanged.

This moves only the source preflight. Other existing lane/profile checks and
optional local Audiobox scoring still precede it; known-safe source-read retries
can repeat those local checks. It is not a promise of zero CPU or zero earlier
storage reads. The claimed saving is an avoided **visual reviewer invocation**
for a known-invalid production narration source, plus no needless source GET/ASR
when required performance/script inputs already fail.

## Refusal, availability, and accounting

- Proven source input/fidelity/timing/byte defects: structured
  `QA_NARRATION_SOURCE_REFUSED`, nonretryable, no visual-repair signal.
- Only the pre-ASR source `getObjectBytes` boundary can produce retryable
  `QA_NARRATION_SOURCE_READ_UNAVAILABLE`. It requires existing structured
  transport status/code classification; exact Smithy `TimeoutError` is normalized
  to its known timeout code. Arbitrary “timeout” text cannot authorize retry.
  Explicit nonretryability/status refusals win. The existing engine performs
  bounded same-stage retries; no new retry loop or remote permission is added.
- Missing object, unknown errors, and explicit nonretryable reads hold as
  unavailable, not evidence of incorrect speech. The current process wrapper
  flattens ASR failure metadata, so `QA_NARRATION_SOURCE_PROOF_UNAVAILABLE`
  is an explicitly unclassified, nonretryable availability hold. It is not
  mislabeled as a proven fidelity defect or guessed retryable from stderr.

All three carry the existing `PAID_STAGE_RECONCILIATION_REQUIRED` marker.
The real engine retries typed safe reads despite that marker; after exhaustion,
the actual run-level self-heal guard stops before `planHeal`, preventing upstream
speech regeneration. The actual task classifier also preserves transient reads
and converts nonretryable refusals to task aborts. Final-master failures retain
their existing later critical-list behavior; they still happen after review.

The composite successful QA cost patch is unchanged. No refund is invented,
and no completed row is overwritten on these fresh failures. The synthetic
runner fixture observes zero paid usage; that does **not** prove a real late
failure incurred no cost. Existing runner observed-cost/checkpoint accounting
continues to apply, and historical completed-row cost remains 0.73 in the
ordinary resume control. SDK-internal HTTP retries may occur inside one counted
source GET; the test counts application calls, not network packets.

## Actual-caller evidence

Evidence directory: `/tmp/ysa-ordinary-source-preflight-lnMt7T`.

- `before-ready.log` reproduced nine source defects on untouched production:
  each reached the reviewer once; missing/empty script with missing local source
  also downloaded once. `before-frozen.log` replays the same exact source hash.
- `default-ready.log`: 41 named controls pass without environment overrides,
  historical files, or Git. `parity-ready.log`: 42 controls, adding exact98
  historical audit, draft, failure-string, and cached-output/cost comparisons.
- Good source/master audit bytes are pinned to SHA-256
  `cf851fa1436dfe7451f0e4123d4f080da572f5be06f76513dd41929eb9b295c3`.
  Both local and downloaded runs match. Grouped `2,259`, hyphenated words,
  and spoken chapter headings use the repaired producer's timestamp-entry
  count and complete duration; the actual cue gate passes. The deliberately
  short source remains a precise cue-duration negative.
- Real parser, proof consumer, cue gate, hashing, audit construction, registered
  runner, artifact validation, targeted rehydrator, task classifier, and actual
  extracted self-heal loop run. Only external media/reviewer/ASR transport is
  guarded. A post-audio sentinel bounds good cases; it is not a fake full QA pass.
  Two final-master negatives continue through the actual critical-list refusal,
  with identical old/new error strings.
- Structured timeout, SDK timeout, and SDK503 recover once with two source GETs
  but only one source/master proof pair and reviewer; exhaustion performs three
  source GETs, no ASR/reviewer, and no QA artifact persistence or upstream heal.
  404, untyped timeout, unknown-code timeout, and explicit false controls hold.
  Source mutations during proof/review/pre-audit and master mutations remain
  rejected without a false audit. Draft logs/order and cached bytes/costs match.

The test imports actual Python lexical metrics with supplied process output;
synthetic byte fixtures are **not speech or visual-quality evidence**. No remote
providers, live storage, media downloads, new ASR/model inference, or publishing
are used. Historical replay is explicitly opt-in and rejects the wrong source
hash (`24cafc28694165e98e9c4a58f676faf879eb43fa09cd38623c61ed7457de0678`).

## Reproduction and qualification

Run from the isolated checkout (default test is auto-discovered by the existing
readiness runner; no runner modification):

```sh
node_modules/.bin/tsx src/trigger/blocks/__tests__/qaNarrationSourcePreflight.test.ts
NARRATION_PREFLIGHT_EXPECT_BEFORE=1 NARRATION_PREFLIGHT_SOURCE=/tmp/ysa-ordinary-source-preflight-lnMt7T/narratedBlocks.before.ts node_modules/.bin/tsx src/trigger/blocks/__tests__/qaNarrationSourcePreflight.test.ts
NARRATION_PREFLIGHT_BASELINE=/tmp/ysa-ordinary-source-preflight-lnMt7T/narratedBlocks.before.ts node_modules/.bin/tsx src/trigger/blocks/__tests__/qaNarrationSourcePreflight.test.ts
NODE_OPTIONS='--require /tmp/ysa-transcript-count-repair-NbnQXQ/fixture-network-only.cjs' node scripts/run-production-readiness-tests.mjs
NODE_OPTIONS='--require /tmp/ysa-transcript-count-repair-NbnQXQ/fixture-network-only.cjs' node scripts/run-audits.mjs
node_modules/.bin/eslint
env -u NODE_OPTIONS NEXT_TELEMETRY_DISABLED=1 npm run build
node_modules/.bin/tsc --noEmit --incremental false
```

Focused proof, 22-case Python→TS producer/consumer, cue, performance and module
contract tests pass; scoped lint and nonincremental typecheck pass. All twelve
structural audits match the unchanged baseline, including unproducible=3.
Full lint passes with zero errors and 33 pre-existing warnings across 16
byte-unchanged source files (`full-lint.log`, `lint-warning-parity.log`). Actual
build and post-build nonincremental typecheck pass (`build.log`,
`typecheck-post-build.log`). The complete readiness runner passes **all 651
tests**, exit 0 (`full-readiness.log`), under the loopback-only fence. No tests
or baselines were skipped or weakened. Build dependencies are a local
copy of the already-installed tree, not a new install or external-root symlink.
Google font fetching during the unchanged build is authorized; telemetry is off.
`frozen-before.sha256` and `frozen-after.log` confirm all runtime/test, proof,
lockfile and audit-baseline hashes stayed unchanged through qualification.
`freeze.sha256` pins the final three-file delivery, and `delivery.diff` contains
the complete reviewable patch. `source-boundary-parity.log` independently checks
unchanged TTS/QA-script source, review transport, later master audit, and mix logic.
The wrong-historical-source negative also refuses before invoking the caller
(`reject-wrong-historical-source.log`).
No canonical source, Git commit/push, deployment, or graph refresh was performed.
