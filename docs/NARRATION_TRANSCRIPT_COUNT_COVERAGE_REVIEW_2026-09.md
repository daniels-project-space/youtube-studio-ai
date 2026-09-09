# Transcript timestamp count and lexical coverage repair

Date: 2026-09-09. Standalone candidate based on
`d24a00e72835d102e8753783b1e83e7227d77111`; no production admission, push,
deployment, paid provider call, model download, or real ASR audition.

## Findings and boundary

The producer's `transcript.wordCount` counted lexical WER tokens, while the
actual TypeScript consumer and compact summary require timestamp-entry units.
One timestamp entry such as `2,157` or `step-by-step` can contain several
lexical tokens. A standalone punctuation timestamp can contain none.

The before oracle also found a separate missing invariant: equally sized
timestamp and transcript streams could disagree or be reordered and still
pass. A truncated stream failed the old count check, but changing only its
count to its timestamp length made that inconsistent receipt pass. Therefore
changing the count alone is insufficient.

This repair adds complete **ordered lexical coverage** at both the actual
Python producer and the actual TypeScript full-receipt validator. Timestamp
entry count is now written in timestamp units; expected-script count, WER,
recall and missing-number metrics remain in their existing lexical units.

This does **not** assert raw punctuation or sign equality, semantic equivalence
between number words and digits, genuine speech recognition quality, or
claimant authenticity. For example, the existing lexical policy tokenizes
`-175` and `175` identically. The held arithmetic critical-speech work is not
included or represented as fixed by this standalone change.

## Runtime changes

- `scripts/narration_transcript_proof.py`: compare existing transcript tokens
  with tokens from the complete ordered emitted timestamp text; refuse a
  mismatch before emitting a receipt. Count emitted timestamp entries.
- `src/lib/narrationTranscriptProof.ts`: mirror the producer's existing
  ASCII/apostrophe lexical policy and require nonempty, complete ordered
  coverage when validating a full receipt. The original count and interval
  checks remain.

Raw observed text, word spans, timestamp conversion, source and expected-text
digests, model/package/revision pins, schema versions, thresholds, lexical
metrics, pass computation, invocation and ASR call count are unchanged. Exact
source comparison against the base confirms that removing only the specified
count/coverage additions reproduces both original runtime files byte for byte.

An invalid cached full receipt is refused without a new ASR request, receipt
rewrite, signature change, or automatic paid retry. Newly compacted summaries
are created only after full validation. **Historical summary-only receipts
cannot establish this new coverage invariant** because they contain digests
and counts, not the complete text/word streams. Their existing validation
contract is unchanged; no coverage attestation or migration is implied.

## Actual producer-to-consumer regression

`src/lib/__tests__/narrationTranscriptProducerConsumer.test.ts` invokes the
real `proveNarrationTranscript`, including expected-file creation, hashes,
arguments, actual Python receipt construction and actual full-receipt
validation. The Python fixture replaces only Whisper/package transport and
denies network access. It does not replace tokenization, WER/recall, timestamps,
receipt construction or TypeScript validators. Source bytes are explicitly a
synthetic integrity fixture, not a speech audition.

The portable test passes 22 cases, with 17 producer calls, 15 guarded Whisper
fixture calls and zero network requests:

- Seven valid grouping cases: ordinary, grouped/split numeral, grouped/split
  hyphenated word, attached punctuation, standalone punctuation entry. Raw
  observations/timestamps are retained, quality metrics remain WER 0/recall 1.
- Five actual producer refusals: contradictory, reordered, truncated,
  duplicated-extra and empty timestamp streams.
- Four independently malformed cached full receipts: contradictory,
  reordered, truncated and extra timestamp text, each with a internally
  matching count. The real full validator, summary creator and final-master
  full audit refuse them without another process or transcription call.
- Unchanged words-to-digits disagreement: WER `6/17`, recall `11/17`,
  `passed=false`, even though count and lexical coverage are valid.
- Unchanged missing-number/aggregate-threshold control: replacing `2157` with
  `2158` in an 18-token transcript retains missing term `2157`, WER `1/18`,
  recall `17/18` and the existing aggregate `passed=true`. This is explicitly
  not critical-number semantic admission.
- Existing reversed-interval refusal and source/script digest refusals. The
  latter occur before Whisper is invoked.
- Python/TypeScript token-policy parity including apostrophes, hyphens,
  grouped digits, signs, decimals, punctuation, Unicode case and whitespace.

Four older positive test fixtures supplied incomplete timestamp streams;
they now contain their full claimed transcript coverage. Their existing
negative assertions are retained:
`narrationTranscriptProof.test.ts`, `finalMasterReleaseCertificate.test.ts`,
`referenceQualityEvidenceBridgeV2.test.ts`, and
`viewerPromiseProgression.test.ts`. This corrects evidence fixtures, not
runtime metrics or acceptance thresholds.

