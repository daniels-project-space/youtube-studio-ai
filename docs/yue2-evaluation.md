# YuE2 evaluation integration

Evaluation only. The caller supplies either a fingerprint-bound accepted music
arrangement or, for legacy experiments, an admitted ChannelMusicProgram JSON and
independent exact style text. Empty lyrics are used; Music3 tags are never translated
into YuE syntax. No channel intent, duration guarantee or instrumental guarantee is invented.
No production provider enum/default or legacy pipeline/channel writes occur.

## Explicit shared music intent

The opt-in composer version accepts typed `params.musicIntent` constraints:

```json
[
  {
    "block": "composer_brief",
    "version": "2.0.0-accepted-arrangement",
    "params": {
      "musicIntent": {
        "role": "narration_bed",
        "requestedDurationSec": 90,
        "form": "through_composed",
        "ending": "natural_cadence",
        "playback": "once"
      }
    }
  },
  { "block": "music_arrangement_plan" }
]
```

Each field is optional; omitted fields remain composer decisions guided by the
frozen channel/episode context, not invented family defaults. Role supports
`primary_music`, `narration_bed`, `meditation_bed` and `short_form_bed`. Duration
is the requested **native source piece**, an integer from 10 to 300 seconds, not
the final session/video duration. Form is `continuous`, `through_composed` or
`sectional`. Ending and playback remain independent: a natural cadence may repeat
and a seamless ending may play once if that is what the caller explicitly asks.

Compilation and direct execution reject invalid/unknown controls before text
dispatch. The actual composer prompt retains the exact supplied values in its
review context. A contradictory model response is held for paid reconciliation,
not silently clamped, accepted or automatically repurchased. The planner checks
restored briefs again. The typed intent is retained in both the source brief and
accepted artifact and bound by their fingerprints; even a newly recomputed hash
cannot make an arrangement that contradicts retained intent pass validation.
The existing YuE request constructor therefore validates the same constraints
before transport. Absence of intent leaves existing artifact shape/hashes intact.

Local evidence covers all four roles through the real compiler/runner/composer/
planner/YuE-request path, wrong values for every control, zero-dispatch invalid
inputs, immutable review grounding and preservation of one observed synthetic
charge after rejection despite a configured retry allowance. Provider transport
and native-format/recovery regressions use synthetic audio and stubbed HTTP.
This qualifies the intent handoff, not musical adherence or channel personality
in generated audio. Real RTX3090 qualification, auditions and the production
music/assembly handoff remain open. Legacy composer selection and current channel
pipelines are unchanged; no GPU/text purchase, thumbnail generation or deployment
is authorized by this example.

Enable these controls only after the composer and arrangement readers/CLI share
the updated schema. Older strict readers reject the new optional artifact field.
Changing intent changes the bound request identity; an existing durable run must
hold that mismatch rather than submit another take under its old binding.

20 September verification: all 841 selected offline readiness files passed,
with 30 thumbnail-named files excluded; TypeScript, scoped lint and the post-edit
code-graph refresh also passed. The log is
`/tmp/studio-offline-readiness-musicintent-20260920.log`. This partial local gate
does not establish production readiness or real generated-audio quality.

## Accepted arrangement entry

### Read an accepted Studio run directly

The evaluator can now consume the saved `music_arrangement_plan` output without
exporting or reconstructing its JSON first:

```bash
npx tsx src/scripts/evaluate-yue2-music.ts \
  --run-id RUN_ID --owner-id OWNER_ID \
  --seed 42 --personal-creator --durable-r2
```

This explicit input mode performs one authenticated Convex query, then validates
the complete artifact, its fingerprints and exact owner/channel/run scope. It
requires the configured Studio service signing credentials and
`NEXT_PUBLIC_CONVEX_URL` (or `CONVEX_URL`). It does not bootstrap new credentials.
The request has a 30-second transport deadline. The query uses the existing
`by_run_block` index, reads at most two matching stages to detect duplicates and
returns only the arrangement plus scope, not the other stage inputs/outputs.
Only a unique `ok` planner stage is eligible; missing, failed, superseded,
foreign-owner or oversized records are refused. Owner/viewer browser identities
cannot invoke this service-only handoff.

Without `--submit`, this mode contacts no worker or R2 service and performs no
generation. Its JSON reports the one Convex request and zero worker requests;
file-input validation remains entirely offline. `--run-id` and `--owner-id`
must appear together and cannot be combined with a separate arrangement, program
or style file. Invalid arguments fail before the query.

