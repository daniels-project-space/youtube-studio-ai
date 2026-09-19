# YuE2 evaluation integration

Evaluation only. The caller supplies either a fingerprint-bound accepted music
arrangement or, for legacy experiments, an admitted ChannelMusicProgram JSON and
independent exact style text. Empty lyrics are used; Music3 tags are never translated
into YuE syntax. No channel intent, duration guarantee or instrumental guarantee is invented.
No production provider enum/default or legacy pipeline/channel writes occur.

## Accepted arrangement entry

`createYuE2AcceptedArrangementRequest({ arrangement, seed, personalCreatorAcknowledged })`
uses Studio request version `studio-yue2-arrangement-evaluation/v1`. It retains the
full `acceptedArrangement` artifact and sets `programFingerprint` to that artifact's
fingerprint. `AcceptedMusicArrangementSchema` revalidates its complete content;
`projectAcceptedMusicArrangementToYuEStyle` is the sole source of the job style.
Independent style overrides are rejected, including an altered style with a newly
computed otherwise-consistent job ID. Validation runs before the first HTTP request.

The accepted form, ending, playback, section order, energy and instructions are
projected as authored. They express evaluation intent, not evidence that YuE obeyed
them. No loop fold, extra track, invented variation, trim or assembly is added.
Natural endings, duration adherence and instrumental output remain unqualified.

The existing `createYuE2EvaluationRequest` constructor, legacy
`studio-yue2-evaluation/v1` request shape and ID calculation are unchanged.
The shared client accepts `YuE2BoundEvaluationRequest`, a union of both versions.
The arrangement envelope is Studio-side provenance only: worker HTTP still receives
the same strict job object with projected `style`, empty `lyrics`, seed and license.
No Python runtime or worker manifest change is needed.

## Frozen wire contract

Aligned with `/home/ubuntu/youtube-studio-music-runtime/docs/HTTP_CONTRACT.md`:

- GET `/v1/health`: `contract: "yue2-evaluation-worker/v1"`, full pinned manifest,
  Python manifest digest, qualification, queue capacity, worker_state, error and
  readiness_scope. Ready means queue idle, not GPU qualified.
- GET `/v1/jobs/:id` before any POST. Only an explicit `job_not_found` 404 can
  permit a POST. Failed, ambiguous and refused jobs never replay.
- POST `/v1/jobs`: exact existing strict job JSON without extra fields.
- Completed status uses `state`, `receipt` and `receipt_payloads`. Each pair has
  `payload_json` including LF and `sha256`. Hash original UTF-8 bytes, then parse
  normally and verify the job/config/started/terminal chain and terminal equality.
- Fixed native artifact: `/v1/jobs/:id/artifacts/audio-native.wav`. There is no
  native-wav alias. Response-supplied artifact URLs are never followed.
- Bearer: exactly 32-512 URL-safe ASCII letters/digits/underscores/hyphens. HTTPS
  except loopback; no URL credentials, queries, fragments, base paths or redirects.
  Errors omit underlying transport errors, worker bodies and bearer secrets.

The complete manifest is independently pinned. Python's canonical manifest digest
is separately pinned and differs from the JS fingerprint used for request IDs.
Per-request timeout covers body consumption (default 30 seconds); JSON is limited
to 2 MiB and native WAV to 256 MiB. One invocation returns pending or completed
without unbounded polling. All started/terminal positive attempt numbers must match;
the client cannot request a retry.

## Commands

Run from `/home/ubuntu/youtube-studio-ai`. Default validation makes no network
request, performs no GPU execution and writes no evaluation artifacts:

```bash
node_modules/.bin/tsx src/scripts/evaluate-yue2-music.ts \
  --arrangement /absolute/path/accepted-arrangement.json \
  --seed 42 --personal-creator --out /absolute/path/evaluation-candidates
```

Legacy independent-style experiments remain available:

```bash
node_modules/.bin/tsx src/scripts/evaluate-yue2-music.ts \
  --program /absolute/path/program.json \
  --style-file /absolute/path/yue2-style.txt \
  --seed 42 --personal-creator --out /absolute/path/evaluation-candidates
```

