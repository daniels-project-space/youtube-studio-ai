# Held arithmetic critical-speech review — 2026-09-09

Status: implemented and locally verified, including independent coordinating review; still held from production. No catalog/planner/production admission, deployment, model change, provider call, or new paid retry authority.

## Actual defect and bounded correction

The independently retained audit correctly distinguished two existing contracts: general transcript fidelity is approximate, and cue alignment is not an exact arithmetic verifier. The original generated answer was −961. Replacing only its final spoken answer with “seven”, or adding a duplicate negative to that answer, passed both existing gates. The wrong-operator and missing-earlier-negative examples passed general fidelity but failed cue alignment; this review does not relabel those as combined-gate successes. LearningContract's objective/source binding was not a promise of mathematical proof.

The new `qaVisual` consumer uses the two transcript results it already obtains: authored narration source and released master. It never transcribes a third time. Arithmetic is conditional on the explicit existing worked-example request/preparation/script handoff and fresh-completion audio binding. Ordinary educational narration is not forced into arithmetic.

Before fresh review, current admission checks independently verified request/namespace/preparation, the exact deterministic script, current independent editorial approval, source key, and the existing five-field TTS timing fingerprint (including chapterPlan). It binds the submitted spoken sequence and current QA params/master key/timeline metadata. It does not manufacture `scriptApproved` or independently infer upstream TTS settings: the prior narration_tts restore validator owns those controls, while QA binds its exact current audio-binding fingerprint.

After each existing transcript result, a closed English integer grammar parses both segment text and independently timestamped words. It preserves the ordered parenthesized problem, step indices, operands, operators, signs, results, answer, and actual spoken chapter headings. BigInt independently replays the problem and every step. No eval, broad natural-language inference, ignored unknown words, or global WER/recall/number/timing threshold changes.

Supported normalization is explicit: canonical English integer words (bounded “and” placement), correctly comma-grouped or plain digits, unambiguous hyphenated words, one unary sign, fixed operator words/symbols, and spoken/symbolic parentheses. Unknown phrasing, fractions/decimals/exponents, duplicate signs, malformed groups/scales, missing/reordered/repeated steps/headings, unsupported divisions, and extra speech hold. Existing preparation bounds remain authoritative: ≤31 expression nodes, ≤8 steps/depth, literals ≤10^6 and results ≤10^12. The complete transcript is bounded to 24,000 characters/4,096 tokens and the compact event stream to 18 events.

## Evidence and restoration

`qaReport.renderValidation.workedExampleCriticalSpeech` carries bounded semantic events and content/input/proof digests, not full transcript text/timestamps. Unknown existing renderValidation fields are preserved. The same strict report is added optionally to the existing content-addressed full narration audit; its validator checks actual retained source/master proofs, their text and timestamp words, and report identity. Ordinary audits without this optional field have exactly unchanged canonical bytes. No certificate audio schema, artifact top-level port, or ordinary QA verdict was broadened.

Completed arithmetic `qa_visual` now uses the existing code-owned read-only restore hook:

1. Rebind current request/preparation/script/approval/audio/timing/QA inputs; strictly replay compact meaning; compare it to the existing sealed transcript summaries and exact current source/master identities. Missing legacy arithmetic evidence holds.
2. Use existing targeted input rehydration and validate actual local source/master regular-file type, length and SHA (no symlink leaf). A seed-only missing path with no upstream producer holds; no alternate hydration authority is invented.
3. Check the audit's canonical namespace/run/content-addressed key and existing receipt size bound before one existing R2 `getObjectBytes` call, with a 30-second timeout. Verify actual length/SHA, canonical JSON, the real strict audit validator, and exact report/proof equality. Recheck local bytes after the read.
4. Only then allow the unchanged runner artifact persistence/store merge. Invalid prechecks and ordinary restores perform zero audit GETs; matching arithmetic restores perform one, without ASR, visual review, synthesis, or a fallback render. An invalid fetched audit never authorizes another read/key or paid work.

The Cloudflare skill informed the conservative existing-object read, not a new storage implementation. The current getter buffers its response: its timeout and post-read length/hash validation are **not** a streaming byte cap. Existing upstream skipped-media HEAD fences remain unchanged; the arithmetic audit adds no HEAD. Matching current local bytes do not independently prove that a mutable remote media object has not changed.

Fresh arithmetic failures use the existing reconciliation marker and a nonretryable `ExecutionError`, preserving source/final-master distinction. Bounded failed observations (or a computed arithmetic report held by another final gate) are retained through existing structured failure logs, not as passing QA artifacts. Cached refusal happens before QA artifact persistence, row rewrite or store merge. Original completed rows/costs survive; a terminal throw does not produce a successful RunOutcome/run-total receipt. This slice does not repair that broader accounting boundary.

Important cost limit: current fresh `qaVisual` performs its existing paid visual review **before** source/final transcript checks. Each wrong-source/wrong-master caller fixture records one reviewer invocation. Only malformed current-input admission is pre-review, and cached refusal never re-reviews. Reordering existing cheap checks earlier is a separate savings task, not claimed here.

## Retained executable evidence

All evidence is in `/tmp/ysa-arithmetic-critical-qa-w8XFln/`:

