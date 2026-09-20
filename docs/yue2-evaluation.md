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

The client also supports opt-in supervised-runtime transport:
`executionPolicySha256` binds POST admission to a caller-selected raw-policy
digest. `fetchExecutionPolicy()` and `fetchExecutionAccounting(request)` are
bounded GET-only transport methods; their returned bodies are untrusted until
checked by `verifyYuE2ExecutionPolicy` / `verifyYuE2ExecutionAccounting` from
`src/lib/yue2ExecutionAccounting.ts`. The accounting verifier binds the admission,
job/config, supervisor and runner receipts, and recomputes integer micro-USD
allocation using `BigInt`. Failed-work evidence can be retrieved independently
of successful audio download. Provider billing remains unknown.

The durable R2 CLI can opt into this path with an explicit execution-policy file.
Production module admission remains separate and is not enabled by this evaluator.
The runtime's `docs/SUPERVISION.md` documents the child-only deadline, unbounded
parent readback limitation, containment, and GPU qualification still required.

The opt-in `scripts/test-yue2-supervised-integration.ts` check uses
`YUE2_TEST_RUNTIME=/home/ubuntu/youtube-studio-music-runtime`. It starts an isolated
real Python HTTP worker with a synthetic CPU backend, rejects missing/changed
policy headers, validates the sealed accounting chain, probes native FLOAT audio,
and confirms recovery used exactly one inference. This is integration evidence,
not generated-music quality or a provider-cost measurement.

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

## Cross-worker evaluation

`--durable-r2` selects the shared durable evaluator. It requires an accepted
arrangement, forbids `--out`, and still does no network work without `--submit`.
The existing local and legacy independent-style modes remain unchanged.

```bash
node_modules/.bin/tsx src/scripts/evaluate-yue2-music.ts \
  --arrangement /absolute/path/accepted-arrangement.json \
  --seed 42 --personal-creator --durable-r2 --submit
```

Repeat the exact command with `--recover-only` on a replacement worker. R2
configuration comes from deployment environment or the scoped Cloudflare vault
service; worker endpoint/token remain explicit server-side environment values.
No credentials are written into receipts. This command is for a separately
authorized evaluation, not an automatic production dispatch.
The CLI is a trusted operator tool: owner/run path validation is not user
authentication. A future server or module caller must verify owner access and
execution ownership before invoking the evaluator, including cached recovery.

The constant owner/run path `owner/<owner>/runs/<run>/music/yue2-evaluation/`
freezes the full accepted arrangement request and endpoint in `binding.json`.
A changed seed, channel, arrangement or endpoint cannot create a second take
under that binding. A create-only submission marker precedes POST. After that
marker exists, even a worker 404 means hold and investigate, never repurchase.
An ambiguous storage write cannot grant submission authority.

Native WAV, raw receipt provenance and candidate evidence are retained without
overwriting different bytes. Replay rechecks the original receipt chain, audio
hash/length and the real native container. Download bounds are enforced while
streaming, not after buffering an arbitrarily large storage object. Recovered
results remain `qualified=false`, `productionApproved=false`, audition pending,
and `costStatus=not_measured`. They do not emit the production `musicKey` handoff.

This closes a prerequisite for the future shared module, not the whole runtime
integration. A YuE-specific owner-review/continuation path and actual pinned GPU
qualification remain necessary before unattended production admission. Inference
phase timing alone is neither provider billing nor a hard rental-spend limit.

### Supervised durable evaluation

Add `--execution-policy /absolute/path/policy.json` to the accepted-arrangement
`--durable-r2` command. It is rejected in local output mode. The file must satisfy
the sibling runtime's strict policy contract, including the operator-supplied
rate, runtime identity, execution limit, and reservation. Default validation reads
only bounded local files; it does not bootstrap credentials, access R2, or call
the worker. Network work still requires explicit `--submit`.

The supervised `studio-yue2-durable-evaluation/v2` binding freezes
`expectedExecutionPolicy` together with the exact request and endpoint at the same
owner/run path. Changing or omitting the policy, or trying to adopt an existing
unsupervised binding, fails rather than purchasing a new take. Immediately before
reserving the one-time POST, the evaluator verifies the worker's policy against
this local expectation; the POST header atomically binds the same raw-policy hash.

`execution-accounting.json` independently retains the verified status snapshot and
immutable accounting receipt chain, bound to the durable run. Only terminal
measured allocation evidence is published there; incomplete evidence is unknown,
not zero. Failed, timed-out, and overrun jobs return `status: held` with the retained
accounting reference and never create an audio candidate. Replacement workers can
recover a retained failure without HTTP or another inference. A failed audio
download can still retain its verified execution allocation for later recovery.

