# Keyframe quality admission

This is a shared loop-pipeline quality repair, not a production deployment or
completion of the module-first MVP.

## Reproduced failure

The actual `keyframes` block returned a usable `f1Key` after both independent
art-direction reviews rejected the generated images. `produceAndCritique`
intentionally returns the best candidate on exhaustion; its caller must enforce
`accepted`. This caller only logged that flag before recording the keyframe and
buying motion-direction review. The regression failed against the original
block with `Missing expected rejection`.

The same caller converted string scores and clamped out-of-range scores, and
silently discarded malformed issues before shared verdict validation. This
could turn an invalid provider response into approval.

## Repair

- Production requires an accepted candidate before asset indexing, motion
  review, or returning a keyframe to paid animation.
- Raw review scores and issues pass through the existing strict shared
  validator without coercion, clamping, omitted-issue defaults, or filtering.
- Failed or malformed art review is explicitly non-retryable at the block
  boundary. A transport error from the reviewer cannot restart paid image
  generation through the engine's transient-error classifier.
- The existing 0.8 threshold, two-image cap, provider/model selection, identity
  grounding, paid envelope, and explicit draft best-effort path are preserved.
- Successful image receipts already enter the runner's image-usage scope.
  Rejecting the candidate does not erase that known expenditure.

No channel records, legacy pipelines, thumbnails, publishing state, or provider
deployment were changed. This corrects enforcement of an existing production
gate rather than introducing a replacement creative strategy.

## Evidence and limitations

`lofiKeyframeAdmission.test.ts` executes the real block and critique loop with
synthetic provider/storage boundaries. It covers exhausted rejection, malformed
and missing scores/issues, reviewer transport failure, first/second-attempt
acceptance, retained known image cost, correction feedback, and explicit draft
behavior. It asserts that rejection never reaches asset admission or motion
review. It does not calibrate the vision model or prove artistic quality.

The separately retained legacy Seaside master was downloaded read-only from its
existing R2 run and visually inspected as a contact sheet. It shows a rainy
city-apartment desk rather than the named lighthouse/seaside setting. The
180-second master is 3828x2160 at 30 fps with 48 kHz stereo audio; its SHA-256 is
`1c097f1ff6260c38b9a4b2385414319810957d2aab56a035f6197522afd81122`.
Historical frozen inputs are missing, so this is not evidence that the repaired
code caused that mismatch. The asset remains a legacy comparison, not an
approved source for the new music pipeline.

Local evidence: `/var/lib/youtube-studio-render/operator/seaside-real-visual-20260922/`
contains the original master, provenance, and contact sheet. No thumbnail was
downloaded or inspected, and no new paid generation was performed.

Music listening approval, channel-correct new visual qualification, the live
YuE2 continuation, production release, and the broader module backlog remain
open. A green admission test does not satisfy those requirements.

## Verification

After the final source edit, all 886 selected readiness files passed in a
network-isolated run; 30 thumbnail-named files remained excluded. Production
build and TypeScript, scoped ESLint, and `git diff --check` passed. Structural
audits reported no regression (undeclared store reads: zero); their committed
baseline was not changed. Graphify was updated after the source edit.

Logs: `/tmp/studio-keyframe-admission-{readiness,build,audit,graph}-20260922.log`.
These checks are not a complete production-release gate or a live model test.
