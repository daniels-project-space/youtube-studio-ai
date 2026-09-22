# Reviewed play-once music consumption

## Root gap

The shared composer and music-candidate contracts already accept `playback:
once`, but the reviewed assembly consumer required `repeat`, folded every source,
and used a compositor that always repeated music. A once-authored background
score therefore had no compatible reviewed consumer.

## Implementation

`timeline_assemble@3.1.0-yue2-reviewed-once` is a separately registered opt-in
version. It consumes the same approved private candidate and accepted arrangement
as the existing reviewed loop route. It does not change default discovery or
migrate any channel, and the old `3.0.0-yue2-reviewed-loop` remains repeat-only.

- The accepted arrangement must explicitly say `once` and match the candidate.
- Source preparation retains exact approved FLOAT WAV bytes and all native frames.
  It neither folds, regenerates nor re-encodes that source.
- `yue2-assembly-source/v2` binds once playback, zero crossfade, unchanged frame
  count and the same listening/prepared SHA. Existing repeat v1 remains readable.
- The timeline consumer passes once playback into the actual compositor. Music
  ends at its native endpoint; silence pads the remaining timeline instead of
  another repetition. Narration and video continue to their existing exact clock.
- A timeline shorter than the source is rejected before timeline-body encoding.
  The compositor independently probes and refuses truncation as well.
- Composer mix levels, current owner approval, execution authority, private
  storage, cleanup and no-repair-reuse restrictions are retained. Source approval
  does not authorize publishing. Once crossfade settings other than zero reject.

## Evidence

The actual registered module test uses synthetic approval/storage transports but
real private-source preparation. It proves byte identity, typed artifact admission,
compiler handoff, preserved mix level, no URL fallback, cleanup, refusal to trim,
revoked-authority refusal and corrupt once-receipt rejection. The first new test
fixture incorrectly retained repeat intent; the real schema rejected it. The
corrected fixture is built using the actual accepted-arrangement constructor.

A separate real FFmpeg test compares once against the unchanged legacy default:
both retain audible source content; at three seconds a two-second once source is
silent while the repeat master remains audible. A one-second timeline rejects
that source. Both use the production compositor, without mocked FFmpeg.

The retained YuE2 source was also run through this compositor, network disabled:
142.438667 seconds of audio into an exact 145-second diagnostic master, no source
mutation, and zero peak in 24,000 decoded tail frames. Composition plus inspection
took 17,315 ms. The 320x180 test-pattern picture is a diagnostic only, not a visual
quality comparison or a changed production encoding configuration. Temporary
diagnostic media were removed. Compact evidence is retained in
`test-fixtures/music-composer/assembly/retained-source-once-composition.json`.

Nineteen selected module/approval/continuation/resume tests and two real compositor
tests passed, including the existing narration/in-world-audio ducking regression.
Typecheck, focused lint, production build and local Graphify update passed.

## Still Required

This is not live generation or owner approval of a narration-bed score. The
retained Lo-Fi track tests transport/composition only. Real exact-duration
background generation, listener-approved channel fit/voice masking, automatic
version selection, complete QA/release and production deployment remain open.
No thumbnail generation, GPU start, external publishing or legacy-channel change
was performed.
