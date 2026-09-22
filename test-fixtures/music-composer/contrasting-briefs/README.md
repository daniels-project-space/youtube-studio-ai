# Contrasting composer briefs: real text, not generated-audio approval

Four deliberately separate OpenRouter calls evaluated two new synthetic briefs.
They are not exports or edits of existing channels. Inputs specify contrasting
personas, doctrines, audio identities and musical intent; no score was supplied
manually. Each call had a $0.10 ceiling, retained its exclusive attempt/dispatch
claims, and was never automatically retried. No GPU was started.

`01` is the original composer instruction set. `02` adds explicit notation
guidance for stable drones, ties, speech-space rests and promised trailing
silence. Within each pair the input, model, reservation and all recorded source
implementation hashes except `crew.ts` are identical. Provider generation is
stochastic: these are two before/after cases, not a statistical reliability claim.

| Brief | Before | After | Reported text cost, pair |
| --- | --- | --- | --- |
| Sleep, 30 seconds | Four untied notes, two pitches, three chord symbols, no rests | One tied note over 28.5 seconds, one pitch/chord, 1.5-second ending rest | $0.02441850 |
| Narration, 60 seconds | 23 notes, zero notated rests or ending silence | 27 notes, 23 seconds of notated rests, 6-second ending rest | $0.02815050 |

Total reported text cost: **$0.052569**. All four unchanged scores pass the actual
native parser and exact symbolic-duration check. All Vocal parts contain rests
only. The `score-review.json` files were generated afterward, CPU-only, from the
retained requests using that same parser. Original provider artifacts and
`result.json` records are unmodified. Future evaluations now save these reports
and bind their digest in the result automatically.

## Critical assessment

The revised sleep notation is more consistent with the static brief; the revised
narration notation actually encodes the requested gaps. This does not prove that
YuE2 will perform the score faithfully or produce pleasant, instrumental audio.
Written rests can still contain generated accompaniment or reverberation. Chord
symbols are instructions, not measurements of rendered harmony.

The narration revision also has more note attacks and a higher register (MIDI
60-76 instead of 48-64). These can compete with speech despite the new gaps and
must be checked in the actual narration mix. The sleep revision's generated
`audio.bedLufs` is -24 while deterministic composer directives retain the default
-14 master target. Those fields describe different mix concepts; this comparison
does not establish that the downstream mix implements the desired sleep level.
Do not turn either score into an approved candidate on these reports alone.

No universal rest-density, pitch-count or chord-count quality threshold is added.
The report exposes observable notation facts for checking against each brief;
it does not pretend that more silence or fewer notes is always better.

## Replay

With `YUE2_TEST_RUNTIME=/home/ubuntu/youtube-studio-music-runtime`, run
`npx tsx src/scripts/__tests__/evaluate-music-composer.test.ts`. This forbids
external HTTP, recomputes every retained score report, checks source identity,
before/after provenance, charged single-call evidence and unchanged no-approval
flags. Its separate synthetic cases retain bounded admission and no-replay
coverage. No live provider is called by this regression test.
