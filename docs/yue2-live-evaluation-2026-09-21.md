# First Live YuE2 Evaluation

This is a runtime evaluation, not an approved channel soundtrack or a completed
shared-music integration. No legacy pipeline or thumbnail generation was changed.

## Execution Evidence

- Studio VM: `29e245a2-2e1a-431e-b5b3-654cf0ba1587`, one RTX 3090, 60 GB separate disk.
- Runtime source: `e5e59b74cd15c3dd3c483c8e6df89f1e44592214`.
- Remote image: `sha256:beef55e2f9ad478c54d613eb6a063118c46b41cd0e5f4ee8ee80937d5a5f9e87`.
- Successful job: `studio-lofi-yue2-3090-20260921-02`, seed `831001`.
- Personal-creator acknowledgement only; company commercial use remains false.
- Full planning, BF16 model, FP32 VAE, no quantization, 32 midpoint ODE steps,
  context 24576, native 48 kHz stereo FLOAT output. No CPU/model fallback.
- Network-disabled container, read-only model cache, separate durable ledger,
  UID/GID 1000, dropped capabilities and no-new-privileges. Actual supervisor
  child seccomp, parent-death protection, deadline and artifact readback ran.
- Both planning and semantic truncation flags are false.
- Generation timing: 122.045 seconds; full supervised accounting: 133.187 seconds.
- Configured-rate generation allocation estimate: USD 0.006660. This excludes
  build, transfer and idle rental and is not a provider invoice.

The first job (`...-01`) failed after model load because the image lacked a passwd
entry for UID 1000. The image now registers `studio`. The failed job and its
accounting are retained; it was not overwritten or disguised as a successful run.
The explicit retry kept the same prompt, seed, weights and inference settings.

## Output And Review

The probe requested instrumental lo-fi hip-hop with Rhodes, upright bass, brushed
drums, a restrained late-night study feel, 72 BPM and approximately 30 seconds.
It was a runtime probe, not a profile extracted from an existing channel.

- Actual duration: **228.478667 seconds**, not the requested approximately 30.
- Native format: `pcm_f32le`, 48,000 Hz, stereo, 10,966,976 frames.
- Native WAV bytes: 87,735,896.
- Native WAV SHA-256: `dd808b1ab6068f7e5e214a04d9dfb3c57026ba71300825a6a84a527575e46cfd`.
- Symbolic score declares 73 BPM; that is not a measurement of audible tempo.
- Full-file signal analysis: zero non-finite samples; 94 full-scale samples;
  maximum full-scale run of four samples; true peak +0.3 dBTP.
- Longest below-60-dBFS quiet-window run: 0.3 seconds. Mono fold-down is nonzero.

**Hold for review.** The existing signal analyzer flags full-scale samples and
true peak. It does not establish good composition, absence of vocals, a natural
ending, channel personality or listener comfort. No musical audition is claimed.
The substantial duration mismatch also remains unresolved. Do not silently trim,
loop, normalize or approve this file to make the result appear compliant.

The official decoder's clamp was preserved. A later gain adjustment cannot restore
samples already clipped by that decoder. Musical review and appropriate source
admission remain necessary before mastering or production selection.

## Retained Artifacts

Controller root: `/var/lib/youtube-studio-render/operator/`.

- `yue2-second-evaluation-result.json`: supervised result and accounting.
- `yue2-live-evidence-20260921/`: both attempts, receipt chains, native WAV/NPY,
  official FLAC, plans, tokens, latents and effective configuration.
- `yue2-native-receipt-readback.json`: independent offline runtime inspection of
  the copied successful ledger and artifact hashes.
- `yue2-first-native-signal.json`: full-file measurement report, not a repair.
- `yue2-lofi-evaluation-preview.mp3`: listening derivative only; native WAV unchanged.
- `credential-validation-state.json`: verified terminal VM shutdown after retrieval.

The VM retains its build, weights and original ledger while stopped. The external
shutdown guard was separate from inference supervision. The existing USD 1 total
compute authorization was retained; no new storage purchase or private-image
upload was performed. Future work must account for this session before restarting.

## Next Integration Gates

### Native Timing Versus Delivery Timing

