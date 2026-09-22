# Preserve explicit music choices across design transport

The supervised designer selector exposed a downstream transport defect:
`DesignChannelArgs` inherited `yue2Music`, but the task's actual `designOptions`
projection omitted it. Separately, the public build endpoint projected unknown
design fields away before strict preview validation. A submitted source choice
could therefore disappear while a legacy preview still passed validation.

The task now forwards the exact selection into the real designer/compiler.
The read-only web projection retains the selection so its strict schema rejects
it explicitly. This intentionally does not import Trigger/Remotion executable
implementations into the lightweight Vercel preview. Browser admission is still
unsupported; this change neither enables automatic YuE2 production nor creates
a new spend or approval authority. Legacy requests omit the field as before.

Verification:

- `yue2DesignTransport.test.ts` parses and executes the actual worker options
  projection, then runs the real designer/compiler for music-loop, sleep,
  Shorts and narrated-stock families. It checks exact source version, seed-bound
  fingerprints, unqualified production status, and unchanged legacy preview
  availability. HTTP is forbidden throughout.
- The authenticated `build-channel/route.test.ts` submits an otherwise exact
  legacy preview with a YuE2 field, including malformed null/false values.
  The real route rejects it at preview validation before dispatch or the later
  budget check. Removing the projection fix makes this regression fail.
- Existing YuE2 selection, web preview and creator-boundary tests are retained.

This fixes silent selection loss, not the outstanding natural-duration musical
fidelity issue. No channel records, runtime credentials, GPU state, thumbnails,
or production deployments are changed.
