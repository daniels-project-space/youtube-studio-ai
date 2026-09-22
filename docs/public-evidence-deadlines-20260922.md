# Shared research transport deadlines: 2026-09-22

## Finding And Change

Public YouTube Data requests and Reddit trend batches had no transport deadline.
A response stalled before headers or during JSON consumption could hold both
the planning task and all equivalent callers sharing its in-flight cache entry.
The new regression failed against the old source because no cancellation signal
was passed to the transport. No live provider outage was required to expose it.

YouTube Data now creates one 30-second deadline per API operation, covering an
optional connector/global OAuth refresh and the subsequent response body. The
token helper accepts and forwards that signal; it does not reset the clock after
refresh. Other token-helper callers retain their existing behavior when they do
not supply a signal. Existing exact-connector selection and fallback prohibitions
remain unchanged.

Reddit research uses one eight-second deadline for its concurrent subreddit
requests, matching the existing autocomplete request ceiling. Completed signals
remain available when another subreddit fails; an incomplete packet is not cached
as a complete success. Failed YouTube searches/detail lookups clear their shared
in-flight entry and are not cached as successful empty evidence.

There is no automatic retry, new database polling, additional provider request,
TTL change, model change, source truncation or new quality fallback. Each later
caller can explicitly attempt the research again under the same finite limit.
A multi-batch stats refresh has a separate bound per API operation, not one
30-second bound for the entire task. Aborting transport is not provider billing
reconciliation, and these tests do not measure production cost savings.

## Verification

The new test uses actual Node fetch against a loopback HTTP server inside a
network namespace with no external interfaces. It asserts the production
30,000/8,000 ms settings while accelerating deadlines to one second. It covers:

- Stalled search headers and stalled video-detail JSON, including coalesced
  callers, closed sockets, uncached failure and successful cached recovery.
- Stalled OAuth JSON preventing the Data request, exact reuse of the same
  signal across successful refresh and Data retrieval, and pre-cancelled
  refresh causing no server request.
- Partial Reddit success, coalesced requests and fresh retry of an incomplete
  batch, followed by successful reuse of the complete packet.

All seven focused suites passed: deadlines, shared public cache, metadata
evidence cache, resumable uploads, connector validation, stats checkpointing and
stats durability. The deadline suite passed again after the test-only TypeScript
correction. No thumbnails, channel/pipeline mutations, publishing, provider
credentials or paid network requests were involved.
The final production build (including TypeScript) and scoped ESLint passed.

Test log: `/tmp/studio-public-evidence-deadlines-tests.log`.
Final build log: `/tmp/studio-public-evidence-deadlines-build-final.log`.
This advances the shared research reliability/cost work, not completion of the
broader evidence-quality calibration, cross-process caching or module-first MVP.
