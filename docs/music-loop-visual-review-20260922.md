# Loop-aware final visual review

## Actual route

Production `qa_visual` opts into this path only for a currently approved YuE2
assembly source in the `music_loop` lane with 90 seconds to eight hours of output
in complete 30-second units. Other durations retain ordinary full-video review.
Legacy channels, narrated routes and the separate Short reviewer keep their
existing coverage rules. No channel record or default pipeline is migrated.

`reviewRender` never accepts a supplied repetition receipt. It verifies the
current local master's complete packet stream and SHA-256 itself, then samples
the first 90 seconds: the 30-second intro, first body and a repeated body.
Scene detection is bounded to that interval. Channel world, critic doctrine,
quality criteria, reference mechanics and conservative batch scoring continue
through the same reviewer. A changing/narrated plan, chapter or outro contract,
late timed requirement or incompatible sealed focus plan refuses this mode.

Seven exact witnesses at 29.9/30/30.1, 59.9/60/60.1 and 89.9 seconds must survive
extraction and review. Unique-material sampling must have a maximum six-second
gap. The normal broad/reactive budgets remain; these seven required witnesses
are explicit rather than silently dropped by the reactive cap.

## Repetition is not quality

The ordinary full-programme frame gap stays in evidence unchanged. A separate
`music-loop-review-coverage/v1` field records the sampled interval, its measured
gap and exact-master repetition proof. This does not claim that still frames
provide continuous visual review, establish musical quality or prove that a
loop transition looks good. Actual visual defects, incomplete reviewer replies,
missing broad scores and failed/unobservable reference criteria still hold the
master. Audio, source approval and the other deterministic QA gates still run.

The packet verifier also checks the reference body's NAL framing. SPS and PPS
must initialize the first IDR before any slice; later parameter updates refuse.
Only the existing renderer's supported slice/access-unit/filler NALs and
unregistered-user-data SEI are accepted. Other persistent SEI requires separate
qualification. This strengthens packet equivalence with decoder-state checks;
older packet-only receipts do not acquire the new witness retroactively.
FFmpeg's [SEI type definitions](https://www.ffmpeg.org/doxygen/4.3/h264__sei_8h.html)
distinguish unregistered user data from recovery, timing and frame-packing data.

## Durable admission

The complete-manifest fingerprint binds this coverage into the release receipt
and certificate. The durable release reader independently validates its schema,
master SHA/duration/size, packet/layout counts, sampled gap and every required
join timestamp. Even a newly re-sealed malformed coverage object refuses.
A loop-coverage claim without the full-manifest fingerprint is not accepted.
Proof runtime remains diagnostic logging, not manifest identity, so repeated
verification of identical bytes cannot alter evidence merely through timing.
The stage summary and quality-evidence details expose the two coverage scopes.

## Qualification

The integrated regression renders a real 180-second master using the production
loop compositor, performs real packet/decoder-state checks and JPEG extraction,
runs a guarded reviewer transport and passes the real durable evidence reader.
It verifies source/channel prompt context and the two-image request limit.
Changing a packet after the sampled interval refuses before any reviewer call.
Narration, late overlays, an outro contract and a wrong source hash also refuse.
Re-sealed false gap and packet-count claims fail at durable release admission.

These are infrastructure/transport tests, not human or model quality approval.
The retained eight-hour master is separately exercised through the same real
scanner and frame-extraction path with a guarded reviewer; its checked-in
qualification receipt explicitly labels that scope. No GPU start, thumbnail
test/generation, live channel mutation or production promotion is part of this
batch.

The final eight-hour transport run completed in 188,194 ms: all 864,000 packets
passed, 25 real JPEG frames were extracted, all seven required witnesses were
present and 13 bounded reviewer requests ran. The measured unique-material gap
was 6 seconds; the literal full-programme frame gap remained 28,710.1 seconds.
The final receipt is
`test-fixtures/music-composer/assembly/natural-loop-8h-visual-review-transport.json`.
Its synthetic reviewer score/verdict is deliberately not promoted into an owner
approval or production quality certificate.

## Still Open

A live channel-grounded visual verdict, owner music audition and complete
eight-hour production QA/runtime qualification remain required. In particular,
the independent full-programme black/dead-air scan has not been replaced by
this sampled visual-review path. This batch is not whole-MVP completion.