Successful supervised candidates use `studio-yue2-durable-candidate/v2` and require
`executionAccounting` to reference verified completed accounting for the exact same
runner terminal as their audio provenance. Cached recovery revalidates both chains,
the referenced accounting bytes, and native audio. Concurrent final-evidence writes
may differ in an earlier GET status snapshot, but must agree on the same immutable
accounting and core receipt chain. Different terminal evidence is never overwritten.

`executionAccounting.allocatedCostUsdMicros` is a configured-rate estimate;
`providerBilledCostUsdMicros` stays null and `costStatus` stays `not_measured` for
actual billing. The child deadline does not forcibly bound parent artifact readback
or stop the rented VM's bill. Qualification and approval remain unchanged. Existing
unsupervised v1 bindings, candidates, and local CLI behavior are preserved.

The supervised bridge passes 16 focused cases, including simultaneous accounting
writers, different valid status snapshots, conflicting terminal evidence, retained
cost after an audio-download error, and a genuinely separate recovery process.
The independent real SDK/CLI/Python integration run passed all three modes:
legacy (21 CLI processes, 90 local S3 requests), supervised success (23 processes,
89 requests), and supervised failure (12 processes, 42 requests). Each mode made
exactly one worker POST and one synthetic inference. The failure mode retained
positive allocation without creating a candidate, then recovered offline from R2
fixture evidence. These checks use local synthetic services, not live R2 or GPU
qualification.

### Unsupervised durability evidence, 20 September

`scripts/test-yue2-durable-integration.ts` runs separate actual CLI processes
against the sibling Python HTTP worker and a local S3-compatible fixture through
the real storage SDK. The independently repeated run used 21 CLI processes,
90 local S3 requests and two immutable-write collisions, but exactly one worker
POST and one synthetic inference. It deliberately loses an accepted POST
response, races submissions, changes inputs and endpoint, corrupts retained
bytes, and checks observed-job disappearance. Each process has a fresh local
directory and a restricted test-only environment. No Cloudflare, OpenRelay,
GPU model, or live billing service participates.

The durable core also passes 19 offline behavioral cases, including late storage
writes, revoked submission authority, failed/invalid observed worker jobs,
interrupted output persistence, retained-byte corruption and real FFprobe
native-format refusal. The shared client/CLI suite passes 56 checks, including
late audio completion after cancellation, empty/tiny-chunk streaming and an
absolute deadline that cannot be starved by immediate empty chunks. The storage
reader passes 17 checks, including a deadline shared across credential refresh
and retries; callers that omit the new byte limit retain their old behavior. Neither
suite treats native-container validity or exactly-once submission as musical
quality evidence.

The final batch gate passed all 848 direct readiness tests, scoped ESLint and
the structural audit with unchanged baselines. The optimized build passed
TypeScript and generated all 69 static pages without warnings. The hermetic
assembly smoke rendered a real 1920x1080 master lasting 31.021995 seconds from
synthetic sources; it used local storage, not a live R2/provider qualification.
Graphify was refreshed (24,643 nodes and 60,227 edges). Production health still
reported `722facc4f5aaad004dcd9f96de3be7a29951a520`; no deployment, channel
migration or separate runtime repository change belongs to this batch.

```bash
YUE2_TEST_RUNTIME=/home/ubuntu/youtube-studio-music-runtime \
  node_modules/.bin/tsx scripts/test-yue2-durable-integration.ts
```

## Verification and parent support

### Read-only owner review

`GET /api/yue2-evaluations/review?runId=<owned-run-id>` authenticates the Studio
session/service identity, verifies run and channel ownership, and reads only the
retained supervised v2 candidate. It never submits, repairs, regenerates, writes
an approval, or advances a pipeline. Missing candidates return `review: null`;
incomplete or corrupt evidence fails closed without signing an audio URL.

The reader checks the request, scope, submission marker, policy, allocation,
terminal receipt, provenance, audio hash and actual native WAV container before
issuing a ten-minute download URL. The review server needs FFprobe; a missing
binary refuses review rather than trusting a worker's format claim. This route
has not been qualified on the production web deployment.

Quality is separate from transport correctness. Exact requested duration is
compared with measured frame count; a 0.1-second fixture for a 60-second brief is
explicitly blocked despite valid native format. Signal integrity, unwanted
vocals, channel-personality fit, arrangement fidelity, repetition, ending and
listening quality remain unresolved, not invented passing scores. The accepted
arrangement and topic are exposed, but a source-brief fingerprint alone does not
prove channel-personality compliance. Human review/decision UI, retained
personality/reference context, signal measurements and real GPU/audio
qualification remain required. No thumbnail module changes are part of this work.

```bash
node_modules/.bin/tsx src/lib/__tests__/yue2Evaluation.test.ts
node_modules/.bin/tsx src/lib/__tests__/yue2DurableEvaluation.test.ts
node_modules/.bin/tsx src/lib/__tests__/storageBoundedRead.test.ts
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
