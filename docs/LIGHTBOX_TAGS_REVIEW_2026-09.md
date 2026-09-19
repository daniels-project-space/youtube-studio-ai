# Saved SEO tag reflow — September 2026

Status: released in `478c897acabb2db23d61198bfb2cbbe4788b9479`; exact provider and full-shell production verification completed below.

## Confirmed defect and narrow repair

Read-only production review at `9acde4442bd1b3a7c9337f95f16e6922a2be0bf5` found saved SEO tag chips escaping the Library Lightbox at 200% root text size. At 390px the dialog's client/scroll widths were 364/417px; at 320px they were 294/417px. The actual saved tag `metal detecting finds preservation` was 404.906px wide. The flex container wrapped chips, but each chip's `whiteSpace: nowrap` prevented its text from wrapping.

Only the SEO tag span styles in `src/components/Lightbox.tsx` change: normal white space, zero minimum width, maximum width of 100%, and `overflowWrap: anywhere`. Tag strings, colors, font size, padding, borders, metadata, player and event handlers remain unchanged. No truncation, hidden overflow, smaller text, or source-data correction is used. Owner locks were checked and empty before edits.

Production before evidence is retained in `/tmp/ysa-9acde-production-DUhGrY/large-text-results.json`, with `library-{390,320}-200pct-tags-overflow.png` and native-player screenshots in the same directory. The original production master and metadata were not modified. The historical tags' relevance/quality is outside this layout repair.

## Actual component/browser regression

`scripts/lightbox-tags-browser-proof.mts` bundles the real Lightbox, VideoPlayer, SignedVideoPlayer, URL cache and component CSS. Only local data/signing/media transport is substituted. It uses the 16 exact saved production tag strings, an explicitly supplied retained MP4 and real native HTTP Range responses. It does not copy player logic, dispatch fake media events, download media, call providers or write production data.

Run from the repository root:

```sh
PREVIEW_TEST_VIDEO=/tmp/assembly-smoke-DanWJe/bk_smoke_2_loudnorm.mp4 ./node_modules/.bin/tsx scripts/lightbox-tags-browser-proof.mts
```

The same unchanged six-case oracle covers 1440px, 390px and 320px at 100% and 200% root text. It asserts dialog scroll/client width, every actual text Range inside its chip, all exact tag strings and selection text, native paused/non-seeking playback at 15 seconds, same video DOM/time after toggling Script, unchanged YouTube source link, gallery navigation to the sibling source, Escape, focus return and body-scroll restoration. Browser errors and external requests must remain empty. It hashes the reviewed Lightbox before and after the run.

The exact pre-fix source remains available through `LIGHTBOX_TAG_SOURCE=/tmp/ysa-critic-reference-release-ayRj4c/repo/src/components/Lightbox.tsx` for inverse testing; it has the same SHA-256 as the retained clean baseline. Both runs used the same fixture and script assertions.

| Local profile | Before client/scroll width | After client/scroll width |
| --- | --- | --- |
| Desktop, 100% and 200% | 960/960 | 960/960 |
| 390px, 100% | 366/366 | 366/366 |
| 390px, 200% | 366/402 | 366/366 |
| 320px, 100% | 296/296 | 296/296 |
| 320px, 200% | 296/402 | 296/296 |

The corrected transport baseline exited 1 with exactly the two phone/enlarged-text overflow failures. The repaired run exited 0, all six cases passing. All 16 chips' text, left/right/width/height and font size are exactly equal before/after at standard text in all three profiles. Complete screenshot hashes are not identical; this review does not claim whole-frame pixel equality. Enlarged tags visibly reflow to readable lines. All six tag screenshots and both enlarged-phone player screenshots were independently inspected.

Before JSON/screenshots: `/tmp/ysa-lightbox-tags-proof-ORGD4f/`. After JSON/screenshots: `/tmp/ysa-lightbox-tags-proof-t1DHEh/`. Logs: `/tmp/ysa-9acde-production-DUhGrY/tag-local-before-corrected.log`, `tag-local-after.log`, `tag-lint.log`, `tag-typecheck.log`. Focused ESLint and nonincremental TypeScript check exited 0. The initial harness run attempted a YouTube fallback thumbnail and was corrected to serve an explicit local thumbnail; its original log remains `tag-local-before.log`. No application behavior assertion was relaxed.

Source before SHA-256: `45252e5f2eca379486e79c2d26b621deaa1d0460258fc47842d18f4624004490`. Source after SHA-256: `cc50b8454965fa260a27b3487afec2305a8f38846394db9a110d2a780fa9744e`. Retained MP4 SHA-256: `de7b07e460ee9c5e3fd4f5f7ad57e1b78a03aaaf7543ea9c21d2f06b1399d15c`; native duration 31.021995 seconds, readyState 4, paused true, seeking false, currentTime 15, no media error in every case.

## Limits and handoff

The local transport shell supplies representative base typography/theme tokens; its 2px width difference from the full production shell is explicit above. This is real native playback of a retained diagnostic clip, not the 200.551-second production master and not a whole-footage/content-quality approval. Tag chips have no copy button; exact selectable text is verified without writing the host clipboard. The existing YouTube link is checked, not opened externally. Provider selection, auth, signing recovery, shared cache and publication behavior are unchanged.

## Exact production verification

The [joint release receipt](QWEN_QUALIFICATION_REUSE_REVIEW_2026-09.md) records all646 tests, build/typecheck/audits/actual assembly, exact Vercel deployment and canonical alias, Convex and terminal Trigger20260909.29. Production evidence is `/tmp/ysa-478c897-production-vVYwrP/`; ordinary native-media regression is `/tmp/ysa-library-player-production-D6uCUg/results.json`.

Full-shell review corrected a fixture-coverage assumption: the local proof has16 representative saved tags, while the actual production record has30. The final production oracle checks **all30** exact strings and text ranges at320/390/1440px with200% root text. Dialog client/scroll widths are294/294,364/364,958/958px. All tags fit, remain selectable, and Script toggling preserves the same paused video DOM at15seconds. The actual retained200.551-second production master responds with206 Range data; readyState4, no seeking, media errors, page errors or production writes. Twelve production screenshots were inspected by the independent reviewer; root also inspected enlarged phone tags and desktop player.

The supplementary blanket44px-control oracle reports the existing desktop Script toggle at34.5625px. This is retained as a separate finding, not hidden or described as an overall pass. The requested tag, text, native-player and action checks pass; phone targets satisfy44px. No claim of complete accessibility compliance or historical video/SEO quality is made. The original16-tag subset results and the final30-tag results both remain available.