`--arrangement` is mutually exclusive with both `--program` and `--style-file`
(`--style` is an alias). No missing or invalid arrangement falls back to legacy mode.

For a separately authorized evaluation, configure `YUE2_EVALUATION_URL` and
`YUE2_EVALUATION_TOKEN` in the process environment and add `--submit`:

```bash
node_modules/.bin/tsx src/scripts/evaluate-yue2-music.ts \
  --program /absolute/path/program.json \
  --style-file /absolute/path/yue2-style.txt \
  --seed 42 --personal-creator --out /absolute/path/evaluation-candidates --submit
```

Repeat the exact command with `--recover-only` for GET-only recovery. A durable
fsynced submission marker is saved before POST; subsequent CLI invocations from
the same directory cannot POST again even without --recover-only. Preserve both
local artifacts and runtime ledger. Do not change seeds/IDs/output directories to
bypass an ambiguous outcome. No automatic repurchase, retry or fallback exists.

The deterministic ID binds request version, program/arrangement fingerprint, exact style, empty lyrics, seed,
upstream manifest and explicit personal-creator acknowledgement. Seeds are limited
to JS safe integers; Python's larger integer range is never silently rounded.

## Local evidence

Artifacts under `<out>/<job_id>/` are atomically linked without overwrite and
published read-only: request.json, optional submission-attempt.json,
audio-native.wav, provenance.json, and candidate.json. Provenance retains the
complete response including canonical receipt strings. The candidate binds these
hashes and always records qualified=false, productionApproved=false,
manualAudition=pending and costStatus=not_measured.
Arrangement candidates also retain the full `acceptedArrangement` in candidate.json;
cache reuse requires exact equality with the artifact in the validated request.
Legacy candidates do not acquire this field or change identity.

ffprobe must verify one pcm_f32le stereo 48 kHz WAV stream with the exact receipt
frame count before candidate publication. No conversion/mastering/trim/pad occurs.
Cache reuse rechecks hashes, receipts and native format without network. These
integrity measures are not signatures against a privileged filesystem owner.

## Verification and parent support

```bash
node_modules/.bin/tsx src/lib/__tests__/yue2Evaluation.test.ts
node_modules/.bin/eslint src/lib/yue2Evaluation.ts src/lib/__tests__/yue2Evaluation.test.ts src/scripts/evaluate-yue2-music.ts
node_modules/.bin/tsc --noEmit --incremental false --pretty false
```

Checks use explicitly stubbed HTTP and synthetic FFmpeg audio, with actual
schemas, client, CLI entrypoint, persistence and ffprobe. Arrangement checks include
rehashed style substitution, artifact tampering before HTTP, mutually exclusive
CLI modes, native candidate retention and single-purchase GET-only recovery.
No GPU or musical qualification is claimed.

The executable cross-language check is:

```bash
YUE2_TEST_RUNTIME=/home/ubuntu/youtube-studio-music-runtime \
  node_modules/.bin/tsx scripts/test-yue2-runtime-integration.ts
```

On 2026-09-19 it passed with the real Python loopback HTTP worker, temporary
ledger, real TypeScript CLI and ffprobe, and an explicitly fake inference backend.
One legacy request and five composer-to-planner arrangement fixtures produced
exactly six fake inference calls. The arrangement fixtures cover all four music
roles plus a shaped natural-ending piece. Recovery, cache reuse, receipt checks,
native FLOAT WAV validation and tamper rejection remain enabled. This proves the
local integration, not GPU execution, musical quality or adherence to the score.

The opt-in composer revision reserves a bounded request using the configured
model's price and refuses unpriced models, oversized input and insufficient
stage budgets. Execution authority is checked immediately before dispatch.
Observed usage is recorded separately from the reservation, and an unsuccessful
paid dispatch is held for reconciliation rather than automatically repurchased.
The legacy composer remains the default; this does not activate a channel route.
