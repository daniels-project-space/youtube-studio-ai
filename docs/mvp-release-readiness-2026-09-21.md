# MVP release readiness: 2026-09-21

This is a deployment observation and integration repair record, not completion
of the full module-first MVP goal or approval of the retained music.

## Live observations

Read-only provider checks made against the existing project:

- Vercel production deployment `dpl_GNrYbQ4FcfX4rCGnWbL3vYxzVGWg` is READY.
  Its production alias `https://youtube-studio-ai.vercel.app/api/health`
  returned HTTP 200, `Cache-Control: no-store, max-age=0`, and revision
  `722facc4f5aaad004dcd9f96de3be7a29951a520`.
- Vercel preview `dpl_DG7QFNojBLVyzvop3S5z9Dq2tJ2J` was READY at
  `0f69d0ccbfd6b1fc7a2f8d117a1e8b82ed840d18`. There were 103 branch commits
  after production before this integration repair. Preview readiness does not
  prove runtime or authenticated review functionality.
- Authenticated `convex function-spec --deployment astute-camel-689` returned
  403 function definitions and zero YuE2 matches. The canonical live backend
  has not received the new audition, continuation or release-source queries.
- Two matching Trigger schedule inventories verified the six individual
  recovery crons in production environment `cmpu4i98gfghqn70jp33s1diz` at
  `2026-09-21T22:38:20.730Z`. The shared recovery schedule is not active.
  Verified one-minute cadence implies 259,200 scheduled starts per 30 days;
  one shared schedule would imply 43,200. This is not measured billing savings.
- Vercel environment metadata shows production-only owner/session/operator,
  vault access and public Convex URL settings; the signing key is present in
  both preview and production. Values were not printed or changed. A ready
  preview must not be assumed to have production authentication configuration.

No provider configuration, production alias, channel pipeline, owner approval,
GPU state or publishing state was changed by these checks.

## Integration repairs

An isolated 860-file readiness sweep (30 thumbnail-named files excluded) found
three failing fixtures. A separate narration preflight check also identified
a missing fixture for the newly introduced authority query.

- Narration QA now performs its existing local scenario admission before the
  source-authority database read. Its narration test explicitly models the
  legacy non-YuE2 authority response and rejects any unrelated Convex call.
- Same-run dispatch tests retain worker/version/idempotency assertions while
  accounting for the separate bounded YuE2 checkpoint-store preparation call.
- Cinematic binding tests inspect the actual assembly factory and assert the
  default legacy export calls that factory without opt-in overrides.
- The motion-comic process fixture now returns ffprobe clock fields and emits
  stdout correctly. The test verifies actual measured normalization dispatch,
  retained 48 kHz audio, exact 1.7-second fixture duration and video stream copy.

No failed assertion was removed to turn a missing behavior into a pass.
The source-authority checks and independent publishing gates remain intact.

Final verification: all 860 selected readiness files passed in a fresh
network-isolated sweep after the final code edit; 30 thumbnail-named files were
excluded. Production build, TypeScript, scoped ESLint and structural audits
passed. No structural audit regressed; inert-produced-artifact findings fell
from the committed baseline of 69 to 68. The code graph was refreshed. Logs:
`/tmp/youtube-studio-readiness-release-final.log` and
`/tmp/youtube-studio-release-audit.log`. These local logs and the partial gate
are not evidence of production rollout or musical approval.

## Test isolation incident

The initial sweep was stopped to disable external networking. The first
network-namespace wrapper incorrectly forwarded CLI arguments and selected the
full suite. It was stopped, but four thumbnail-named UI/contract tests had
already passed: libraryReviewedThumbnailOverlay, thumbnailRefreshInventoryUiContracts,
thumbnailRefreshPreviewState.contract and thumbnailRefreshPreviewBatch.contract.
No thumbnail generation occurred. This was an exclusion error, not intentional
thumbnail work. The corrected wrapper executes the script as a child with
explicit `--exclude-thumbnail`; subsequent sweeps report 860 selected files
and all 30 filename exclusions. Network isolation retains loopback for local
fixture servers and forbids external provider access.

## Release order still required

1. The frozen non-thumbnail readiness sweep is complete and passing. It remains
   a partial gate, not a substitute for complete production readiness.
2. Resolve the explicit owner instruction to skip thumbnail tests against the
   unchanged release CI that includes those regressions. Do not silently weaken
   the CI gate or promote a work branch around its current-main policy.
3. Deploy canonical Convex first using the repository's documented
   `convex dev --once` target. Do not substitute the empty production backend.
4. Verify authenticated current-source queries, then deploy the pinned Trigger
   production worker with protected environment values preserved. Old frozen
   runs must retain their original worker binding.
5. Verify the exact production web alias and authenticated review flow. A Git
   push, READY preview or successful CLI command alone does not prove this.
6. Enable shared recovery only after its live inventory and delivery behavior
   are verified. Keep automatic generation/publishing disabled unless separately
   authorized; do not rewrite legacy channel pipelines.

Musical approval, live owner-approved continuation, eight-hour/4K qualification
and the remaining full module-quality scope are still incomplete.