For an explicitly authorized supervised evaluation, the existing
`--execution-policy POLICY.json --submit` controls and worker credentials still
apply. Recovery uses the same input with `--submit --recover-only`; the original
durable run binding and submission marker remain authoritative. If the saved
arrangement has changed, durable recovery refuses the mismatch rather than
replacing the original take. The saved artifact does not grant generation,
production or publishing approval.

21 September local evidence: five real compiler/composer/planner outputs pass
unchanged through the real signed Convex HTTP client, authenticated query handler
and CLI request constructor using offline storage/HTTP fixtures. Negative cases
cover auth, scope, stage state, duplicate rows, oversize and fingerprint damage.
A stubbed worker additionally receives one exact job POST; recovery is GET-only,
and loss of its job record cannot erase the local submission marker. No cloud
deployment, GPU generation, thumbnail generation or musical-quality claim is
part of this evidence. Deploy the new Convex query before using this CLI input
against production; the existing file path remains available.

The 61 evaluator, 19 durable-storage, shared stage-projection and security-boundary
regressions also passed offline, alongside TypeScript and scoped lint. The full
repository release gate was not rerun for this additive read-only query/CLI path;
the previous 842-file run covers the unchanged infrastructure batch, not this new
input mode. No deployment readiness is inferred from these focused checks.

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
The runtime's `docs/SUPERVISION.md` documents the contained inference and artifact
readback deadlines, remaining parent metadata/GET limitations, containment, and
GPU qualification still required. Artifact verification now uses a separate
contained process with only the original execution allowance remaining; a stalled
readback holds the slot rather than allowing replacement inference. The v1 receipt
shape and conservative child-process-only scope are unchanged; this is not a hard
VM billing limit or proof of GPU cancellation.

The opt-in `scripts/test-yue2-supervised-integration.ts` check uses
`YUE2_TEST_RUNTIME=/home/ubuntu/youtube-studio-music-runtime`. It starts an isolated
real Python HTTP worker with a synthetic CPU backend, rejects missing/changed
policy headers, validates the sealed accounting chain, probes native FLOAT audio,
and confirms recovery used exactly one inference. This is integration evidence,
not generated-music quality or a provider-cost measurement.

The 20 September intent follow-up now sends a real intent-bearing arrangement
through this cross-language boundary. Three contradictory, independently rehashed
roles are rejected by both request construction and client admission before any
HTTP call. The valid client sends exactly one job POST across submission and
GET-only recovery (separate deliberately invalid policy POSTs remain in the test).
The Python fixture independently reports one inference and verifies its children
were reaped. Native output is explicitly checked as one second against a
60-second intent: a completed worker receipt must not be reported as requested
duration adherence. This test passed with external networking disabled; scoped
lint and TypeScript passed. Runtime sources, production settings and provider
credentials were not changed. No GPU/audio-quality qualification is inferred.

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
explicitly blocked despite valid native format. A full-file, bounded FFmpeg
decode additionally measures per-channel sample peak, RMS, DC offset, non-finite
values, nonzero samples, samples at/above full scale and consecutive full-scale
runs. Digital silence, constant signals, dead stereo channels, non-finite data,
and full-scale samples require review. This is not a claim that every full-scale
sample is audibly clipped; sample counts alone cannot detect intersample overload.

