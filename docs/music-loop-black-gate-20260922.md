# Proof-bound music-loop black-frame validation

The production QA caller now passes its exact-master music repetition evidence
to `validateRender`. Explicitly pacing/static-exempt music loops can decode the
first 90 seconds for black detection: the unique intro, first body unit, and a
second body unit exposing wrap-spanning darkness. Custom thresholds above 30
seconds retain the full-programme scan. Other lanes remain on the existing path.

The bounded path validates the full repetition receipt and sampled-frame
coverage against a freshly measured whole-file hash and byte length. It hashes
again after decoding and checks file identity, size, and modification time.
It has a 180-second combined deadline and a 64 KiB FFmpeg output limit.
The existing 4 fps sampling and 0.04 pixel threshold are unchanged.

A shared EOF exemption bug was also fixed: the black interval must now start
inside the short ending window, not merely end there. An entirely black master
cannot qualify for that exemption.

## Qualification

- Real FFmpeg fixtures reject wholly/mostly black endings and preserve a short ending.
- Full and bounded scans agree on actual 180-second production-compositor fixtures.
- Two four-second dark body edges form an eight-second wrap defect, correctly rejected by the six-second gate.
- Wrong proof hashes, modified source bytes, and source mutation during decoding fail closed.
- An already-aborted streaming hash rejects without accepting source evidence.
- Selected tests: repeatedMusicBlackGate, temporalDynamism, visualPacing; four passing Node test results.
- Typecheck, focused ESLint, production build, and local code-graph update passed.

The retained 28,800-second, 12,983,194,060-byte 1080p master passed the actual
bounded validator in 65,637 ms with network access disabled. The whole-file SHA
remained `c413635329f976ab5b3d652e5708766883f4caa00aab231e39f6f2dc622e7d8d`.
Node reported maximum RSS 368,296 KiB. The scan decoded 90 seconds with zero
black-frame defects, reusing the previously measured full packet proof. That
proof's generation time is not included here. No full eight-hour black decode
was run for this batch; there is no measured fleet cost or speedup claim.

The compact result is in
`test-fixtures/music-composer/assembly/natural-loop-8h-black-gate.json`.
No GPU start, thumbnail test, channel migration, production promotion, owner
approval, or perceptual quality claim is part of this qualification.
