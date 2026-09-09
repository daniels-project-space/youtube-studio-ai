# Motion Comic final-master duration

Scope: metadata provenance only. No renderer/provider/quality changes, no
publishing, no retained-asset edits, and no claim that historic footage passed
current quality gates.

## Confirmed live cause

Read-only production observation on 2026-09-09 at 18:29–18:31 UTC, alias
`youtube-studio-ai.vercel.app`, revision
`be0439b798917a22251009de65c2462d420310bb`:

- Run `js76ghf4s44b4w5d97cs2f49bd89znxa`, “7 Secrets of Battlefield Relic
  Preservation Revealed”, is `legacy_unverified`.
- Its sole video asset `j57bn4jx32re8jekgw11rzmrw189zppg` has metadata
  `{durationSec:197, engine:"motion_comic", panels:8}`. The Motion Comic stage
  also returned 197 seconds.
- Native playback of that exact saved `final.mp4` and persisted QA structural
  evidence both report **200.551 seconds**. QA's length check compared 197 with
  200.551 and accepted its 1.02 ratio; this did not repair metadata.
- Retained logs show two pages, 6,016 Python-rendered frames / 200.6 seconds,
  then the TypeScript summary of 197.1 seconds.

`castMotionComic` previously returned preroll plus panel durations, omitting
the Python renderer's page-turn pauses (1.3 seconds each) and final hold (2.2
seconds). This was an incomplete timeline estimate, not simply narration
duration. The block rounded it and `videos.listVideos` trusted that asset field.

## Change

The real cast now uses the existing `ffprobeDuration(args.outPath)` after its
final mux and optional normalization. Non-finite/non-positive measurements and
millisecond overflow reject; there is no planned-duration fallback. The block
retains fractional seconds when returning and recording `videoDurationSec`.
The final file, rendering commands, providers, and existing fail-soft
normalization policy are unchanged.

## Verification

`src/lib/__tests__/motionComicFinalDuration.test.ts` calls the actual cast and
block through bundled production source. Only process, provider, capability,
and filesystem/storage transport boundaries are substituted. The unchanged
test failed first on the old cast (`10900 !== 200551`), then on the old block
rounding after the cast fix (`201 !== 200.551`). Eleven cases cover measurement
ordering, fractional persistence, invalid values, failed probing, and surviving
the existing optional-normalization failure path. Invalid final measurement
reaches neither media upload nor video/narration asset recording (the pre-render
zero-spend visual-atlas experiment receipt remains unchanged).

`scripts/motion-comic-duration-proof.mts` uses an existing 31.021995-second local
MP4, the actual shared FFprobe implementation, actual cast/block callers, and
Chromium's native range playback. It asserts exact persisted duration and
unchanged SHA-256 at the intercepted upload boundary, then samples start,
15 seconds, and near-end. A corrupt local master is also rejected by real
FFprobe before upload. It prints a `/tmp/ysa-motion-duration-proof-*/results.json`
evidence path. This is a final-byte transport proof, **not** a fresh Motion Comic
render, voice-content review, creative approval, or production metadata repair.
For replay, explicitly supply `DURATION_PROOF_VIDEO=/absolute/path/to/master.mp4`
to `npx --no-install tsx scripts/motion-comic-duration-proof.mts`; there is no
machine-specific implicit fixture path or automatic download.

`scripts/recent-video-duration-browser-proof.mts` generates only a cheap local
solid-color H.264/AAC control clip (31.75 seconds requested; 31.766667 seconds
measured). The actual cast/block persists that measurement; an HTTP data fixture
passes the recorded value to actual `RecentVideos`, its URL hook and native
dialog player. The card shows **0:31**, matching native controls, rather than
the old rounded **0:32**. This independently verifies the root agent's UI
flooring change without editing UI source. Evidence:
`/tmp/ysa-recent-duration-proof-HZWUve/results.json` (settled native card/player),
and `/tmp/ysa-motion-duration-proof-4J0YEL/results.json` (retained-byte proof).

QA dependency check: current Motion Comic already returns separately measured
voice-only `narrationDurationSec`; `qa_visual` prefers that as its comparison
target. The tests pin its independence from measured master duration and call
the actual `length_check` with max=200: a 200.551-second master rejects even
though the old 197-second estimate would fit. No QA bound is relaxed. Legacy
snapshots without narration evidence still use `videoDurationSec` as a fallback;
that shared planned/measured contract remains a separate follow-up, not a silent
change here.

## Existing artifact-bound backfill option (not executed)

For this one legacy asset, an explicitly authorized reconciliation may measure
the exact retained key
`owner/owner_daniel/channel/inked-histories-1783204937695/runs/js76ghf4s44b4w5d97cs2f49bd89znxa/final.mp4`,
retain its current object version/ETag plus content SHA-256, byte length, probe
version and measured duration, then conditionally update only the matching
owner/run/asset metadata if the object and row still match that receipt. Preserve
the previous metadata and measurement provenance for audit. Do not overwrite
bytes, rewrite historical stage outputs, upgrade release status, or infer
publishing approval. The historic QA duration alone is not a current
content-hash-bound repair receipt.

Unchanged follow-ups: other producers' calculated durations, duplicate/mismatched
master metadata selection, and certified-master duration projection. The root
agent owns the separate UI-flooring repair verified by the companion proof;
this patch does not edit UI source or the frozen UI release.
