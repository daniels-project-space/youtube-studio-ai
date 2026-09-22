# Reviewed loop motion handoff

## Root cause

The loop renderer selected `musicProgramMotionIntent` ahead of `motionPrompt`.
On routed programs this discarded the keyframe module's image-grounded direction.
Its generic motion examples could also introduce elements not reviewed in the still.

## Explicit replacement chain

- `scene_planner@3.0.0-bound-visual-plan` remains the visual identity owner.
- `keyframes@3.1.0-yue2-reviewed-motion` uses the existing production art and
  motion reviewers and retains a typed `loopKeyframeDirection` containing the
  accepted still key, exact motion sentence, scene-plan fingerprint and run scope.
- `loop_clips@2.1.0-yue2-reviewed-motion` requires that paired handoff and its
  current producer reference, revalidates the frozen visual plan, and forwards
  the reviewed sentence to H3 without substituting broad program/template motion.
- The explicit YuE2 selector chooses both revisions together. The compiler rejects
  mixed old/new handoffs in either direction. Previously pinned revisions and
  default legacy pipelines remain unchanged.
- Draft keyframe review cannot produce this production-reviewed handoff.
  Existing source approval and per-take revocation checks remain in place.

The program still constrains the scene plan and keyframe motion reviewer. It does
not reclaim the downstream specialist's task of identifying animatable pixels.
No new provider request, model downgrade, or automatic approval was introduced.

## Evidence

`reviewedLoopMotion.test.ts` runs the actual planner/keyframe/clip chain through
the runner and durable artifact sink. Approval, image/vision and video transports
are synthetic. It verifies the exact reviewed sentence reaches the H3 request,
the old explicit revision retains its previous precedence, and corrupted,
mixed-still, wrong-plan, missing-provenance and draft cases stop before spend.

The focused four-file run, production build/typecheck, lint and structural audits
passed. Audit baselines were not changed. All 890 selected readiness tests passed;
30 thumbnail tests were excluded, so this is not complete production-release
qualification. The broad run is recorded in
`/tmp/studio-reviewed-motion-readiness-20260922.log`. The code graph was refreshed.

## Limits

This is not a live GPU render, independently calibrated artistic judgment, or
production qualification. It does not prove that the video model follows every
instruction. That still requires real rendered-footage inspection.

The canonical production health endpoint remains on revision
`722facc4f5aaad004dcd9f96de3be7a29951a520`. No deployment, paid generation or
thumbnail tests were performed. The full module-first MVP and backlog remain active.