Offline inspection of the pinned VAE's actual `natural_output_length` method
verified all 291 integer durations from 10 through 300 seconds. It returns
`1920 * latent_frames - 64` samples at 48 kHz. The live output's 5,712 latent
frames likewise produce exactly 10,966,976 samples. The proof used meta tensors,
the hash-verified VAE configuration and pinned library, without inference or GPU
allocation; receipt: `yue2-native-timing-proof.json` in the controller root.

Retained review now distinguishes exact delivery frames from the precise native
64-sample boundary. Either timing can reach source audition if signal checks pass;
only exact frame equality sets `durationMatches`. Codec-aligned output retains an
unresolved `exact_delivery_duration` check. There is no percentage tolerance,
trimming, padding or production approval. One-sample deviations from the native
boundary, the live-sized duration mismatch, silence and intersample overload are
covered through the durable review path with actual FFmpeg signal analysis.

This fixes an impossible native timing gate, not the model's duration planning.
The real 228-second candidate remains unsuitable for its 30-second request.

### Early Duration Refusal

New accepted-arrangement jobs use schema v2 with `requested_duration_sec` bound
to the arrangement and job ID. The runtime retains full score/token diagnostics
but refuses semantic sequences other than exactly 25 frames per requested second
before NAR synthesis and VAE decode. For the observed failed-duration track, that
would avoid its measured 37.95-second NAR and 6.85-second VAE stages, not the prior
planning or semantic generation. This is a counterfactual saving, not a billed
benchmark. Sampling settings, full planning and precision are unchanged.

The v1 diagnostic job and all retained evidence remain readable. The schema-v2
runtime must be deployed before new arrangement submissions; the previous image
rejects the new field. This contract is CPU/wire-tested, not yet GPU-deployed.
Actual duration-conditioned composition and private-worker deployment remain open.

### Explicit Score Path

The pinned upstream native ABC helper parses the actual retained score as 73 bars
at 73 BPM: exactly 240 symbolic seconds. It contains 220 sounding notes in the
Vocal voice and 142 in Ins. These are notation facts, not proof of audible vocals.
The roughly 228-second performance also shows that symbolic timing and measured
audio timing differ. Inspection is retained in `yue2-live-score-inspection.json`.

Studio now accepts an optional `--score-file` with an accepted arrangement. Exact
score text is bound into the job ID and passed through the official `SongRequest.abc`
API. The runtime uses the pinned, unmodified upstream parser to reject malformed
notation or wrong symbolic duration before GPU preflight, then preserves the
score through full melody-and-chord conditioning. Existing semantic-duration and
audio-quality gates remain in place. Local CLI validation explicitly labels native
score validation as pending until the runtime checks it.

The sibling runtime includes a nine-bar, 72-BPM, 30-second diagnostic composition
with a resting Vocal staff, instrumental melody and natural cadence. Its musical
quality and generated timing are not qualified; it is neither a channel-specific
track nor a loop. CPU tests and a real local Python HTTP exchange verify this
request path, including pre-admission rejection of a wrong-duration score. No GPU
run of this score has occurred yet, and the channel-aware automatic score planner
and private-worker deployment remain open.

1. Review actual audio, vocal leakage, endings and channel-specific fit.
2. Resolve duration planning before claiming arrangement compliance.
3. Connect the private worker and immutable evidence to the existing accepted
   shared-music handoff and owner review path without bypassing its gates.
4. Keep `production_approved` false until output-specific admission is satisfied.

## Live Supplied-Score Evaluation

Two score jobs ran on the same isolated RTX 3090 on 2026-09-21:

- `studio-lofi-yue2-3090-score-20260921-01` exposed a lazy-load assumption:
  the official external-score path leaves `_model` unset until semantic work.
  Runtime `53d5a804d604d048fbb2e16b113e66a9817bec05` fixes precision verification
  by loading the same pinned BF16 model first. Its regression fixture now models
  the real lazy state. The failed attempt remains retained.
- `studio-lofi-yue2-3090-score-20260921-02` used the identical score, style,
  seed and quality settings. Image:
  `sha256:c620276e1b0510b41249e428220ee50f9bc7a42f7e2664a531121abb860618a6`.
  Full semantic generation completed without truncation: 911 content frames,
  not the requested 750. The pinned decoder predicts 1,749,056 PCM frames,
  or 36.438667 seconds. The strict duration gate refused before NAR/VAE; no
  new audio exists for these attempts and no musical audition is claimed.