## Retained before evidence

The independent before audit remains unchanged at
`/tmp/ysa-transcript-count-audit-VnhrFK/REVIEW.md` (SHA-256
`83a99b51b4d06f20691d5c6610fd20cbb9f57bef326e01b2f803387404297024`).
Its `before-oracle-final.log` intentionally exits 1 after confirming all 13
current behaviors and both defective invariants; SHA-256
`c0017ce8d4b715fc78bde963de276b05aaed15b9417a8951a546bd2f26ee0602`.
`before-results.json` retains the explicitly labeled truncated-stream
count-only counterfactual; SHA-256
`4637d261877c95cd2111971a96fb0917b7584e6a85dee1de2377bf4e32f1b5e1`.

## Qualification

Evidence directory: `/tmp/ysa-transcript-count-repair-NbnQXQ`.

- Actual producer/consumer regression: pass (`producer-consumer-expanded.log`).
- Nonincremental TypeScript check: pass (`typecheck-final.log`).
- Post-build nonincremental TypeScript check: pass (`typecheck-post-build.log`).
- Scoped ESLint: pass (`lint-final.log`).
- Full ESLint: exit 0, no errors and 33 pre-existing warnings (`full-lint.log`).
  All 16 warning-bearing source files are unchanged from the exact base;
  the changed-file scope has no warnings (`lint-warning-parity.log`).
- All 12 structural audits match the existing baseline (`baseline-audit.log`),
  including `unproducible-consumes=3`; the baseline is unchanged.
- Exact runtime source parity: pass (`source-parity.log`,
  `runtime-source-parity.json`).
- Actual production build: pass (`build.log`), using an in-root dependency tree.
  Unchanged Google font fetches were explicitly authorized; telemetry disabled.
- Hermetic real FFmpeg assembly: pass (`assembly.log`), 31.022 seconds versus
  31.000 projected, local output and no R2 access. This is an integrity fixture,
  not a channel render or an audio-quality audition.
- Independent parent replay: same 22 cases pass
  (`/tmp/ysa-transcript-count-root-independent.log`).
- Complete existing readiness runner: **all 650 tests pass**, exit 0
  (`full-suite-corrected.log`), including both loopback fixture tests and the
  22-case actual Python-to-TypeScript regression. Frozen source hashes match
  before and after the entire run.

Actual qualification commands, from the isolated checkout:

```sh
node_modules/.bin/tsx src/lib/__tests__/narrationTranscriptProducerConsumer.test.ts
NODE_OPTIONS='--require /tmp/ysa-transcript-count-repair-NbnQXQ/fixture-network-only.cjs' node scripts/run-production-readiness-tests.mjs
NODE_OPTIONS='--require /tmp/ysa-transcript-count-repair-NbnQXQ/network-deny.cjs' node scripts/run-audits.mjs
node_modules/.bin/tsc --noEmit --incremental false
node_modules/.bin/eslint
env -u NODE_OPTIONS NEXT_TELEMETRY_DISABLED=1 npm run build
env -u R2_ACCOUNT_ID -u R2_ENDPOINT -u R2_ACCESS_KEY_ID -u R2_SECRET_ACCESS_KEY NODE_OPTIONS='--require /tmp/ysa-transcript-count-repair-NbnQXQ/network-deny.cjs' node_modules/.bin/tsx scripts/assembly-smoke.ts
```

The two runtime SHA-256 digests after repair are
`e081ce1c03ebc591b752951e12f1a5685ef804184670ab42e3fb1cb54149e455`
(Python) and
`74bd01e356af7ceae24543898357886ab4ed6582707016857080b121b709e1b3`
(TypeScript). All eight runtime/test file hashes are frozen in
`frozen-source.sha256`; the review document was excluded while gate results
were being finalized.

The initial full-test process fence denied TCP (including loopback), TLS and
default fetch, permitting only TSX's Unix-domain process-control socket. That
full run finished 648/650: the unchanged quote-card browser test and Salad
HTTP test were blocked by the fence. Both pass unchanged when their existing
loopback fixture transport is allowed (`documotion-local-transport.log`,
`salad-local-transport.log`). The entire suite was rerun with that corrected
fence, still denying remote TCP/TLS/fetch; the initial failed `full-suite.log`
is retained and is not relabeled a passing run. Earlier overstrict fence
attempts rejected TSX's local IPC before tests ran; logs are retained
separately. A new-test type-narrowing error and an explicit numeric
control's incorrect test denominator were corrected before final qualification;
those failed development logs are retained, not represented as product defects.

The canonical checkout, index and protected arithmetic critical-speech files
remain untouched. Graphify's current shared project graph was queried before
source work; the parent owns the canonical graph update. No duplicate isolated
graph build or runtime/deployment inclusion of graph artifacts is needed.
