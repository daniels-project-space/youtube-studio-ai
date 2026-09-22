# Required Reviewed-Source Mix Normalization

The narrated finalizer previously caught normalization errors, logged a warning,
and uploaded the unnormalized master. That also applied to reviewed YuE2 repeat
and play-once routes, despite their composer-specific loudness targets.

Those explicit YuE2 timeline versions now require normalization. Failure stops
before upload with non-retryable `FINAL_AUDIO_NORMALIZATION_FAILED`, retaining
the original cause. Private source cleanup still runs. This prevents silent
quality degradation and automatic whole-stage rerenders on that failure; it is
not a durable normalization-resume facility.

Legacy timeline normalization remains best-effort for before/after comparison.
Loop-only assembly is unchanged. Composer target precedence, source approval,
48 kHz source handling and exact composition timing are unchanged. No channel
was migrated and no new production qualification is claimed.

## Verification

- A failing regression demonstrated the old route returned success when the
  normalizer threw. Both reviewed timeline playback modes now reject, upload
  nothing, classify the failure as non-retryable and remove the private source.
- The same fixture proves the legacy timeline still returns its master after
  a normalization failure.
- Eight real FFmpeg fixtures cover -16 and -20 LUFS targets at 44.1 and 48 kHz,
  with 3.5- and 10-second clocks. Independent EBU R128 measurement of decoded
  output requires integrated loudness within 0.5 LUFS of target and true peak
  at or below -1 dBFS. Video packet hashes, frame counts, audio sample rates and
  exact container/audio durations must also match.
- Existing composer-directive precedence and reviewed-source assembly tests
  remain included. These are technical fixtures, not channel listening approval.

All ten cases across the three selected files passed with external networking
disabled, including the assembly fixture's real 1080p FFmpeg mode. Production
build, final TypeScript check, scoped lint and structural audits passed without
changing audit baselines.

No thumbnail test, live provider generation, GPU start, deployment or publishing
operation is part of this change.