- Supervised wall times were 18.640 and 30.632 seconds; configured-rate
  allocation estimates were USD 0.000932 and USD 0.001532, excluding build,
  idle and transfer rental. These are not provider invoices.

Both jobs and supervision ledgers were retrieved to
`/var/lib/youtube-studio-render/operator/yue2-score-evidence-20260921/` and
independently verified with the runtime's artifact and supervision inspectors.
The provider confirmed VM shutdown after retrieval. The external shutdown guard
is inactive only after terminal shutdown verification.

### Approved Loop Timing Policy

Daniel explicitly chose: "Allow natural-length loop sources; keep final video
duration exact". New repeat-playback primary-music and meditation-bed jobs now
bind `source_duration_policy: natural_loop` into their job identity. One-shot,
narration-bed and short-form jobs retain strict timing. Older saved jobs default
to their original exact policy; no retained request is reinterpreted or overwritten.

Natural-loop source review accepts only the supported 10-300-second native codec
geometry. Signal checks, full-source audition, channel fit, endings and production
approval remain separate gates. Source duration can vary; exact final video
duration remains unresolved until verified by assembly. This policy must not be
used to silently crop music or call an unreviewed ending seamless.

### Completed Natural-Length Evaluation

Job `studio-lofi-yue2-3090-natural-loop-20260921-01` completed under the approved
policy using runtime `15cf466c5b28fcec4e1bd5fab6ddbd2167db8e78` and remote image
`sha256:619c625fc14587524a1336989889d65f1c029633220465f9f5acad19dcae6ee9`.
Only the job ID and explicit duration policy changed from the strict score retry.
The semantic array hash is identical across those two runs, proving this policy
did not silently alter, shorten or regenerate a different token sequence.

- Native output: 1,749,056 frames, 36.438667 seconds, 48 kHz stereo `pcm_f32le`.
- WAV: 13,992,536 bytes; SHA-256
  `4cfb91af194c2120a68d4d596252ef2cc5742a7a60823c870a31d2a2a6b5d8d7`.
- Both truncation flags false; 911 complete semantic frames, unchanged BF16
  model, FP32 VAE and 32 midpoint ODE steps.
- Supervisor elapsed 44.077489 seconds; generation-stage elapsed 29.665121
  seconds, including 8.487415 semantic, 4.780524 NAR and 4.262287 VAE seconds.
- Configured-rate allocation estimate USD 0.002204, not a provider invoice and
  excluding build, idle and transfer rental.
- Full-file measurements: zero non-finite samples, 474 full-scale samples,
  longest full-scale run 41 samples, +0.1 dBTP, no below-60-dBFS quiet windows,
  and nonzero mono fold-down. Both full-scale and true-peak review flags remain.

**Rendering works; output quality remains on hold.** No musical audition,
instrumental-only guarantee, channel fit, seamless wrap or exact assembled-video
duration is claimed. The current official `pipeline.decode` explicitly clamps
decoded floats to [-1, 1]. Lowering the retained WAV's gain cannot restore clipped
transients. The preserved latents permit a separately recorded decoder/headroom
investigation without purchasing another composition; no decoder behavior was
changed in this evaluation.

Artifacts: `/var/lib/youtube-studio-render/operator/yue2-natural-loop-evidence-20260921/`.
The complete copied ledger and artifact hashes passed independent runtime
inspection; ffprobe confirmed the actual WAV container and frame count. Listening
derivative: `/var/lib/youtube-studio-render/operator/yue2-natural-loop-preview.mp3`.
Native WAV unchanged. VM shutdown was verified after retrieval; its external
guard is inactive. No thumbnail work, legacy pipeline changes or production
Vercel/Trigger/Convex deployment occurred.

### Verified Pre-Clamp Recovery

`infra/studio-render/yue2_decode_headroom.py` decoded the retained natural-loop
latents on the same RTX 3090 and pinned image, without composing again. The
original ledger and models were read-only, with a source-ledger lock, no container
network, a 180-second process deadline and external bounded shutdown guard.

The official re-decode was sample-identical to the retained WAV. Calling the
same FP32 VAE's tiled decoder before its output clamp recovered 474 samples
outside [-1, 1], with a raw peak of 1.1233507395 (+1.010308 dBFS). Clamping these
recovered floats reproduces **every original sample exactly**. This proves the
official output clamp explains this candidate's measured full-scale samples;
it does not establish that all possible distortion or musical defects are gone.

