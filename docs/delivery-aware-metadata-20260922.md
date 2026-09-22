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
- Newly designed pipelines select this explicit version after structural policy
  completion and before final duration enforcement. Read-only preview and
  executable design produce the same pipeline; runtime validation still checks
  the actual registered manifest before persistence/execution. Stored legacy
  pipelines are not rewritten, and the default registry implementation is intact.
- Weekly preparation admits this exact downstream metadata version only with a
  valid delivery target. It does not execute or substitute for metadata. All
  other explicit versions remain rejected. The frozen preparation digest binds
  the metadata version and duration, so changing either invalidates old receipts.
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
missing credentials, legacy fallback, and matching preview/runtime selection.

These are contract/integration checks, not live creative-quality qualification,
owner listening approval, production deployment, or measured cost savings.

The initial full non-thumbnail readiness run passed 892 of 894 selected files
(30 thumbnail-named files excluded). Two integration failures exposed automatic
selection changing preview fingerprints and entering an unqualified weekly
preparation path. Automatic selection was removed, not those safeguards.
The final six-file focused run passed both regressions and metadata integration,
finishing, source handoff, and duration tests. Build/typecheck and scoped ESLint
also passed after the correction. This is not a claim of a fresh 894/894 full run.

## Creator integration follow-up

The initial hold above prompted integration work, not removal of the preview or
weekly safeguards. Version selection now occurs at the shared post-policy
designer boundary. Existing preview API tests check exact fingerprints across
all ten routed families and toggle variants. The metadata integration test also
compares full preview/runtime pipelines for four families. All four real weekly
producer entry points are exercised up to their retained-storage boundary with
the selected metadata version; no provider or storage write is allowed there.
Negative tests retain unsupported-version rejection, and digest tests bind both
the new version and its duration. Runtime metadata execution remains covered by
the registered-module/runner test with synthetic provider responses.

Follow-up validation: build/typecheck, scoped ESLint, and all audits passed;
Graphify was updated. The full non-thumbnail sweep passed 893/894 selected files
with 30 thumbnail-named files excluded. Its sole failure was the multipart-upload
fixture's timer-dependent ordering (three parts dispatched before the simulated
failure instead of its expected two). Replacing the fixture delays with an
explicit two-part synchronization boundary preserved the fail-fast assertion.
The storage, rendered-file persistence, and loop-output recovery tests then
passed together, and multipart passed ten consecutive isolated runs. No storage
runtime change was needed. This is not a fresh full-suite pass after that
test-only correction, nor a production deployment or creative-quality approval.
