# Native Music QA Efficiency

The existing shared native-music analyzer decoded each retained WAV three times
for loudness, sample statistics, and silence detection. It now decodes once and
feeds independent FFmpeg filter branches. The same opening and four interior
spectral probes remain. Normal execution uses six subprocesses instead of eight;
this is a verified process/decode reduction, not measured provider-bill savings.

No cached result substitutes for a fresh approval check. The review API still
verifies retained byte identity and repeats native analysis at approval time.
Thresholds, source precision, spectral coverage, and human listening gates are
unchanged. This optimizes the existing native Music3 quality path; it does not
qualify YuE2 generation or migrate any legacy channel.

## Measurement Parity

Four real WAV fixtures compared every full-file measurement against independent
executions of the previous three FFmpeg filter commands:

- Stable low/high-band audio.
- Immediate post-opening spectral collapse.
- Delayed spectral collapse later in the first phrase.
- Floating-point stereo with unequal channels, silence, DC offset, and clipping.

Integrated loudness, true peak, loudness range, crest, peak/ceiling counts,
DC offset, and silence fraction were exactly equal at the existing output
precision. Both spectral-collapse fixtures still failed their quality checks.
These are deterministic technical fixtures, not aesthetic listening approval.

## Resource Bounds

Every analysis subprocess now has a 90-second deadline and a 1 MiB diagnostic
limit. Deadline or output-limit failures kill the child and wait for its close
event. All spectral probes settle before their shared temporary input is
removed, including when one fails. Input-file write failures also enter cleanup.
The full-file phase and subsequent concurrent probe phase have separate limits;
this is not a claim of a single 90-second end-to-end deadline.

Lifecycle fixtures cover successful process counts, timeout, log overflow,
spawn failure, and sibling probes after a failure, checking that no child
remains active and the temporary directory is removed afterward.

Five focused files passed with external networking disabled, followed by a
repeat of the lifecycle test after its TypeScript-only fixture correction.
Production build/TypeScript, scoped lint, and structural audits passed. No
thumbnail-related fixture, live provider generation, GPU start, deployment,
or publishing operation was performed. The full release gate was not run.