The decode-only diagnostic completed in 20.332717 seconds. Original source,
precision, weights, tiling, frame count and duration were unchanged. Its sealed
receipt and all artifact hashes were independently verified after retrieval.
Evidence: `/var/lib/youtube-studio-render/operator/yue2-headroom-evidence-20260921/comparison/`.

- Unclipped FLOAT WAV SHA-256:
  `d9ff35524fbfca09e96b66c565ed0fd3fc06e438e065e0136b37ecca8f42bc5b`.
- Sealed result file SHA-256:
  `814f2ae484073ae653a09a172112fbad1009a15c855cb931392ee3dd61d45ec0`.
- A separate local listening derivative applies only `ffmpeg -af volume=-3dB`
  to the **unclipped** WAV, retaining 48 kHz stereo FLOAT and 1,749,056 frames.
  Full-file measurements: zero non-finite or full-scale samples, -2.0 dBTP,
  no signal-review reasons, and unchanged 36.438667-second duration.
- Derivative `/var/lib/youtube-studio-render/operator/yue2-headroom-minus3db.wav`
  SHA-256 `d33412abaaf851be6bf41c177a34bd55b2eedb969c54d3974d74733ed3b22499`.
  Listening MP3: `/var/lib/youtube-studio-render/operator/yue2-headroom-preview.mp3`.

This is a diagnostic and listening derivative, **not a production decoder change
or automatic approval**. Future integration must preserve pre-clamp floats and
explicit mastering lineage; lowering the already-clipped original is not a fix.
Channel personality, musical audition, loop seams and exact final assembly still
need their own checks. The five-cent maximum window reservation retained all
previous reservations inside the existing $1 authorization; it is not an invoice.
The provider confirmed shutdown after artifact retrieval and the guard is inactive.
Three CPU comparison tests and Ruff pass; the GPU result supplies the actual
decoder-equivalence evidence those CPU tests cannot provide.

### Integrated Single-Pass Decoder Validated

Runtime `d912fdd72b6aad0d382ca3a4ac0a9b40856cae92` was built from an isolated,
tracked-input-only worktree on the RTX 3090 host. Independently inspected image:
`sha256:a84565ccc0b6efda2f81d8963d27338555d08db91c01cf07ca637989326d7be6`.
Image project, lane and revision labels match. Model/source pins, precision,
sampling, tiling and persistent volumes are unchanged.

The revised probe first called the runtime's `decode_with_source` with a lazy
VAE, then compared against the official decoder and retained reference. It passed:
every clamped sample matches, and every raw float also matches the earlier
pre-clamp diagnostic. The adapter took 6.911241 seconds including decoder loading;
the complete comparison took 20.414217 seconds. Decoder file SHA-256:
`eb8d6320517e15940f2f5603d99d7953c4ba91109d0a5c527c3c242c44fc8e16`.
Evidence: `/var/lib/youtube-studio-render/operator/yue2-integrated-decoder-evidence-20260921/`.

The normal supervisor then completed a fresh job,
`studio-lofi-yue2-3090-integrated-20260921-01`, with the same score, style and seed.
Its semantic and latent arrays match the preceding evaluation exactly. The
copied ledger, all artifacts and supervision receipts passed independent runtime
inspection. Its raw samples match the independently verified decoder output;
clamping them reproduces the official samples exactly.

- Native output remains 1,749,056 frames / 36.438667 seconds, 48 kHz stereo FLOAT.
- One VAE pass retains both unclipped and official audio. No gain is applied.
- `headroom-status.json` binds the decoder and raw WAV hashes, records the 474
  over-range samples and peak 1.1233507395, and explicitly denies production approval.
- Generation-stage time: 28.199562 seconds; VAE stage: 4.089125 seconds.
- Supervisor: 38.879906 seconds; configured-rate allocation estimate USD 0.001944,
  excluding rental idle/build/transfer and not a provider invoice.
- Generated raw WAV SHA-256:
  `61125a71f620913d550615530a875dfc330aeb72f41005e0671df68483ac8b67`.
  WAV file hashes may differ between exports despite identical sample arrays;
  both file integrity and actual sample equality were checked separately.

