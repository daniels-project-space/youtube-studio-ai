# Whiteboard changed-plan cache preservation — 9 September 2026

## Result and scope

This is a narrow correction in `src/lib/whiteboardSync.ts`, exercised by
`src/lib/__tests__/whiteboardChangedPlanCache.test.ts`. No provider adapter,
receipt ABI, artifact ID, durable claim, deployment or publication policy changes.
No paid calls or production artifacts were used or changed. Root owns the
subsequent graph refresh, independent review and any release.

The main agent subsequently reviewed the complete runtime/test diff and reran
the real-caller regression independently: exit 0, evidence at
`/tmp/ysa-whiteboard-cache-main-review.log`. The isolated release and exact
deployment status are recorded below; this is not whole-video qualification.

Previously, changing only an approved storyboard's title deleted every indexed
art file and cached narration/alignment, but retained the art receipts. The next
real `castWhiteboardSync` invocation failed because the receipt existed without
its paid image. Deleting receipts too would erase evidence, not repair the cause.

## Exact dependency comparison

The cache comparison and the live image call now share
`whiteboardLayerArtRequest`. For each art layer it retains the existing index ID,
the exact `whiteboardArtPrompt` inputs (resolved style, width >= 0.32 SCENE/SKETCH
classification, role, drawing direction, cue and normalized panel narration),
the existing negative prompt and the original filename-derived seed. Audio
depends on the final bounded panel narration joined in order.

The old plan's whitespace and indices are normalized as the renderer already
does. **New truncation bounds are not applied to the old plan**, which would
hide a changed request. The new plan first passes the existing narration bounds
and Golden-style checks. Comparison happens before replacing the frozen plan.

- Title/header changes, label text/colour and equivalent placement changes retain
  normal legacy attested cache reuse. Narration and alignment survive when the
  spoken input is unchanged.
- Crossing the width threshold, changing draw/cue/narration, or shifting indexed
  art positions is not a render-only change.
- If generation inputs differ while cached art, receipts or audio exist, the
  invocation preserves all files and refuses before new generation or plan
  writes. A cache without its frozen plan also refuses before planning.
- Existing missing-receipt, receipt-without-bytes and corrupt-art checks remain.
  No cache sidecars, parallel pending journal or receipt-deletion workaround was
  introduced. This change deletes no cached files.

## Evidence

Evidence directory: `/tmp/ysa-whiteboard-cache-review-rzDf0J`.

| Evidence | Result |
| --- | --- |
| `failing-before.log` | Real caller: title-only revision deletes four PNGs, leaves four receipts, throws `receipt but no local bytes`; zero new image submissions. |
| `retained-baseline-request-parity.log` | Repeats the failure against the retained pre-change source in `/tmp/ysa-run-edl-release-K3f1ZG/repo`; expected exit 1. |
| `final-regression.log` | Current caller passes title-only, equivalent label/placement/whitespace, cached retry, changed draw/narration/cue, threshold crossing, index insertion, out-of-order cues, target reduction, missing plan, orphan receipt, missing receipt and corrupt art cases. |
| `focused-suite.log` | Eleven existing focused attestation, file-format, prompt-grounding, approved-plan, Golden, ceiling, text-cue, receipt-entrypoint, critique-seam, board-bounds and Novita-wiring scripts pass. |
| `eslint.log` | Both changed TypeScript files pass. |
| `typecheck.log` | `tsc --noEmit --incremental false` exits 0 with no diagnostics. No full test suite was run. |

Fresh request bytes match the actual retained pre-change caller: sorted request
array SHA-256 is
`888cd25eda4e8799b7587c215a5abf3bde0e6a1e2add183b7d7a0afd52a980a9`.
Unchanged retries submit no new image requests. Refusal tests compare every
file's bytes, `mtimeNs` and `ctimeNs`, proving no paid-cache/frozen-plan writes.

Re-run the focused regression from the repository root:

```sh
./node_modules/.bin/tsx src/lib/__tests__/whiteboardChangedPlanCache.test.ts
```

The harness executes the actual caller, filesystem cache, image receipt/geometry
checks, narration bounds and Golden gate. Only external process/provider
boundaries are fixtures. It reaches the narration boundary or, with retained
audio/alignment fixtures, the final Python-render boundary. It does not claim
new paid-image quality, completed-footage qualification or deployed success.

## Isolated release qualification

Revision `c2aed58e8eced4af4cbfb9b4d30a441ae1d0e2dc`, parent `01c35ac`,
contains only the two source/test files and this initial review document.
The frozen checkout is `/tmp/ysa-whiteboard-release-hvQLzL/repo`.

- All641 direct production-readiness tests pass, including the existing actual
  full-panel Whiteboard render test: `/tmp/ysa-whiteboard-release-direct-tests.log`.
- Non-incremental typecheck, complete production build, lint (zero errors,
  33 existing warnings) and all unchanged audit baselines pass. Logs use the
  `/tmp/ysa-whiteboard-release-` prefix and `typecheck`, `build`, `lint`, `audit`.
- Actual local assembly completes at31.021995 seconds with no warnings;
  `/tmp/ysa-whiteboard-release-assembly.log`. No provider credentials are used.
- Non-force main push succeeded. Vercel automatically deployed the exact Git
  revision as `dpl_FcE1UidPzKaQi6GcTkgZLmhnvaVk`, READY, production alias
  `youtube-studio-ai.vercel.app` assigned. Canonical `/api/health` matches.
- Real production media proof passes desktop, phone and200% text on that
  exact revision, before and after checks: three actual audio/video controls,
  caption HTTP200, one consolidated query, no overflow/runtime errors.
  Results/screenshots: `/tmp/ysa-run-media-layout-5pXlto/`; root inspected decoded
  master frames and mobile layout. Retained legacy media is not quality-approved.

Cloud CI `34405053924` completed successfully. The canonical Convex deployment
finished at21:20:49UTC; Trigger version `20260909.27` reached terminal deployment
success at21:22:52UTC. Worker `worker_cmtultvwnfpm00wol4bepokqp`, content hash
`fec860ea2e4e020cab5fd50c9bf15dd5`. The complete cloud job log is retained at
`/tmp/ysa-whiteboard-release-cloud-deploy.log`. Production checks were read-only;
no paid Whiteboard job, publishing or storage mutation was triggered. Worker
deployment plus local actual-caller/render proof is not a new paid cloud render.

## Still open

This is **not** selective regeneration of changed paid art. A real generation
revision remains blocked until an explicit per-artifact revision mechanism is
integrated with existing durable provider claims and recovery. It must preserve
prior receipts, distinguish confirmed completion from unknown paid outcomes,
and reuse only independently bound unchanged assets.

Legacy plans do not persist the original brief/provider identity or canonical
provider request. Cross-brief, model/profile and prompt-version cache provenance
therefore remains unbound; the comparison does not claim to solve it. Existing
provider-outcome recovery is unchanged. Genuine generation changes are held,
not silently bought again or described as a successful paid repair.
