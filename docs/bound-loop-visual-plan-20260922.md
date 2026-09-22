# Bound loop visual plan

Explicit pair: `scene_planner@3.0.0-bound-visual-plan` and
`keyframes@2.0.0-bound-visual-plan`. Default modules, the prior opt-in planner,
and existing channel records are unchanged. Neither new version is certified
for production creative quality.

## Closed boundary

Previously, the planner could select a signature scene while the independent
keyframe critic still reviewed the base DNA setting. A sealed music-program
setting was also passed as a hint which the DNA branch ignored. A successful
review could therefore be judging the wrong world, or reject a correct scene.

The new planner emits a typed `loopVisualPlan` with owner/channel/run identity,
topic, planning-input fingerprint, the exact scene, effective visual identity,
setting authority, optional sealed program fingerprint, and its relevant frozen
parameters. It retains the recurring subject and visual constraints without
overwriting upstream Style DNA. Setting authority is explicit:

- A validated sealed music program owns its setting and motion intent.
- Otherwise the deterministic DNA scene supplies the setting and motion.
- Exact-topic authored library prompts remain verbatim, judged against their
  channel identity. A library and sealed program claiming the same scene are
  rejected before paid work rather than silently choosing one writer.

The new keyframe module requires the current runner's planner artifact lineage,
producer version, run-scoped artifact id, and payload hash. It reconstructs the
plan from current frozen channel/program inputs and the retained planner
parameters, then compares the plan and exact scene before image generation.
Keyframe parameters are not mistaken for the preceding planner's parameters.
The fingerprint is an integrity check, not an independent authorization token.
Normal runner/worker authentication and immutable artifact provenance remain
the authority boundary.

The art critic receives the effective selected subject/setting. The motion
reviewer receives its allowed-motion vocabulary and camera discipline. Invalid
motion JSON in this new production version stops the stage with explicit
non-retryable metadata, without falling back to a template or restarting image
generation. Existing paid image limits, models, quality threshold, and usage
accounting remain in force.

The planner declares the bound handoff as a required downstream input; the
keyframe module requires its capability. Pipeline validation rejects mixing
this pair with a legacy counterpart. The existing remote worker path also
loads producer artifact references into StageContext; no new secret or remote
transport is introduced by these versions.

## Evidence

`boundLoopVisuals.test.ts` runs the actual registered pair through the real
pipeline validator and runner. Provider/storage boundaries are synthetic. It
checks that the rendered prompt and art review use the same selected setting,
the motion review receives its constraints, and the planner's 15-second scene
survives a keyframe stage with different parameters.

Changed topics, subjects, scenes, run identity, producer version, malformed
payloads, and a changed identity with a recomputed fingerprint/hash all fail
before the image boundary. Tests also cover sealed-program precedence, changed
program refusal, conflicting library/program ownership, malformed motion
review, unchanged upstream identity, legacy/default selection, and preservation
of the preceding deterministic planner and keyframe rejection regressions.

The first structural audit found the legacy DNA read hidden in a default
callback parameter. The implementation was adjusted to retain that read in
the legacy block's body. The audit was not suppressed or its baseline raised.
The earlier readiness sweep was deliberately stopped before that final source
adjustment, not because of a timeout; only the subsequent sweep counts as final.

## Limits

No new channel imagery, animation, GPU inference, owner listening approval,
production deployment, publishing, or thumbnail work was performed. This does
not calibrate the art/motion reviewers, prove that generated pixels obey their
prompts, qualify downstream animation styling, or complete the shared YuE2 MVP.
Real channel-correct footage, approved music continuation, live release, and
the wider module/backlog requirements remain open.

## Final verification

After the final source adjustment, all 888 selected readiness files passed in
an externally network-isolated run; 30 thumbnail-named files were excluded.
Production build and TypeScript, scoped ESLint, and diff whitespace checks
passed. Structural audits reported no regression with their original baseline
unchanged. Graphify was updated after the final source edit.

Logs: `/tmp/studio-bound-visual-{readiness,build,audit,graph}-final-20260922.log`.
This is still a partial release gate, not complete production readiness.
