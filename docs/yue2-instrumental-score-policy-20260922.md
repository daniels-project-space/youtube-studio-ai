# Instrumental score admission: 2026-09-22

## Contract

New scored composer output deterministically includes
`symbolicScorePolicy: "instrumental"`. The model does not choose this technical
restriction. The accepted arrangement seals it with the exact score and channel
review context. The shared music module sends `score_policy: "instrumental"`
on that request; removing the policy is rejected even if the job ID is rehashed.

Runtime commit `fcc5657` validates this optional v2 policy with the unmodified
pinned native ABC parser. It requires explicit score text, empty lyrics and a
rest-only Vocal staff. Chord annotations over rests are allowed. Invalid
notation is rejected before queue admission, GPU preflight or supervised
execution. This does not guarantee absence of vocal leakage in generated audio.

Existing accepted artifacts without the policy keep their original request
bytes and job IDs. Generic song jobs remain valid. No legacy channel/pipeline,
sampling setting, duration policy, model pin or source audio was changed.

The isolated composer evaluator exercises a ten-second CPU policy probe before
paid composition, so an older local runtime fails before purchasing text.
Rejected generated scores retain their original request and failure/usage
receipt, with no successful result and no automatic retry.

## Verification

- Runtime suite: 139 passed, six skipped decoder cases requiring the pinned
  Torch/YuE2 container. Log: `/tmp/yue2-instrumental-runtime-tests.log`.
- Real loopback HTTP: a policy-bearing vocal score returns 400 with no queue
  job; a valid instrumental score is admitted and duplicate submission reuses
  it. A direct runner test proves zero GPU preflights and zero generation calls
  for the invalid score.
- App tests: real composer/planner/runner handoff with mocked text, actual CPU
  parser, shared music dispatch, accepted-artifact validation, frozen channel
  identity, and 72 client/CLI checks passed without external network access.
  The retained legacy music request remains byte-identical.
- TypeScript, scoped ESLint and the production app build passed. Both code
  graphs were refreshed. Build log: `/tmp/studio-instrumental-policy-build.log`.
- Offline wheel build succeeded using cached, declared build dependencies.
  Seven parser/HTTP checks also passed against its installed package.
- Wheel: `/tmp/yue2-instrumental-policy-wheel/youtube_studio_music_runtime-0.1.0-py3-none-any.whl`.
- Wheel SHA-256: `6e17020a9e9bf944c9ce4cd833c40ea4edbf72d6bf54b4178cf2258061554137`.

## Rollout Boundary

The live GPU image and supervised execution-policy image binding were not
changed. Build and qualify the matching container before activating new
policy-bearing requests; older runtimes reject the unknown field. No GPU job,
thumbnail work, paid provider call, owner audition approval, automatic
generation or publishing was performed. This checkpoint is not full music
quality qualification or completion of the module-first MVP.
