# Held arithmetic audio: completed-output binding repair

This is an integrity/resume correction for the held arithmetic route, not production admission, a listening verdict, a signed authorization or proof that a provider pronounced the mathematics correctly. Ordinary educational scripts are not forced into arithmetic.

## Reproduced failure

The real registered `worked_example_prepare → worked_example_script → qa_script → narration_tts` runner recomputed current answer **−175** but restored old completed QA and speech for **401**. Replacing old QA with a current approval still admitted the old speech. The fresh-call arithmetic guards never ran during completed-stage restoration; old output was persisted against current input references before store merge.

Unchanged independent before oracle: `/tmp/ysa-arithmetic-narration-independent-jIV7IE/review.ts`. Its failing replay is retained at `/tmp/ysa-arithmetic-audio-binding-zRAP91/reviewer-before-replay.log` (exit 1). The original reviewer source/logs remain unchanged. Exact pre-edit narrated module: `/tmp/ysa-arithmetic-narrated-baseline-ASEDGv/src/trigger/blocks/narratedBlocks.ts`, SHA256 `f2b03f042ee81d3106de23a0cc38835d8d66c7c20791b22a2a25ea8266804650`.

## Narrow correction

- `Block.cachedOutputValidator` is code-owned, conditional and read-only. Its frozen context exposes only namespace, params, declared current inputs and cached outputs—not spend, storage, sink or execution capabilities. Pure `prepare` returns `null` for ordinary restoration, or validates metadata and requests declared local outputs. The runner uses existing targeted current-input hydration, repeats preparation, then validates materialized outputs **before** `assertProduced`, artifact persistence/current-input lineage creation, store merge or success writes.
- `qa_script` compares the cached Boolean and exact editorial approval with the currently verified arithmetic script. Its critic costs money even though the manifest is unpaid: rejection must not trigger its ordinary unpaid fallback.
- `narration_tts` requires a new optional strict `workedExampleAudioBinding`. Only the two actual fresh completion branches emit it, after synthesis, assembly/voice effects, existing final FFmpeg evidence and completed upload. The original asset-recording call retains its existing nonfatal semantics. Both chapter and sentence paths hash the exact byte buffer supplied to upload. The three internal provider branches remain unchanged.
- Binding fields: version `worked-example-audio-source/v1`; preparation/script fingerprints; current input fingerprint; exact ordered submitted utterances; output key, SHA256 and byte length; fingerprint of returned duration, transcript, performance evidence, sentence timings and chapter plan. Chapter heading projection is shared with the actual synthesis path, including bounded heading selection and spoken `Chapter N` prefixes.
- Input identity includes namespace/key prefix, all current JSON params, and the closed declared TTS inputs: narration text/approval, script, voice ID, niche, Style DNA, music brief, arithmetic request/preparation/editorial approval. Credential-like fields and non-JSON/oversized inputs refuse before fresh spend. The fingerprint also reads the **same captured** non-secret ElevenLabs stitching decision used by the provider adapter through a tiny accessor; it does not reread environment state differently.
- Arithmetic restoration demands `narrationLocalPath` even when there is no later local consumer. After existing rehydration, a no-follow regular-file read checks actual length/SHA and concurrent file changes. HEAD existence or transcript text is not audio-byte evidence. Changed params, voice/style, namespace, source key, timing/transcript, or bytes refuse. Legacy arithmetic audio without the fresh binding is held; no binding is retrofitted onto old paid audio.
- Any active validator or hydration refusal becomes `ExecutionError` code `CACHED_OUTPUT_BINDING_REFUSED`, `retryable:false`, outside normal execution/retry. It bypasses result-based self-healing and existing task policy aborts retries. No failed/ok stage overwrite, paid-output persistence, old-output merge, receipt deletion or automatic replacement purchase occurs. Matching resumes omit cost writes, preserving original recorded spend. Ordinary restoration receives no additional hydration and produces no new binding.

## Provider-free evidence

`src/engine/__tests__/workedExampleAudioResume.test.ts` executes real registered modules, the runner and storage-backed rehydrator. Tests include the two 401/−175 counterexamples, legacy approval/binding, eight changed params, four changed store inputs, foreign owner/channel/run/key prefix, changed key/duration/transcript/timings/chapter plan, same-length corruption, missing/downloaded files and outages, no configured rehydrator, current local/downloaded success, and ordinary unchanged demand/cost restoration. Persistence assertions inspect the actual nested artifact producer and include a positive control. Generic paid/unpaid hooks prove frozen contexts, undeclared-input refusal and terminal refusal with zero execution/stage writes. Separate processes prove captured stitching-mode drift changes the input fingerprint and matches actual guarded ElevenLabs request fields even if `process.env` subsequently changes.