Generation evidence:
`/var/lib/youtube-studio-render/operator/yue2-integrated-generation-evidence-20260921/`.
The Studio build pin now selects this validated runtime. This is not a production
service deployment: the HTTP client still retrieves the official clamped audio.
The next integration must transport the verified raw source and mastering lineage
to the shared music path. Musical quality, channel personality, seam suitability
and exact final video duration remain unqualified. No thumbnail work was done.
The provider confirmed shutdown after retrieval; the external guard is inactive.
The five-cent window reservation preserves all earlier reservations within the
existing $1 authorization.

### Authenticated Source Delivery and Studio Retention

Runtime `7a3eeaec826be487f05b68b54e0f618b98467111` extends the fixed authenticated
artifact routes with `audio-unclipped.wav` and `headroom-status.json`. They are
advertised only when the completed terminal ledger contains them. Every download
verifies the terminal-bound size and SHA-256 before serving bytes. The decoder
source hash remains `eb8d6320517e15940f2f5603d99d7953c4ba91109d0a5c527c3c242c44fc8e16`;
no inference settings or model code changed in this transport revision.

Actual retained GPU artifacts were copied to a temporary ledger and served through
the real loopback HTTP server. Both downloads matched their recorded hashes and
MIME types; unauthenticated requests returned 401. No dispatcher or new inference
was started, and the original evidence remained unchanged.

The Studio client verifies both raw-source metadata entries from the completed
receipt chain, downloads only fixed routes with bounded reads, verifies the exact
envelope bytes before parsing, and binds the headroom receipt to the raw WAV hash.
It refuses incomplete metadata, corrupted bytes, wrong source hashes, gain claims
and production-approval claims. Python JSON float spelling is preserved by checking
original envelope bytes, not JavaScript reserialization.

The local evaluation command now immutably retains both files and checks native
FLOAT WAV format, frame count and rate. A candidate marks source retention only
after successful verification; offline reuse verifies both files again. Older
candidates without a retained source remain readable and unqualified.

Validation: all 124 runtime tests pass in the pinned dependency container; 68
Studio client/CLI checks pass; real Python-to-TypeScript HTTP integration passes
for one legacy request and five shared arrangement fixtures, with exactly six
explicitly fake CPU inferences. Typecheck, ESLint and Ruff pass. These transport
tests are not musical quality evidence. No additional GPU rental was used.

The build pin selects the new transport revision. The OpenRelay image has not yet
been rebuilt/deployed with this revision. The durable application path still needs
raw-source retention and measured mastering; neither raw audio nor the original
clamped waveform is automatically approved for production delivery.

### Durable Application Source Retention

`executeDurableYuE2Evaluation` now retains terminal-verified pre-clamp WAVs and
headroom receipts at separate content-addressed keys. Candidate references bind
both hashes and byte lengths. A candidate is published only after immutable
writes, readback, receipt verification and actual FLOAT WAV inspection succeed.
Previously sealed candidates preserve their original retention contract.

Interrupted source writes recover through fixed artifact GETs, without a new
submission. Completed-candidate reuse and read-only review reverify retained
source evidence. Missing or corrupted sources on a sealed candidate fail closed;
they are not silently replaced or repurchased. The official native listening
audio, signal-review gates and production-denial flags remain unchanged.

Validation: 22 durable behavioral cases, 40 supervised/review cases, and real
Python HTTP plus S3-wire integration for legacy completion, supervised completion
and supervised failure pass. Each wire scenario made exactly one POST and one
explicitly fake CPU inference. Successful scenarios checked both retained WAVs
and the headroom receipt, then confirmed corruption refusal without worker calls.
Typecheck and scoped ESLint pass. No live R2 writes, GPU rental or production
deployment occurred. The canonical production bucket's public-access configuration
still needs resolution before treating these artifacts as privately stored.

Measured mastering and its delivery lineage remain the next audio integration
step. Retaining an unclipped source is not itself safe playback, channel-quality
approval, seamless-loop qualification or exact final-video assembly.

### Measured Headroom Preparation

`src/lib/yue2Headroom.ts` now prepares a separate audition derivative from the
terminal-verified pre-clamp source. It measures the complete source using the
existing oversampled true-peak meter, applies only negative linear gain when
needed, and remeasures the complete saved FLOAT WAV. The ceiling is -1 dBTP with
a 0.2 dB margin for the meter's 0.1 dB display resolution. Quiet sources are not
amplified or re-encoded. There is no compression, EQ, trimming, looping, resampling
or loudness normalization. Missing reliable metering or non-finite samples refuse
preparation. Silence remains unchanged and retains its review warnings.

