# YouTube Data evidence cache review — 10 September 2026

## Scope

The public `search.list` and competitor `videos.list` readers in
`src/lib/youtubeData.ts` are used by Metacraft, Topicraft niche research, and
outlier scoring. Before this pass each caller could issue the same public read
independently, even when equivalent work was already in flight.

## Change

- Search keys normalize whitespace/case and include every query-shaping option.
- Detail keys bind the exact ordered ID batch; the existing 50-ID batching is
  unchanged.
- Successful responses use the shared bounded five-minute evidence cache and
  concurrent equivalent calls join one promise.
- Failures are never cached, so a transient quota/transport error remains
  retryable.
- Arrays and nested tag arrays are copied on return; a caller cannot mutate the
  retained evidence for another consumer.
- `clearYouTubeDataEvidenceCache()` is available to isolated tests and an
  explicit operator reset; stats refresh remains uncached because it is live
  account telemetry.

## Evidence

`src/lib/__tests__/publicEvidenceCache.test.ts` uses a fetch seam (zero network
and zero provider spend) to prove concurrent equivalent search and detail calls
produce one request each, repeated calls reuse the result, caller mutations do
not poison the cache, and the surrounding Metacraft/outlier cache contracts
still pass. The full frozen gate passed all 664 direct tests, assembly smoke,
typecheck, lint, and unchanged structural audits.

The request-count result is a deterministic local transport measurement, not a
claim about a YouTube quota invoice. Cross-module immutable packet sharing and
provider quota accounting remain open backlog work.
