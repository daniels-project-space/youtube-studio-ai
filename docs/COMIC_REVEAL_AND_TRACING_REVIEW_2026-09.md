# Complete comic reveal and exact-order tracing — 12 September 2026

Status: **frozen full local release gate passed; deployment verification pending**. This is a concrete part of backlog items 68, 154, 155 and 158, not completion of the one-image-per-page or character-reference rework.

Runtime `scripts/mc_page_render.py` SHA256: `c0fb69bfa7bd457a0ec0d674aa62428eaa42b7db2c17dd4ff80d87ac7a6d8eb6`.

## Root changes

1. Remove the opening-only prepaint bypass. Opening and later panes use the same actual art mask and hand. One absolute reveal/camera clock spans the preroll and initial narration beat, including zero and sub-frame preroll. No narration, bubble, page-turn or total timeline shifts were introduced.
2. Finish every pane within its actual sampled interval. The caller permits one-second panes, but the old drawing endpoint fell outside that interval; as much as 8% of the art remained missing indefinitely. Cap only the too-long reveal spans so a complete frame is displayed before the interval ends. Ordinary-duration timing is unchanged.
3. Preserve the exact greedy stroke sequence with the already-installed spatial index. Stable original point IDs resolve equal-distance ties; inactive points are filtered and the tree is periodically rebuilt. No strokes are removed, no art is resized differently, and no model or precision setting changes. Paths with 512 or fewer points retain the old simple implementation because the measured index overhead did not help them.

The existing mandatory-opening and keep-clear refusal remain. The old test that demanded literal prepainting was replaced by a stronger actual-frame regression, not a weaker visibility claim.

## Measured evidence

- [Native two-page render comparison](../test-fixtures/comic-opening-reveal/multipage/README.md): actual 1080p encodes, seven panes, page turn, seven runtime bubble cues. All 519 non-opening frames match the old renderer for the ordinary-duration case. The final fast renderer's complete 639-frame default MP4 and 253-frame short-duration MP4 are byte-identical to their slower reviewed timing candidates.
- Main visual inspection covers 88 default-case baseline/candidate samples plus 22 short-case samples, with retained timestamps and final-artifact identity. This uses repeated legacy art as a mechanical fixture, not a new generated or narrated channel. Existing source-embedded text cropping and sparse neighboring boxes remain visible and unqualified.
- Permanent reveal test: 30 actual-opening/schedule/frame-loop configurations; **210 panes complete on their final displayed frame**, visible hand and partial art at frame zero, real missing-opening failure, 7,311 unchanged ordinary non-opening synthetic-page frames. Frozen legacy source demonstrates both original failures.
- [Stroke-order benchmark](../test-fixtures/comic-stroke-efficiency/README.md): exact full trajectories at three real layout sizes. Large-panel tracing fell from **81.682 to 2.673 seconds**; the other measured sizes improved roughly 10–12×. These are local CPU tracing measurements, not whole-video or billed-provider savings.
- Permanent stroke test: 252 exact-sequence cases, including duplicate/tied points, 512/513 boundaries, 2,048-point sets, unchanged inputs and actual native-art connected/crop trajectories. Optional full-size checks match the retained original sequence hashes without repeatedly spending time on the slow baseline.

## Frozen release validation

Already terminal exit 0:

- Full typecheck and production build: `/tmp/comic-reveal-typecheck-20260912.log`, `/tmp/comic-reveal-build-20260912.log`.
- Full lint: zero errors, 29 existing warnings. Structural audits: no regression, no raised/saved baseline. Defect-proof execution: all 14 original failing examples remain demonstrable. Corresponding `/tmp/comic-reveal-{lint,audit,proof}-20260912.log` files.
- Code-only Graphify update: 22,389 nodes / 53,852 edges. No LLM/provider call. Graph and retained fixtures remain excluded from Vercel deployment inputs. The proof generator's unrelated timestamp/history HTML output was restored; no unrelated UI revision is part of this renderer batch.

**All 687 direct production-readiness tests and actual hermetic assembly passed**, log `/tmp/comic-reveal-readiness-20260912.log`, execution handle `54652` terminal exit 0 on 12 September. The actual four-segment 1080p assembly encoded 31.021995 seconds against a 31-second plan with no warnings; it used local synthetic assets, not a provider or new channel. Runtime and all four permanent test/harness hashes were rechecked unchanged after completion. This reuses the frozen validation rather than restarting it.

The real caller in `src/lib/motionComic.ts` invokes this exact `scripts/mc_page_render.py`, and `trigger.config.ts` includes it in the deployed runtime's additional files. Commit/push and exact Vercel/Convex/Trigger verification remain required; local success is not yet a production claim.

The preceding, separate story-completeness/paid-retry release `2a9bbdd` is already verified on the exact web alias, canonical Convex and Trigger production `20260912.24`; see [its release receipt](COMIC_STORY_COMPLETENESS_REVIEW_2026-09.md).

## Still required

Actual one-generated-image-per-page inputs, real immutable character-reference conditioning, full-page ordered region contracts, source-aware composition, complete narrated quality review, persisted accepted-page recovery and automatic unfamiliar-channel selection remain open. The standard upstream ERNIE text-to-image interface does not establish visual-reference support; verify the actual R2 worker capability before selecting or claiming a reference-conditioned route. This work neither changes protected thumbnails nor authorizes publishing a comic that fails visual QA.
