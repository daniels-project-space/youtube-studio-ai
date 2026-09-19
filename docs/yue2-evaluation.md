# YuE2 evaluation integration

Evaluation only. The caller supplies an existing admitted ChannelMusicProgram JSON
and exact style text. Empty lyrics are used; Music3 tags are never translated into
YuE syntax. No channel intent, duration guarantee or instrumental guarantee is invented.
No production provider enum/default or legacy pipeline/channel writes occur.

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
  --program /absolute/path/program.json \
  --style-file /absolute/path/yue2-style.txt \
  --seed 42 --personal-creator --out /absolute/path/evaluation-candidates
```

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

The deterministic ID binds program fingerprint, exact style, empty lyrics, seed,
upstream manifest and explicit personal-creator acknowledgement. Seeds are limited
to JS safe integers; Python's larger integer range is never silently rounded.

## Local evidence

Artifacts under `<out>/<job_id>/` are atomically linked without overwrite and
published read-only: request.json, optional submission-attempt.json,
audio-native.wav, provenance.json, and candidate.json. Provenance retains the
complete response including canonical receipt strings. The candidate binds these
hashes and always records qualified=false, productionApproved=false,
manualAudition=pending and costStatus=not_measured.

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

46 checks use explicitly stubbed HTTP and synthetic FFmpeg audio, with actual
schemas, client, persistence and ffprobe. No GPU or musical qualification is claimed.

Parent cross-language test: start Erdos's real loopback HTTP server with an
explicitly fake backend and temporary ledger, then use the real CLI with --submit,
a real createChannelMusicProgram output and explicit style file. Recover pending
jobs with the same inputs and --recover-only. The fake backend should retain nested
timing, Python float spellings, zero-byte evidence and a valid synthetic FLOAT WAV
whose frames match its receipt. There is no reduced-validation test bypass.

Owned files: src/lib/yue2Evaluation.ts, src/lib/__tests__/yue2Evaluation.test.ts,
src/scripts/evaluate-yue2-music.ts and this dedicated document. Final HTTP contract
was coordinated through parent relay to Erdos.
