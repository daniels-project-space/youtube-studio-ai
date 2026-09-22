# One-Hour 4K Delivery Evidence

At source revision `ba62a3ae`, the production `composeMusicLoopDeblur` function
assembled the retained real YuE2 music into a 3840x2160 diagnostic master. No
provider generation, GPU start, channel migration or publishing was performed.
The renderer and verification scripts ran with external networking disabled.

This is delivery/transport evidence, not a complete pipeline run or channel
qualification. Picture content is a 320x176 synthetic timing pattern scaled to
4K, not native-4K imagery. Source listening approval remains outstanding.

## Retained Master

- Path: `/var/lib/youtube-studio-render/operator/composed-score-assembly-20260922-3600-4k/timing-master.mp4`
- SHA-256: `fa486085e6076d3e6b1c7364d862afca9d3dbbc6023f9eb3ca3d207e492b41f4`
- Bytes: 3,998,892,643.
- Video: H.264, 3840x2160, 30 fps, exactly 108,000 frames.
- Container, video and audio durations: exactly 3,600 seconds.
- Audio: AAC, 48 kHz stereo; existing 384 kbit/s encoder target retained.
- Assembly wall time: 411,595 ms, within the existing 3,600,000 ms budget.
- Listening source SHA-256, unchanged after assembly:
  `74183b3537381622fa9c83a031a9a51a7f9314763e3634c20eb2cdda8a307b93`.
- Native source: 6,837,056 frames; folded loop: 6,741,056 frames. No source
  truncation to the originally requested 30 seconds was introduced.

The same directory retains `evidence.json`, `inspection.json`,
`video-repetition.json`, `audio-alignment.json` and `frame-check.png`.

## Independent Checks

The video oracle scanned all 108,000 packets, compared 106,200 repeated-body
packets against the reference unit, and verified independent IDR boundaries and
stable decoder parameters. There are 119 body units following the intro unit.

Decoded audio was compared with the folded PCM source at 10, 1695.264 and
3520.966667 seconds, across wraps at 1684.764 and 3510.466667 seconds, and through
both boundary fades. All correlations exceeded 0.99994; RMS ratios ranged from
0.99781 to 0.99960. These sampled comparisons establish alignment at those
positions, not continuous perceptual approval of every second.

A separate full-duration EBU R128 scan measured -16.3 LUFS integrated loudness,
9.2 LU loudness range and -1.1 dB true peak. These are observations, not a claim
that an authored channel loudness target has been qualified.

Frames at 1, 30, 1800 and 3599 seconds were inspected. They contain the expected
diagnostic pattern; the first retains the intentional intro blur and fade.
This is neither a full decoded-frame review nor evidence of channel aesthetics.

A preceding 60-second 4K diagnostic passed clock and decoded-audio checks in
47,453 ms. Its master SHA-256 is
`b81936dcede2f0e913a27d1f1def34c12cd37399a5a5eafa3042427762b80385`.
Disk headroom was checked before the long render; encoder quality was unchanged.

## Live MVP State

Read-only checks at 10:06 UTC found the canonical vaulted key authenticated,
with the expected organization, and the retained RTX 3090 stopped at the
reported 18 cents/hour rate. The key fingerprint remains `26ed1345e3b8`.
The prior restart denial is unresolved; no denied write was retried and read
access is not represented as write authorization. The shutdown guardian was
inactive with a successful result.

At 10:14:10 UTC the production health endpoint still returned HTTP 200 and
revision `722facc4f5aaad004dcd9f96de3be7a29951a520`. This branch is not deployed.
The retained source was presented to the owner for musical feedback, without
recording a positive audition or approving production/publishing on their behalf.

Eight-hour 4K delivery, actual channel visuals, musical approval, live reviewed
continuation and the broader module-first MVP remain incomplete. No thumbnail
tests were run. No application code changed in this verification checkpoint.
