# Delivery-aware metadata

## Ownership

`metadata@2.0.0-delivery-aware` receives final-video timing separately from
narration, topic grounding, and music-source duration. The runtime designer pins
`targetDurationSec` to its episode-length contract, including after advanced
parameter overrides. A measured `videoDurationSec`, when available, takes
precedence. Invalid measured timing fails rather than silently using a plan.

This supports natural-length loop sources without advertising their length as
the requested final video's runtime. Assembly still owns exact output duration.
Planned metadata is not evidence that assembly fulfilled that contract.

The creative consumers receive the same planned/measured timing context. The
sealed title decision retains it. Matching music-runtime phrases are excluded
only from narrative-number grounding; their numbers cannot authorize unrelated
claims. Wrong runtime labels are rejected before judging and packaging.

## Compatibility and limits

- Existing unversioned metadata execution and explicit legacy pins remain intact.
- New-version execution requires an explicit version and delivery configuration.
  Automatic creator selection is held until preview fingerprint parity and
  weekly preparation admission are qualified. Existing creator output is intact.
- The new version requires the configured creative reviewer; it refuses the
  legacy unreviewed fallback when credentials are unavailable.
- Deterministic duration checks apply to the `music_loop` title profile, not
  narrative events such as a two-hour siege in a five-minute documentary.
- Common English numeric/written hours, minutes, seconds, compact `h`, `min`,
  `sec`, and `s`, plus compound durations, are covered. Other language/notation
  forms remain subject to semantic review, not a claimed exhaustive parser.
- Source/media generation, thumbnails, legacy channel records, and assembly
  duration enforcement were not changed.

## Verification scope

New tests exercise the registered module through the real pipeline runner with
synthetic provider/evidence transports: short source versus long delivery,
measured precedence, decision tampering, contradictory labels, invalid inputs,
missing credentials, legacy fallback, and unchanged creator version selection.

These are contract/integration checks, not live creative-quality qualification,
owner listening approval, production deployment, or measured cost savings.

The initial full non-thumbnail readiness run passed 892 of 894 selected files
(30 thumbnail-named files excluded). Two integration failures exposed automatic
selection changing preview fingerprints and entering an unqualified weekly
preparation path. Automatic selection was removed, not those safeguards.
The final six-file focused run passed both regressions and metadata integration,
finishing, source handoff, and duration tests. Build/typecheck and scoped ESLint
also passed after the correction. This is not a claim of a fresh 894/894 full run.