The YuE reader now opts into FFmpeg's `ebur128=peak=true` meter on a parallel
analysis branch in the same decoder process. Its internally oversampled signal
goes only to a null sink; the raw native-sample branch and stored WAV are unchanged.
This uses the existing process deadline, decoded-byte ceiling, 64 KiB diagnostic
bound and hash-keyed analysis cache, with no extra worker job, R2 write or decoded
output file. It adds CPU work inside that process; no CPU/billing reduction is
claimed. Other callers retain sample-only behavior unless explicitly opted in.
See [FFmpeg's ebur128 reference](https://ffmpeg.org/ffmpeg-filters.html#ebur128)
and [the final-summary implementation](https://ffmpeg.org/doxygen/7.1/f__ebur128_8c_source.html).

The final true-peak summary has 0.1 dB resolution, exposed alongside the reading.
A reported value at or above 0.0 dBTP requires review, conservatively including
the rounding interval around zero; this is not a universal mastering target or
a claim of audible clipping. Missing/duplicate summaries, invalid samples or a
reading below the independently measured native sample peak beyond rounding
tolerance are unavailable and block review. Negative infinity is represented as
digital silence only when the native decoder independently confirms every sample
is zero. A measured result removes `true_peak` from unresolved checks, but never
grants production approval or certifies the subsequent mix/encoded delivery.

21 September offline evidence includes a 12 kHz phase-offset FLOAT fixture whose
stored samples stay below full scale but whose measured true peak exceeds it.
The old sample-only check accepts that counterexample; the new meter flags it,
and the actual retained-candidate reader blocks a duration-correct 60-second
version without writes or worker calls. Clean tone, silence, nonfinite input,
partial tails, absent/duplicate/incoherent meter records and native-byte identity
are also covered. Real Chromium playback/seek and desktop/mobile/enlarged-text
review checks pass with synthetic audio; desktop/mobile screenshots were inspected
at `/tmp/yue-review-browser-safsFv`. This is technical regression evidence, not a
real YuE music audition or a production deployment.

The same native decode measures an equal-weight mono fold-down, with finite
frame count, nonzero frame count, peak and RMS. Complete cancellation of varying
stereo content requires review even when both individual channels look healthy
and the requested duration matches. Invalid frames remain unknown, not silence.
Partial cancellation and stereo width are measured, not generic failures; this
check neither modifies the source nor certifies perceptual mono compatibility.

Quiet windows use a declared -60 dBFS peak threshold and 100 ms windows; their
fraction and longest consecutive window run are observations, not a generic
rejection threshold. Quiet sleep/meditation material is not automatically bad.
The decoder preserves sample rate/channel layout, never normalizes the audio,
streams rather than retaining a second decoded file, and enforces the exact
probed sample count, a 256 MiB decode ceiling, a 30-second deadline and bounded
diagnostics. The review runtime needs FFmpeg as well as FFprobe.

Perceptual artifacts, unwanted
vocals, channel-personality fit, arrangement fidelity, repetition, ending and
listening quality remain unresolved, not invented passing scores. New opt-in
composer outputs retain `music-review-context/v1`: the exact prompt context
containing channel positioning, vibe, motif, works/avoid lists, doctrine,
Style-DNA, role directives and any serialized-episode context supplied to the
composer, plus topic, family and channel name. It is created server-side before
dispatch, never authored by the model. The family is now explicit in that
composer's prompt. Context fingerprints are bound into the source brief and
accepted arrangement, then preserved through the durable evaluation request.
The provider's accepted music direction is not silently rewritten to add it.

The review endpoint exposes the retained context for comparison and keeps
`channelPersonalityVerified: false`. Older artifacts remain unchanged and show
`contextRetained: false`; live channel settings are not used to reconstruct or
backfill historical intent. Retention alone does not prove channel-personality
compliance. The run detail page now offers an on-demand YuE evaluation section
for runs with a `music_arrangement_plan` stage. It reads this verified endpoint
only when opened, plays the native WAV, seeks to intended section starts, and
shows retained channel intent, arrangement, measured defects, unresolved checks,
candidate/source hashes and the allocation estimate separately from the unknown
provider bill. Missing context, absent candidates, authentication failures,
invalid evidence and audio failures have explicit states. Reload performs a
fresh verification/signing request; closing or switching runs cancels pending
requests and discards late responses. There is no approval, generation or
publishing action, and no automatic polling or background audio signing.

`tsx scripts/yue2-review-browser-proof.mts` exercises the actual component and
native Chromium WAV decoding/seeking/playback with synthetic API/audio fixtures.
Desktop, phone and enlarged-text screenshots are inspected; error/retry,
missing-context, blocked-duration, expired-audio and stale-run cases pass.
This is local UI evidence, not a live retained GPU candidate audition.

The native analyzer follows the existing external-FFmpeg tracing convention;
the configurable binary is provided by the runtime, not copied from the project.
After a production build, `node scripts/check-yue2-review-bundle.mjs` rejects
accidental inclusion of project sources, graph output, test fixtures, docs,
scripts, Git data or environment files in this route's deployment trace.

### Persistent Owner Audition

The on-demand review now offers an owner audition form with seven explicit
judgments, an ordered review of every accepted section, full-source listening
acknowledgment, notes, and a needs-work/rejected/promising verdict. No judgment
defaults to passing. Promising requires retained personality context, no blocking
technical findings, complete listening and passing documented section judgments.
It is not production approval and does not remove unresolved technical checks.

POST to the review endpoint requires a same-origin owner session, bounds the body
to 64 KiB and ten seconds, verifies owner/run/channel scope, and freshly verifies
the retained receipts and actual WAV before comparing the submitted candidate
digest and ordered section IDs. The browser cannot supply measurement facts,
storage keys, reviewer identity, timestamps or approval authority.

The service-only Convex `yue2Auditions` handlers append changed judgments without
rewriting earlier rows. Repeating the latest identical submission is idempotent;
the read uses one candidate-scoped indexed latest-row query. There is no new poll,
Trigger task, generation, publication, or pipeline continuation. Closing or
switching review abandons late responses; an ambiguous save requires reload.

Local contract, actual route/session, and actual Convex-handler fixture checks
cover rejection and persistence boundaries. Chromium exercises native playback,
responsive audition editing, save/reload and incomplete-verdict gating against a
synthetic API. This is not deployed database persistence or real GPU qualification.
Deploy the Convex table/functions before the web callers; production is unchanged.

Reference comparisons, remaining perceptual measurements, real GPU/audio
qualification and the audition-to-production handoff remain required. No thumbnail
module changes are part of this work.

### Shared Music Admission Safety

The shared legacy `music` executor now rejects any explicitly supplied provider
outside its supported enum before storage or generation. In particular, setting
`provider: "yue2"` is not an activation mechanism: it refuses instead of silently
falling through to Mureka. Omitted provider selection retains the existing default;
valid Suno, Mureka and MiniMax selections and legacy reuse remain unchanged.

Prepared weekly music is also checked against the executing owner, channel and
topic before any program write or audio read. Its sealed program is parsed with
the existing fingerprint-validating schema and checked independently against the
channel and topic. This supplements, not replaces, the scheduled manifest validator
and downstream exact-byte/native-quality checks. Frozen identity is not recomputed
from live channel settings, and existing commercial-provider failover is unchanged.

`musicInputAdmission.test.ts` executes the real shared block with network and
storage instrumentation: unknown/coerced providers, foreign receipts, a valid but
foreign sealed program, and a corrupt fingerprint all fail before I/O. Supported
reuse and matching-program admission remain covered. This is local safety evidence,
not a live YuE generation or a completed audition-to-production handoff.

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

### Per-channel native signal admission (21 September)

The native analyzer previously rejected wholly constant audio and a completely
silent stereo channel, but missed one channel stuck at a nonzero constant while
the other channel varied. A real FLOAT WAV regression failed under that gate:
the damaged channel produced no review reason despite containing no variation.
The analyzer now reports `constant_channel_requires_review` for that case using
the existing full-file finite-sample/minimum/maximum measurements. No additional
decoder process, provider call, storage read, or numerical threshold is added.
The original file is not repaired or normalized.

Real FFmpeg fixtures cover either channel stuck at positive or negative DC.
Quiet but varying channels, varying audio with a small DC offset, wide stereo,
partial mono cancellation and the existing clean/silent/full-scale cases retain
their prior admission. This is an exact stuck-signal check, not a calibrated
general DC-offset, stereo-balance or artistic-quality classifier.

Two complete 60-second retained-candidate fixtures traverse native probing,
signal measurement, durable identity/accounting checks and audition validation.
The healthy fixture remains `needs_audition`; the stuck-channel fixture is
`blocked`, and even a submission claiming every human check passed cannot mark
it `promising`. Review causes no worker request, authorization or storage write.
Both remain production-unapproved. Five focused test files pass, including all
26 supervised durable integration contracts, the authenticated review route and
audition persistence handlers; TypeScript and scoped lint pass.
This uses synthetic audio only, with no thumbnail/GPU generation or deployment.

### Opt-in checkpointed result recovery (21 September)

Add `--queue-recovery` to an explicitly authorized supervised
`--durable-r2 --submit --execution-policy POLICY.json` invocation to queue
`yue2-evaluation-recovery` only when the existing job is pending. The CLI requires
`TRIGGER_SECRET_KEY`; the task must already be deployed with the same
`YUE2_EVALUATION_URL`, `YUE2_EVALUATION_TOKEN`, and scoped R2 credentials.
This change does not deploy the task or authorize a live evaluation.

Delivery contains only owner, channel, run and job IDs. A job-derived 24-hour
idempotency key deduplicates queue delivery. The pending result is printed before
delivery so a queue outage does not conceal the existing job. Retry delivery
with the same inputs and `--recover-only --queue-recovery`; do not start a new
generation to recover a lost acknowledgement.

The task restores the exact retained v2 supervised binding and verifies its
scope, request, configured endpoint and execution policy. Recovery is GET-only:
it cannot authorize a generation, including when the remote job is missing.
It uses 120-second Trigger checkpoint waits, not active sleeps, with at most
`ceil((max_execution_seconds + termination_grace_seconds) / 120) + 2` checks
(63 under the current maximum policy). It has one task attempt, concurrency two,
and no cron, Convex polling, GPU lifecycle control or automatic provider retry.
An exhausted window remains pending with `recovery_window_exhausted`; it is not
evidence of completion or permission to resubmit. Native audio and accounting
checks remain mandatory, and all results remain production-unapproved.

Eight focused test files pass in a network-isolated serial gate (20 top-level
tests, including 29 supervised durable integration contracts). Coverage includes
actual task pending-to-completed recovery, scope rejection, missing remote jobs,
bounded exhaustion, offline replay and CLI delivery failure/retry. The initial
concurrent gate exposed a shared temporary-directory assertion collision; serial
execution isolates those suites. TypeScript and scoped lint pass. Provider and
queue boundaries are simulated: this is not live Trigger checkpoint, GPU,
musical-quality or production billing evidence. No thumbnail tests or generation
were run.

### Real image, model cache and OpenRelay placement preflight (21 September)

The separate runtime source `373e13933d0127847d266740153ac22769b4a2a9` now builds
`youtube-studio/yue2:373e139`, actual local image ID
`sha256:dba5667c11bfcfc791111b13342c765de9e642d62cdfba51d72582a859bd2ff7`.
Official source hashes, package pins, the actual pipeline import, and CUDA 12.8
libraries pass. Five real cache files (7,794,517,915 bytes) passed pinned SHA-256
verification again with network disabled and a read-only model mount. This is
software/cache evidence, not GPU inference or music-quality qualification.
The runtime has 102 passing CPU tests and its own clean, pushed repository.

Read-only placement inspection is now an executable Studio operator command:

```sh
ai-vault youtube OPENRELAY_API_KEY=OPENRELAY_API_KEY -- \
  node_modules/.bin/tsx src/scripts/preflight-yue2-openrelay.ts \
  626c2959-4f58-4779-b867-2a74129e93e5 18
```

It validates the account, exact RTX 3090/24 GB identity, bounded hourly rate,
single-GPU placement, and RAM/disk/CPU on the **same** live offer. Default
placement could choose 25,454 MiB guest RAM, too tight for the runtime's 24 GiB
available-memory gate after the OS. The plan explicitly requests 28,672 MiB,
one GPU, a separate 60 GB disk, private endpoint and no GPU fallback. Actual
available memory must still pass runtime preflight; requested RAM is not proof.

The provider's paginated VM inventory is inspected for the Studio-specific
`yt-yue2-3090-evaluation` name. Repeated cursors, more than five pages, malformed
evidence, duplicate matches, wrong account, and insufficient joint resources
refuse a plan. No create/restart/stop or inference endpoint is called. Keys and
raw provider error bodies are never printed.

The 11:24 UTC recheck exposed a scope-label false rejection: the canonical key
reported `clusters:read`/`clusters:write`, while the real availability, pricing,
VM inventory and SSH-key endpoints all returned HTTP 200. Preflight now records
the reported labels but establishes read access through the actual authenticated
GETs. A wrong organization, HTTP denial or invalid response still fails. Read
access is not write authority or spend authorization; all creation/qualification
flags stay false. The Studio-scoped vault copy also passed independently. No
key was replaced or weakened to work around a server-side denial.

The live 10:55 UTC check found one compatible offer at 18 cents/hour, and no
existing Studio YuE2 VM. Its retained report is
`/var/lib/youtube-studio-render/builds/yue2-373e139/openrelay-preflight.json`.
Capacity is ephemeral and must be refreshed immediately before any placement.
The report explicitly leaves storage price, spend authorization, placement and
GPU qualification unverified. It cannot authorize a purchase, represent a hard
VM bill cap, or substitute for the existing supervised execution policy.

Regression checks reject the real narrow-RAM offer, resources split across
different offers, stale/insufficient free resources, a different GPU, ambiguous
or excessive rates, wrong-account reads, and incomplete pagination. The actual
live read-only CLI also passed after its initial array-only VM parser was fixed
to use OpenRelay's `VmPage` contract. No legacy channel route was changed.
