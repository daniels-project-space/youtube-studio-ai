# Channel Library: fit the actual panel, not just the viewport

## Before evidence and root cause

Canonical production `d24a00e72835d102e8753783b1e83e7227d77111` passes the main
Library's enlarged-text checks, but a separate check of Inked Histories'
Library tab exposed a different ancestor-grid defect. Desktop passes. At
390px with 200% root text, the available channel Library is 332.40625px wide,
but its implicit grid track, header, video grid and actual card are 391.125px
wide. The card extends from x28.796875 to x419.921875, outside the viewport.

The section label `Active masters / newest first` is forced onto one line.
Its measured width is 368.734375px; adding its 0.7rem gap gives the exact
391.125px min-content width inherited by every grid item. An ancestor's
existing `min-width: 0` does not change an implicit grid track's automatic
minimum. This is not fixed by hiding page overflow or shrinking video text.

Retained actual production evidence:

- `/tmp/ysa-library-truth-production-gjBKOf/channel-uY4ZMs/results.json`:
  actual card, thumbnail, text and ancestor geometry, including failed bounds.
- `/tmp/ysa-library-truth-production-gjBKOf/channel-pressure.json`:
  exact label/gap measurements, without candidate CSS injection.
- `/tmp/ysa-library-truth-production-gjBKOf/channel-cwbMw3/390-2x-context-0.png`:
  independently inspected clipped card, section label and full-Library link.

## Scoped candidate

Only `channelHub.module.css` changes application behavior. The channel Library
gets an explicit zero-minimum single column, zero-minimum direct children,
and a wrapping section label. Its intro heading also loses the inherited 9rem
minimum, which exceeds the available channel panel at 320px/200% text. All
changes are scoped to `.libraryWorkspace`; other channel tabs keep their
existing layout. No font is reduced and no clipping is added.

Queries, records, URLs, channel identity, actions, thumbnail selection,
16:9 media geometry, native player and release-evidence meaning are unchanged.
This is a small real layout repair, not a redesign of the channel's artwork
or a quality approval for its retained legacy video.

## Qualification still required

The portable actual-app browser proof must retain a failing no-overlay d24
baseline and test the exact scoped candidate stylesheet against unchanged
live DOM/data. Candidate-style injection is explicitly not deployment proof.
Required profiles are desktop and 390px at normal/enlarged text, plus 320px
at enlarged text. Header/link/label/card geometry, actual image loading,
card-to-Lightbox action and full channel name are separate assertions.

After isolated source/build/tests and release, replay without any candidate
stylesheet on the exact canonical deployment. Main Library qualification,
whole-channel-page accessibility and video visual quality are not implied by
this narrower downstream check.

## Candidate qualification

The final frozen actual-app proof is
`scripts/channel-library-browser-proof.mts`, SHA-256
`ad9bae24710fb91ae873b63b77c5a812e20bf145fd06cbaf3cf8efa6b4a987fd`.
The channel stylesheet SHA-256 is
`3f21cb930b208179d325e5eba50c2edcfaf43d741749d7bd6d383cd3f7769cb7`.

The same final proof fails the unchanged d24 production baseline only at
390/320px enlarged text (34/37 element/text violations):
`/tmp/ysa-channel-library-proof-RhbSaj/results.json`. The exact source-derived
candidate overlay passes all five profiles at
`/tmp/ysa-channel-library-proof-LQhcG0/results.json`. An independent root replay
also passes all five at `/tmp/ysa-channel-library-proof-0hHd4g/results.json`.
Each run retains source/proof hashes, exact extracted rules, real CSS-module
mapping, full text, computed exclusions and media observations.

All five candidate cases open the actual master, play/pause/seek to 15 seconds,
report duration 200.551 seconds and readyState 4 without media error, preserve
native ArrowRight behavior, restore focus/body scrolling on Escape, and
navigate through the actual full-Library link. Source thumbnail and 16:9 frame
bounds pass. Normal desktop/phone dimensions are unchanged; the oversized
enlarged-phone track now fits its real container. Strict standalone script
typecheck and ESLint pass. Final desktop, enlarged-phone header/card and native
screenshots were inspected, including independent root pixel inspection.

The combined exact-source build with the separately reviewed transcript repair
passed in `/tmp/ysa-seed-build-mIHmro/repo`; actual UI contracts and the 22-case
Python-to-TypeScript bridge also pass. Logs are
`/tmp/ysa-transcript-channel-combined-build.log`,
`/tmp/ysa-transcript-channel-combined-ui-test.log`, and
`/tmp/ysa-transcript-channel-combined-bridge-test.log`. Complete transcript-suite
qualification subsequently passed all 650 tests on the identical frozen eight
transcript runtime/test files. The combined source also passed full ESLint
(zero errors, 33 existing warnings). The final release/no-overlay production
check is still pending, so none of the overlay results establish deployment.

The 320px/200% full-context image also retains existing shell presentation
issues outside this patch: the channel selector breaks its label mid-word and
the bottom Channels label exceeds its selected-button background. They were
not removed from screenshots or claimed fixed by the scoped workspace checks;
the next navigation polish pass must address them separately.