The local evaluation command retains `audio-headroom.wav` and
`headroom-preparation.json` alongside the untouched official and raw files.
Candidate hashes bind both derivative files. The preparation receipt binds the
job, raw audio and source receipt, gain, native frame count, before/after meter
results, and an explicit false production-approval flag. Offline candidate reuse
checks these identities, probes actual format/frame count, and remeasures output
without rendering or contacting the worker. Existing candidates remain readable.

Seventy client/CLI checks pass, including actual FFmpeg processing of synthetic
over-range stereo, unchanged frames/source bytes, deterministic repeat output,
no amplification, silence warnings, and corrupted-derivative refusal. Real Python
HTTP-to-TypeScript CLI integration passes for the legacy fixture and five shared
arrangement fixtures, each retaining preparation evidence. Typecheck and scoped
ESLint pass. These new DSP tests use synthetic audio, not a new GPU composition or
musical audition. No GPU rental, live storage writes or production deployment
occurred. The durable application and its listening/review surface still need to
adopt this derivative explicitly; their listening audio is not silently replaced.

### Durable Prepared Listening Path

New durable candidates with verified raw sources now retain a content-addressed
headroom WAV and an immutable `headroom-preparation.json`. Candidate references
bind both files. Interrupted preparation publication recovers from the retained
source without worker traffic or another purchase. Existing sealed candidates
keep their original listening contract. Missing/corrupted prepared artifacts on a
sealed candidate fail closed instead of silently falling back to clipped audio.

Read-only review verifies source, preparation lineage, output bytes, format and
measurements before returning a listening key. The owner-authenticated review route
signs that exact verified key. Signal findings and playback now refer to the same
prepared file; original native and pre-clamp evidence remain unchanged. The review
projection includes gain and source/output fingerprints, and the player displays
the applied gain with a distinct accessible label. No layout overhaul was made.

An eight-entry measurement cache shares in-flight analysis and reuses successful
results only after hashing the current source/output reads. Returned measurements
are cloned; failed measurements are evicted. Cached measurements never bypass
current receipt checks. Zero-gain preparation must preserve source bytes exactly,
and active audio may not be converted to digital silence.

Validation includes 24 durable cases, 41 supervised/review cases, 70 client/CLI
checks, owner-route tests and all three Python HTTP/S3-wire scenarios. An actual
FFmpeg test with a synthetic overloaded stereo source proves the review selects
the derivative, reports zero full-scale samples and a true peak below -1 dBTP,
while still requiring audition, channel fit and exact final assembly. Corruption
refuses review without another POST. Wire successes retain three separate WAVs;
failure accounting still creates no candidate.

Playwright playback/seeking and responsive-state checks pass. Prepared-audio
desktop/mobile screenshots were inspected at
`/tmp/yue-review-browser-g9QedS/headroom-1366.png` and
`/tmp/yue-review-browser-g9QedS/headroom-390.png`. Synthetic API/audio only.
Typecheck and scoped ESLint pass. No new GPU work, live storage writes, publishing
or production deployment occurred. Private storage configuration and runtime/app
deployment remain necessary before production use.

## Private Evaluation Storage

Created `youtube-studio-ai-private` in the existing Cloudflare account (EEUR,
2026-09-21). Live control-plane checks prove its r2.dev access is disabled and
its custom domain list is empty. The legacy `youtube-studio-ai` bucket remains
public and unchanged. No user assets were moved or deleted.

Durable evaluation reads, create-only writes and owner review signatures now
explicitly select the private bucket through `getStudioPrivateBucket`.
`R2_PRIVATE_BUCKET` can select an isolated deployment bucket; invalid names,
the known legacy bucket and a bucket equal to `R2_BUCKET` are rejected. There is
no public-bucket fallback. An override must pass the operator probe before use.
Existing evaluation data in any other bucket needs a deliberate migration;
this change does not silently copy receipts or reset admission markers.