`src/trigger/blocks/__tests__/workedExampleAudioSource.test.ts` executes the actual module with only external storage/database transport replaced, actual TTS clients with guarded HTTP, the current Python Qwen receipt contract, and real local FFmpeg/FFprobe. For all three providers × both chapter modes it verifies fresh binding against uploaded/local bytes and actual submitted text, then resumes that exact fresh output through the real registered runner without another provider call. It retains complete fresh fixture outputs for independent review. Tone responses and fixture approvals are explicitly **not** speech, pronunciation or editorial-quality evidence.

Against the exact pre-edit module, all six ordinary cases preserve raw HTTP URL/body bytes, final MP3 bytes, returned metadata and original costs. Failed upload cannot return a binding; malformed credential-like params refuse before any request. No actual provider, storage, key service or paid request was used.

Evidence directory: `/tmp/ysa-arithmetic-audio-binding-zRAP91`:

- `audio-resume-final.log`: real runner/refusal/resume controls.
- `audio-source-final.log`: six actual source/transport/FFmpeg controls and exact baseline parity.
- `workedExampleNarration-final.log`: existing held adapter/critic/TTS guard regression, with only its obsolete returned-failure assertion migrated to the new terminal refusal.
- Per-test logs: worked-example core/caller/learning boundary/deterministic resume, engine, module contracts, resume demand planning, recovery/healer policy, rehydration demand/subset contracts, narration provider/measurement/cadence/mix wiring.
- `tsc-final.log`, `eslint-final.log`: complete typecheck and scoped lint.

Run the exact transport oracle with:

```sh
ARITHMETIC_AUDIO_BASELINE_SOURCE=/tmp/ysa-arithmetic-narrated-baseline-ASEDGv/src/trigger/blocks/narratedBlocks.ts ./node_modules/.bin/tsx --tsconfig tsconfig.json src/trigger/blocks/__tests__/workedExampleAudioSource.test.ts
./node_modules/.bin/tsx --tsconfig tsconfig.json src/engine/__tests__/workedExampleAudioResume.test.ts
```

## Explicit remaining boundaries

### Independent frozen rerun

The independent reviewer passed **36 boundary cases** against the exact frozen
11-file manifest: 22 stale/tamper/control cases and 14 restorations/substitutions
using all six actual fresh provider/mode fixture artifacts. Both original
401/−175 failures now refuse before persistence or paid regeneration; valid
restorations retain original bytes and costs. All 11 hashes matched before and
after. Report: `/tmp/ysa-arithmetic-narration-independent-jIV7IE/AFTER-REVIEW.md`;
logs: `restore-after.log` and `fresh-artifact-restoration.log` in that directory.
The initial reviewer harness syntax error is retained separately, not counted as
a product failure. These are guarded tone transports, not genuine speech.

Root also reran both registered-runner and actual-caller suites successfully:
`/tmp/ysa-arithmetic-audio-root-resume.log` and
`/tmp/ysa-arithmetic-audio-root-source.log`. All six ordinary provider/mode cases
retain exact request, output, cost and MP3 parity with the pre-edit source. The
arithmetic capability remains held pending the distinct checks below.

### Unresolved capability requirements

- Public hashes provide integrity linkage, not signed origin/permission. A malicious party able to forge both trusted stage data and its hashes is not defeated by this artifact; the existing upstream artifact/tenant authority remains necessary. No transcript-only hash is presented as proof of actual audio meaning.
- A matching existing local file is the byte source this consumer uses. It does not independently GET/hash a mutable remote R2 object; a missing local file is downloaded through the existing rehydrator and its downloaded bytes are checked. There is no new remote immutability or provider worker attestation claim.
- Current declared settings and the captured stitching mode are bound. Future source/default/model changes require a binding-policy version review/bump; remote provider service identity and internals are not proven immutable. Other inspected narration environment reads are credentials, worker target/readiness or concurrency—not additional exposed voice/synthesis modes.
- Original completed stage outputs/cost receipts survive rejection. The Trigger outer catch uses its pre-existing durable run-total snapshot, not cost fields attached to errors. This slice does not reconcile newly accrued upstream costs into the run total on a thrown abort; that broader accounting limitation remains. The reproduced path recomputes zero-cost arithmetic and retains prior paid QA/TTS rows.
- `LearningContract` binds learning objectives/sources, not mathematical correctness. Arithmetic verification, independent editorial QA and actual pronunciation/fidelity are distinct gates. The separate retained critical-speech audit shows general transcript metrics can miss a wrong mathematical answer; that admission requirement is still open and is not addressed by byte binding.
- No planner/catalog capability, qualification flag, production admission, provider/model/quality change, deployment, Git mutation or graph refresh is included. Root owns checkpoint/review/deployment and the eventual graph refresh.
