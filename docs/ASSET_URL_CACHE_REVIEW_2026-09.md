# Shared media URLs — request and playback lifetime

## Contract and root cause

The real `useAssetUrlState` consumers include channel art, run assets, preview cards and the saved-video dialog. Concurrent mounts previously started one signing HTTP request each. Resolution was cached only by still-mounted consumers. Changing an error callback could retry a failed request again, while a newer cache entry could replace another mounted component's URL on rerender.

The repair shares one pending operation per exact asset key, caches successful results for the existing nine-minute window, bounds retained entries to 256 with recent-use eviction, and releases failed entries for retry. Invalidation aborts/removes the exact pending generation; even a late response from a transport ignoring abort cannot repopulate the cache or erase its successor. Signing has a real 15-second timeout. Component cleanup prevents stale state/callback updates without cancelling work still needed by another consumer. Callback identity is no longer a fetching dependency.

Mounted media retains its own resolved URL; a new component can get a fresh URL without restarting media already playing. This deliberately does **not** rotate URLs every nine minutes. The server's one-hour signed-URL validity and existing ownership checks are unchanged. Recovery of an already-playing video after its URL truly expires remains separate unfinished work, not claimed here. No new polling, Convex subscriptions, server route, key access, model/render settings or stored-media writes are introduced.

## Falsifiable evidence

- `assetUrlCache.test.ts` exercises ten concurrent callers sharing the same promise, warm hits, actual TTL boundary, rejected/malformed response retry, invalidation versus late completion, a 260-entry eviction workload, and the real 15-second transport abort. It passed before release qualification (`/tmp/ysa-asset-url-cache-tests.log`). Its initial CJS top-level-await and TypeScript inference failures were corrected in the test harness; they were not application defects.
- The actual React/Chromium fixture now runs under StrictMode. All ten cases pass: stored/reviewed/fallback selection and decoded native 15s frame checks, six simultaneous previews, expired-cache new mount with stable existing source, and five error-callback rerenders without repeated requests. `/tmp/ysa-asset-coalescing-after.log` records the exact capture directory.
- The same ten-case oracle against frozen production `69ad087` fails three checks (`/tmp/ysa-asset-coalescing-before.log`): concurrent signing, the new-mount refresh under repeated effects, and callback-triggered retry amplification. An earlier non-StrictMode run separately observed the old mounted URL change when a new cache receipt arrived. The original seven preview-source cases remain passing; these are separate cache defects.
- The initial seven-image harness waited on off-screen lazy images without scrolling. Correcting the harness to make every image eligible removed the timeout; decoded image dimensions and ready-state requirements were retained. This was not counted as an application bug.
- Root typecheck and changed-file lint pass after the harness correction. A clean production-based candidate, full release gate and production verification are required before shipping this follow-up.

The controlled simultaneous-preview case reduces signing requests from six to one. Actual fleet-wide request volume, latency and billing savings are not inferred from that fixture. Existing provided imagery and an already-rendered assembly clip are reused; there are no paid generations. This improves goal items 80, 102, 108, 139 and 148 without marking any whole item complete.