`scripts/verify-studio-private-storage.ts` checks live domain settings before
writing a unique, non-user probe. The successful run verified exact-byte SDK
readback, atomic duplicate-write refusal, signed download, anonymous S3 denial
(400 InvalidArgument/Authorization), and anonymous r2.dev denial (401). Its
single probe was deleted with object-level acknowledgement. URLs and credentials
are not printed. The Cloudflare vault S3 credentials passed. The YouTube vault
S3 credentials were refused on the new bucket; do not assume that namespace is
ready for deployment or delete its keys without checking other live callers.

Validation: private bucket selector tests, 24 durable behavior cases, 41
supervised/review cases, the owner-authenticated review route, all three actual
Python HTTP/S3-wire integration scenarios, typecheck and scoped ESLint passed.
The wire fixture rejects every request to its public default bucket. Existing
storage credential refresh remains unchanged. Runtime/app deployment and exact
deployed credential verification are still pending; this is not production
activation, musical qualification or permission to publish. No GPU work or
thumbnail generation was performed.

## Retained Worker HTTP Image Verification

The 3090 VM now retains runtime `7a3eeaec826be487f05b68b54e0f618b98467111`,
including authenticated unclipped-source and headroom-receipt delivery. Image:
`sha256:b05c41d3edf330896e19ae45e13521070d3e5df7b03863b9c3e2bae94c7f03c1`.
Docker inspection confirmed the exact revision and Studio project/lane labels.
The curated context was prepared from Studio `4e3d6175` and transferred to
`/var/lib/youtube-studio-render/builds/yue2-source-7a3eeae` on the retained VM.

The repeatable `infra/studio-render/yue2_http_delivery_probe.py` passed both
locally and inside that actual image on the provider host. It copies only an
already completed job into temporary state and never starts a dispatcher. The
source ledger is mounted read-only. Authenticated HTTP downloads of native WAV,
unclipped WAV and headroom receipt match the original terminal hashes and byte
counts; MIME, length and digest headers match; anonymous requests return 401.
The original and copied inference ledgers remain unchanged. This is verification
of real retained audio delivery, not another inference or musical audition.

Container `studio-yue2-http-delivery-20260921` exited 0 at 19:08:32 UTC, with
`--network none`, read-only root, UID 1000, dropped capabilities and no GPU device
needed for the transport probe. Evidence is retained on the controller at
`/var/lib/youtube-studio-render/operator/yue2-http-delivery-20260921.json`.
The existing budget controller reserved a further 5 cents for a maximum
15-minute window, preserving prior reservations and the approved $1 total.
The external shutdown guard was active before restart. Provider state confirmed
the same VM stopped after retrieval. No additional inference or thumbnail job
was submitted.

Important remaining boundary: this verifies loopback HTTP inside the isolated
image, not a reachable Vercel/Trigger worker URL. A persistent authenticated
transport must preserve the inference container's network isolation. Do not
switch to host networking merely to expose the loopback listener, and do not
enable legacy pipeline replacements or claim production activation from this
test. The shared production music block still requires the qualified YuE2
continuation and channel-bound output approval.

## Network-Isolated Host Transport

Studio's builder now pins runtime `f9f57fc047be085c7d7f1fdb9f0e3e7491a84d37`.
Its `serve --unix-socket /ipc/worker.sock` mode carries the existing authenticated
HTTP contract over a mounted Unix socket, so a host gateway can reach the worker
without adding container networking. The directory must be worker-owned and
private (0700), the socket is 0600, symlinked parents and existing paths are
refused, and normal close removes only the server's own socket inode. Legacy
loopback TCP behavior remains unchanged. No inference settings, model pins or
qualification flags changed.

All 143 runtime tests passed in the pinned-dependency CPU container, including
the same real supervised execution, accounting, duplicate-header and restart
tests over Unix sockets. The wheel builds and Ruff passes. A real host-to-container
probe passed with Docker reporting `network=none` and read-only root: anonymous
health returned 401, authenticated health returned 200, zero jobs were submitted.
That probe used the explicit current-source overlay on the existing local image;
it does not prove the installed GPU image has been upgraded. The probe is
`deploy/probe_unix_transport.py` in the runtime repository.

The retained GPU image is still the earlier `7a3eeae` revision. Installing the
new image and configuring the authenticated gateway/tunnel remain pending.
No GPU restart or spending occurred for this transport implementation. Legacy
pipelines, publishing and thumbnail generation remain untouched.