- `audit-before-replay.log`: unchanged independent original metric/cue counterexamples.
- `narratedBlocks-before.ts`, SHA256 `7437fbdad0729b2f6853157f5cc03e7a19941a3b1482b3094fd8a8190a1a07b4`; `actual-caller-before.test.ts`; `actual-caller-before.log` and `actual-caller-before-replay.log`: six actual old qaVisual calls retain accepted full transcript audits and reach the post-audio quality boundary for unchanged/wrong-answer/duplicate-negative cases on source and master.
- `speech-unit-final.log`: 256 independently generated problems, 1,152 wrong-step mutations, 18 critical changes across both scopes, additional unsupported-domain/rehashed-report/input/audit controls; exit 0.
- `actual-caller-final.log`: 23 real registered-runner cache controls and actual fresh qaVisual cases for the original defects, missing/changed/reordered critical meaning, both text-versus-timestamp divergences, chapter ordering, normalized notation, malformed active inputs, and exact ordinary frozen-source audit parity; exit 0. `actual-caller-standalone-final.log` also passes without the optional retained baseline path.
- Eleven existing focused regressions all exit 0: workedExample, workedExampleCaller, workedExampleResume, workedExampleNarration, workedExampleAudioResume, workedExampleSpeech, narrationTranscriptProof, narrationCueTiming, moduleContracts, finalMasterReleaseEvidenceWiring, referenceQualityQaBinding (`*-regression.log`).
- `tsc-final.log` and `eslint-final.log`: empty, both exit 0. `frozen-files.sha256` records the final seven-file slice.

The actual caller uses guarded external reviewer/media/ASR process transports, actual production qaVisual control flow, actual Python metric functions, real TS transcript/cue/audit validators, actual registered runner/artifact validation, and actual rehydrator with local-copy transport. Synthetic source/master bytes and cached orthogonal visual receipts are explicitly **not** speech, video quality, pronunciation, or production approvals. The fresh positive control stops at a deliberate downstream quality-evidence boundary, not a fabricated full release certificate. Tests perform zero live provider/network/storage actions.

Replay the retained before oracle from the canonical repo:

```sh
NODE_PATH=/home/ubuntu/youtube-studio-ai/node_modules ARITHMETIC_SPEECH_EXPECT_BEFORE=1 ARITHMETIC_SPEECH_BASELINE_SOURCE=/tmp/ysa-arithmetic-critical-qa-w8XFln/narratedBlocks-before.ts ./node_modules/.bin/tsx --tsconfig tsconfig.json /tmp/ysa-arithmetic-critical-qa-w8XFln/actual-caller-before.test.ts
```

Run current proofs:

```sh
./node_modules/.bin/tsx --tsconfig tsconfig.json src/engine/__tests__/workedExampleSpeech.test.ts
ARITHMETIC_SPEECH_PARITY_SOURCE=/tmp/ysa-arithmetic-critical-qa-w8XFln/narratedBlocks-before.ts ./node_modules/.bin/tsx --tsconfig tsconfig.json src/trigger/blocks/__tests__/workedExampleSpeechQa.test.ts
```

## Explicit remaining limits

ASR is fallible. This gate checks retained recognized critical meaning, not human pronunciation, pedagogical value, display/renderer fidelity, or signed origin. Public content fingerprints provide integrity linkage, not authorization; upstream artifact provenance and the held production connector remain separate requirements.

Actual qaVisual accepts the tested equivalent hyphenated-word and plain negative-digit observations through both arithmetic and existing shared gates. A semantically equivalent grouped numeral represented as one ASR timestamp token can still fail the existing Python lexical-word-count versus TS timestamp-word-count check before arithmetic verification. The grouped observation is retained as an explicit shared-contract compatibility hold, not silently made successful; neither Python nor that TS check was changed. Other semantically valid rewrites can likewise be held by unchanged general WER/cue gates.

Exactly seven files changed: new `src/engine/workedExampleSpeech.ts`, new `src/engine/__tests__/workedExampleSpeech.test.ts`, new `src/trigger/blocks/__tests__/workedExampleSpeechQa.test.ts`, additive `src/lib/narrationTranscriptProof.ts`, additive qa_visual consumes in `src/engine/moduleContracts.ts`, narrow qaVisual edits in `src/trigger/blocks/narratedBlocks.ts`, and this review. No provider, planner, renderer, global threshold, price, engine restore API, policy/admission, Git or graph changes.

## Coordinating independent review

Root read the complete helper and actual caller/restore changes, verified the
seven frozen hashes, and independently reran both verifier and actual-caller
proofs with the retained ordinary baseline. Both exited 0:
`/tmp/ysa-critical-speech-root-unit.log` and
`/tmp/ysa-critical-speech-root-callers.log`. The actual task retry policy also
converts the new refusal to `AbortTaskRunError`, with the existing self-heal
reconciliation marker retained (`/tmp/ysa-critical-speech-root-retry-policy.log`).
This does not expand the guarded transport tests into genuine ASR/listening or
full visual-quality approval.

Separate unchanged Python-to-TypeScript investigation reproduced the grouped
word-count incompatibility and, more seriously, acceptance of contradictory
timestamp words with equal counts. Its before evidence is retained at
`/tmp/ysa-transcript-count-audit-VnhrFK/REVIEW.md`. That shared producer/consumer
repair is separate from this frozen arithmetic slice; it must preserve raw
observations and all existing fidelity thresholds. A count-only patch would
accept incomplete timestamp coverage and is explicitly not sufficient.
