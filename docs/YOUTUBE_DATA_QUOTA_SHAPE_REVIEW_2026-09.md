# YouTube Data request-shape review — 10 September 2026

This is a focused follow-up to item 74 in the goal backlog. It inspects the
actual public evidence readers in `src/lib/youtubeData.ts`; it does not call
YouTube, mutate Convex/R2, or claim a provider invoice reduction.

## What changed

- `search.list` now uses the required `snippet` part but asks for only
  `items(id/videoId)` through `fields`.
- Competitor `videos.list` keeps the three required parts and narrows the
  response to the title, channel, tags, publish date, selected thumbnail URLs,
  engagement counts, and duration that the reader actually consumes.
- Live stats reads request only `snippet(channelId)` and the three engagement
  counters; channel rollups request only their three counters.
- Video and channel ID inputs are trimmed, empty values are dropped, and
  duplicates are removed before the 50-ID batches are formed. The stats reader
  remains deliberately uncached because it is live account telemetry.
- A process-local defensive observation reports requests, current estimated
  list-method quota units, cache hits, and in-flight coalescing for the three
  readers. It is resettable for audits and is not a billing ledger.

## Evidence

`src/lib/__tests__/publicEvidenceCache.test.ts` runs against a fetch seam and
proves:

- equivalent concurrent/repeated search calls make one transport request;
- equivalent concurrent/repeated detail calls make one transport request;
- duplicate IDs make one normalized stats batch and one normalized channel
  batch;
- each request has the intended `part`/`fields` shape;
- callers cannot mutate cached detail tags or metrics snapshots;
- the observed low-level pass is one search request, two video requests (one
  detail read and one live-stat read), and one channel request, with cache and
  coalescing counts matching the calls.

`pnpm exec tsx src/lib/__tests__/publicEvidenceCache.test.ts`, typecheck, and
scoped ESLint pass. The full production-readiness gate remains required before
release.

## Quota interpretation

The current official YouTube documentation lists one quota unit for list reads
and explains that `fields` reduces response transfer/parsing, not the method's
quota charge: [quota costs](https://developers.google.com/youtube/v3/determine_quota_cost),
[partial responses](https://developers.google.com/youtube/v3/guides/implementation/partial),
[search.list](https://developers.google.com/youtube/v3/docs/search/list),
[videos.list](https://developers.google.com/youtube/v3/docs/videos/list).
The code therefore records an *estimated* one unit per attempted list request,
keeps failures un-cached/retryable, and does not present the estimate as an
account-console measurement. A durable cross-module usage/quota ledger remains
open work under items 72–74.

