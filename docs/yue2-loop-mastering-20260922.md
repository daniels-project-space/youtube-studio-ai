# Reviewed Loop Mastering

Primary YuE2 loop assembly now resolves the same explicit-parameter > composer
directive > assembly-default loudness precedence as narrated assembly. Narration
ducking gain is not applied to primary music. Legacy/default assemblies are
unchanged.

The short folded source is measured, mastered with constant gain, and measured
again before video rendering. Native 48 kHz stereo float samples and frame count
are retained. The reviewed source and source receipt remain unchanged; mastering
is a separate assembly mix treatment, not a new source approval. Its temporary
file is removed with the private source directory. Current execution/approval
authority is checked again after mastering and before rendering.

Targets needing compression or limiting are refused before long encoding and
classified as nonretryable. The error reports the maximum target compatible with
-1.5 dBTP source headroom. Final AAC peak qualification remains necessary; source
headroom alone is not a release certificate. No automatic target reduction occurs.

## Evidence

- Three actual 60-second renders at -14, -20 and -23 LUFS: independently decoded
  loudness within 0.5 LU and peak at or below -1 dBTP; exact duration, 1,800 frames,
  48 kHz audio. Sample-by-sample comparison proves constant gain/no timing shift.
- Refusal tests cover insufficient headroom, silence, invalid target/frame count,
  and attempts to overwrite the approved source.
- Actual assembly-boundary tests cover composer handoff, explicit override,
  no upload/render after mastering failure, and legacy/narrated isolation.
- Three focused files: six test cases passed, no skips. Typecheck and scoped
  ESLint passed. Tests were network-isolated and passed the thumbnail exclusion
  selector; no GPU generation or paid provider calls were made.

Retained YuE2 diagnostic artifacts:
`/var/lib/youtube-studio-render/operator/composed-score-mastering-20260922/`

The real folded recording mastered in 4.259 seconds. A diagnostic-only -18 LUFS
override delivered -18.1 LUFS / -2.9 dBTP across an exact 300-second, 9,000-frame
render with native 48 kHz audio. The source SHA-256 remained
`ad5bd1a343b3f50fbc11b526ab7d0001639294b7fbf273012c23ec3a9c70fedb`.
The final diagnostic SHA-256 is
`eb8ee9378e1d837351e9a0eed5ae8818e929785b00603333fffcc27b589ca6d6`.

The existing -14 LUFS target was correctly refused: measured safe ceiling was
-16.6 LUFS. No channel configuration was changed. Owner agreement to a lower
target is pending, as is the separate musical audition approval. The diagnostic
uses a synthetic picture, not channel visual-quality evidence. These results do
not establish production deployment, final release qualification or publishing
approval.
