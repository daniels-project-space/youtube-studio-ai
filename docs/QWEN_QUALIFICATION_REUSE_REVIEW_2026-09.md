# Held Qwen qualification reuse — 9 September 2026

Scope: the standalone qualification workflow and a pure extraction of its
existing client request/receipt contract. No worker, provider routing, model,
precision, attention, output encoding, production flags, credentials or deployment
changed. No genuine audio was synthesized or qualified during this work.

## Root cause and correction

The old script instructed an operator to listen and rerun with `--verdicts`, but
that rerun submitted all six takes again. The worker verifies the deterministic
`requestKey`/`Idempotency-Key`; it does not retain completed audio by that key.
Its persistent cache is for model weights, and its process cache retains the
loaded model. Repeating a valid key still invokes `generate_custom_voice` and
encoding. An outer script rerun also bypassed the client's one-invocation
no-retry protection for unknown paid outcomes.

`--verdicts` now selects an exclusively offline path. Before measurements or
report writes it validates the entire existing six-take report, exact current
matrix identities, regular bounded MP3 files, receipt/audio hashes, and new
SHA-bound verdicts. It never reads worker readiness/configuration or calls
synthesis. Any missing, mismatched, orphaned or corrupt evidence fails without
provider fallback, preserving existing evidence. Audio is checked again around
measurement and before the final report is emitted.

`prepareQwenTtsRequest` is the old payload-building code extracted unchanged.
`validateRetainedQwenTtsAudio` reconstructs the current request and reuses the live
MP3 and complete receipt checks: model/revision/package pins, dtype/attention,
speaker/language/seed, normalized text/instruction hashes, request key, audio
digest/format/rate and internally consistent bounded lifecycle costs. A receipt
cannot establish its own expected request. Merely checking receipt shape with
`isPinnedQwenTtsReceipt` would not suffice here.

The first pass still makes the same six requests. It requires an empty output
directory, exclusively creates `qualification.json` before any POST, and saves
each accepted MP3 and original runtime receipt before measuring that take.
Subsequent report checkpoints use same-directory temporary-file replacement.
Measurement failures are recorded, not converted into passes; remaining takes
can finish. The report is evidence, **not authorization to retry or rebuy**. Any
nonempty directory refuses another generation pass, including after ambiguous
submission failures. The refusal directs the operator to offline finalization
or explicit reconciliation; it never recommends deleting paid evidence.

An interrupted file write can leave incomplete/orphan evidence, which fails
closed. This is not a power-loss-proof transaction or worker durable idempotency
system. If generation stopped before all six receipt/audio pairs were retained,
offline finalization refuses; this slice does not automatically buy the remainder.

## Compatibility and operator use

The report remains `qwen3-tts-qualification/v1`. Old runtime-receipt/audio rows
are accepted only after current strict identity and byte validation. Previous
measurement pass flags and old `humanVerdict` strings do not establish approval:
all audio is remeasured, and the new verdict file must explicitly bind each take.
The `humanVerdict` report field now contains this object instead of a string:

```json
{
  "en-aiden-documentary": {
    "audioSha256": "<64-character SHA from the reviewed qualification.json>",
    "decision": "accept",
    "verdict": "Human register/performance listening notes."
  }
}
```

Supply all six exact take IDs. `decision` must be `accept` or `reject`; rejected
audio stays rejected even if measurement fails. Legacy strings, wrong audio
hashes, missing notes and unexpected entries are refused, not silently migrated
into acceptance. Original runtime receipt objects and generation costs are
retained, including when remeasurement throws. A new measurement is not a second
GPU cost receipt.

```sh
# Existing valid retained audio: no worker URL/token needed.
./node_modules/.bin/tsx scripts/qwen-tts-qualify.ts \
  --out /path/to/retained-qualification --verdicts /path/to/verdicts.json
```

Finalization uses the existing Python measurement implementation and thresholds:
WER at most 0.12, loudness -23..-14 LUFS, peak at most -1 dBTP, and calm/energetic
pace separation at least 12%. Missing, malformed and non-finite measurements fail.
It sets `HF_HUB_OFFLINE=1` and `TRANSFORMERS_OFFLINE=1` for measurement: local ASR
dependencies/model cache must already be available. Their absence is unmeasured,
not permission to download a replacement or qualify without ASR.

## Retained evidence

Evidence directory: `/tmp/ysa-qwen-finalization-review-Ux4PZ5`.

| Evidence | Result |
| --- | --- |
| `qualification-before.ts`, `qwenTts-before.ts` | Exact retained pre-edit sources |
| `failing-before.log` | Actual CLI regression failed: verdict finalization submitted six requests instead of zero |
| `passing-after.log` | Initial six calls; configured and credential-free finalization zero calls; six remeasurements; identical MP3s and original receipts/costs |
| `transport-oracle.ts`, `transport-before.log`, `transport-after.log` | Six pre/post raw JSON-body SHA-256 values match exactly, including Unicode, whitespace normalization, seed, speed, ceiling and instruction truncation controls |
| `existing-qwen-contract.log`, `existing-qualification-receipt.log` | Existing worker contract and qualification guard tests pass |
| `channel-voice-casting.log`, `voice-readiness.log`, `narration-routing.log` | Existing caller/readiness/routing regressions pass |
| `typecheck-final.log`, `eslint-final.log` | Final typecheck and scoped lint results |

The actual-CLI test covers 14 retained-evidence corruptions; current matrix
text/instruction changes; legacy valid report rows; wrong/unbound/rejected
verdicts; WER/loudness/peak/pace/unmeasured failures; null/array/string/empty/
malformed measurement JSON; mutation during measurement; pre-POST and
pre-measurement checkpoints; partial measurement recovery; and unknown-outcome
refusal. It executes the real script/client and Python receipt contract, guarding
only external HTTP and local measurement dependencies. Its MP3-header fixtures
and synthetic verdicts are test data, not genuine audio/listening evidence.

Rerun from the repository:

```sh
./node_modules/.bin/tsx src/lib/__tests__/qwenQualificationResume.test.ts
./node_modules/.bin/tsx src/lib/__tests__/qwenTtsRetainedAudio.test.ts
./node_modules/.bin/tsx src/lib/__tests__/qwenTts.test.ts
./node_modules/.bin/tsx src/lib/__tests__/qwenQualificationReceipt.test.ts
```

The older read-only worker/caller audit remains at
`/tmp/ysa-qwen-qualification-audit-NTxPIB`: identical keys caused two handler
generations and two encodes while loading the model once. Its transport and
inference dependencies were guarded too; no real GPU or invoice was measured.

## Deliberately unchanged limits

- Receipt/request hashes are unkeyed integrity linkage, not signatures or new
  spend authority. The local report is not tamper-proof origin attestation.
- Neither request nor receipt proves the immutable container digest or worker
  URL identity. Reusing this evidence does not qualify a different worker image.
- `qwenTtsReadiness` currently checks the enabled flag and 64-hex digest format;
  it does **not** load the report, verify its digest or enforce reviewed provenance.
  Touched comments now say this accurately. Runtime admission hardening is open.
- Worker durable idempotency, reconciliation of unknown outcomes, deliberate
  paid regeneration and actual listened qualification remain outside this slice.
- Observed test workflow submissions drop from 12 to 6 for generation followed
  by verdict finalization. This is a concrete avoided-work count, not measured
  dollar savings or proof of accepted audio quality. No production flag was set.
