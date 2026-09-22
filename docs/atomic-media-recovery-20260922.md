# Atomic media recovery checkpoint

## Failure reproduced

Before this change, real loopback HTTP responses that disconnected after sending
partial bytes reproduced three failures: `downloadTo` left a partial destination,
a failed replacement destroyed a previous complete file, and `SourceResolver`
retained a rejected promise so an explicit later resolve could not recover.
The new regression file failed all three cases before the production fix.

## Change

- Shared streamed downloads and buffered writes now stage in a unique directory
  beside the destination and rename only after the write completes. This keeps
  rename on the same filesystem and preserves an existing destination on failure.
- Cleanup is best effort and restricted to that write's staging directory.
  Concurrent writers do not share a partial-file name.
- The resolver still coalesces requests, bounds concurrency, reuses successful
  files, and passes local files through. It removes a failed promise so a later
  explicit resolve can retry. There is no new automatic retry or paid dispatch.
- Opt-in transfer deadlines, output bytes, quality settings, and module ownership
  are unchanged. Downloads remain streamed rather than buffered in memory.

## Verification

Network-isolated loopback tests exercise interrupted response bodies, old-file
preservation, explicit recovery, request coalescing, cross-resolver cache reuse,
local passthrough, concurrent buffered writes, and failed-rename cleanup.

```sh
unshare --net node /tmp/studio-offline-readiness.mjs --test \
  src/lib/__tests__/atomicMediaFiles.test.ts \
  src/lib/__tests__/novitaDurableDelivery.test.ts \
  src/lib/assembly/__tests__/renderTimeline.test.ts \
  src/lib/assembly/__tests__/rigor.test.ts \
  src/lib/assembly/__tests__/cinematicHandoff.test.ts \
  src/lib/assembly/__tests__/planTimeline.test.ts
```

All six files passed (nine Node test results). Assembly orchestration tests use
their existing fake backend; this is not a new video quality qualification.
`npm run build` passed, including TypeScript, with retained output at
`/tmp/studio-atomic-media-build.log`. `npm run lint` exited successfully with
zero errors and 31 warnings outside the changed files.
No thumbnail tests, generation, GPU work, or production deployment were performed.

## Boundaries

Atomic publication prevents newly failed writes from becoming reusable artifacts.
It does not validate historical cached files, detect a server successfully sending
semantically invalid media, or provide an fsync/power-loss durability guarantee.
An abruptly killed process can leave its unique staging directory, but not a
partially published final path. Normal run-directory cleanup owns such leftovers.
Replacing an existing file temporarily requires space for both old and new bytes.
No measured provider-bill saving is claimed.
