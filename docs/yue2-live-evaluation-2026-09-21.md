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
