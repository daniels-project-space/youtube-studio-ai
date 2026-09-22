# Narrated repair storage

## Shared defect

The ordinary timeline finishing path uploaded its final master through the
streaming helper, but still read the entire pre-overlay video into a Buffer for
a second PUT. Its surgical-repair path likewise buffered the entire checkpoint
on download. Those paths could exhaust worker memory; the buffered PUT also
remained subject to the single-request object-size ceiling.

The opt-in YuE2 renderer explicitly rejects reuse of previously mixed repair
videos, yet inherited this extra full-video upload. A failing regression through
the actual YuE2 manifest reproduced the buffered `pre_overlay.mp4` write.

## Changes

- Default/legacy narrated assembly retains its repair checkpoint, now using
  `putObjectFromFile` and therefore the bounded multipart implementation.
- Surgical repair restores that checkpoint through atomic `getObjectToFile`.
- The explicit YuE2 renderer disables checkpoint retention through an internal
  constructor option. No exposed channel parameter or persisted channel record
  changes; no repair key/path is advertised for this unsupported path.
- Failed optional checkpoint writes still leave both pointers empty and preserve
  the completed final master. Failed legacy repair reads retain the existing
  full-recomposition fallback. Successful repair avoids body recomposition.
- Existing owner/worker authority checks, final QA, source evidence, render
  settings, mix gains and legacy default behavior remain in place.

This removes one entire composed-video upload and its retained object per new
YuE2 narrated assembly. It does not establish a fleet-wide cost percentage.
No old object was deleted, and the separate EDL path was not changed.

## Verification

The actual-block regression fails on the previous buffered-write behavior and
passes after repair. It checks YuE2's sole final-master write, blank repair
pointers, legacy streaming writes, failed checkpoint cleanup, successful repair
reuse and unavailable-checkpoint fallback. Existing approval revocation,
source corruption, output timing and undeclared-input checks also pass.

Five additional focused files pass: composer-aware assembly, EDL cutover,
render-timeline repair, SDK multipart storage and atomic downloads. The selected
six files were inspected for thumbnail assertions before execution; no thumbnail
test or generation ran. TypeScript, focused ESLint and the production build pass.

The real FFmpeg mode produces 1920x1080, 300 frames, exactly 10 seconds, stereo
48 kHz audio. Its complete file SHA-256 is unchanged from the retained
`reviewed-source-1080p.json` proof:
`b4728c643a6a2b3a787e77dbd39959ca94c49ea16d6cad7c773397863747c06d`.
Decoded 233 Hz music and 523 Hz narration amplitudes are unchanged; the unrelated
317 Hz source still fails the independent signal oracle. Three decoded samples
at 0, 5 and 9.9667 seconds were inspected: expected changing diagnostic pattern
and the existing near-black final fade, with exact-byte parity to the baseline.

Media, raw inspection, full native-test evidence and sampled-frame sheet:
`/var/lib/youtube-studio-render/operator/reviewed-source-assembly-repair-copy-20260922/`.
Compact comparison receipt:
`test-fixtures/music-composer/assembly/reviewed-source-storage-parity-20260922.json`.

Audio and owner approval are explicitly synthetic fixtures; database and R2
transports are mocked in this composition test. The actual storage helpers were
separately qualified on the retained 13 GB master in the preceding storage
receipts. This batch does not claim a new real-channel musical audition, provider
generation, production deployment, or completion of the whole task budget audit.
