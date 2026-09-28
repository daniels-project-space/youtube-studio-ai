# Module-first runtime release: 2026-09-22

## Follow-up: music review privacy and decision authority

Deployed application revision `e2cfb5025a2ea8ea860d8662e91fa1e1dddb8e1b`,
Trigger `20260922.2`, verified at 16:00 UTC. Full CI passed all 931 direct test
files and deployed both cloud runtimes:
https://github.com/daniels-project-space/youtube-studio-ai/actions/runs/35749433713

Live inspection found that `/api/music-audition-checkpoints?runId=invalid.id`
returned raw Convex argument-validation internals with a public cache policy.
The corrected route rejects malformed IDs before database access, uses private
no-store responses on every path, sanitizes dependency errors, and requires an
owner session for human audition decisions, matching the YuE2 route. It does not
change legacy generation, retained audio or technical-quality requirements.

Production checks after deployment:

- Anonymous GET: 401, `Authentication required`, private no-store.
- Authenticated malformed-ID GET: 400, `Invalid runId`, private no-store.
- Service-token POST with empty body: 403, `Owner session required`, private
  no-store. No approval/rejection mutation was attempted by this check.
- Web and Trigger exact revision checks passed; canonical Convex still exposes
  all required contracts and shared schedule inventory remains one active cron.

Focused tests additionally cover dependency-error redaction, malformed JSON,
null/array bodies, foreign-origin requests, empty reviews and owner rejection.
No human musical decision or end-to-end music output qualification is claimed.
Logs: `/tmp/studio-review-release-35749433713-complete.log` and
`/tmp/studio-deployment-observation-e2cfb502.json`.

## Deployed revision

- Application revision: `7d1fb61a07b7ce2104ee4b8c725d9a4232c72c25`.
- Full main CI and both cloud deployment steps succeeded:
  https://github.com/daniels-project-space/youtube-studio-ai/actions/runs/35746407761
- All 930 direct readiness test files passed, including thumbnail regressions.
  TypeScript, lint, production dependency audit, Python worker contracts,
  assembly smoke, structural audits and defect proof gate also passed.
- No live Nano Banana Pro request was made. The owner authorized thumbnail tests
  but explicitly excluded that provider/model.
- Real-render assembly parity passed five essay scenarios (captions on/off,
  intro/outro cards, hard-cut and dip-to-black title transitions), reporting
  identical outputs. This ran on `fc93a768`; the only subsequent code change
  increased one test file's wall-clock allowance, not application behavior:
  https://github.com/daniels-project-space/youtube-studio-ai/actions/runs/35744552170

## Release-gate repairs

- Lazy-load YuE2 native inspection inside its audio mastering helper, avoiding
  an unnecessary import-time process dependency for legacy ffmpeg consumers.
- Make the durable-download fetch double reject an already-aborted signal,
  matching real fetch. Test both stalled bodies and pre-expired deadlines.
- Give `repeatedMusicBlackGate.test.ts` 360 seconds for its two separately
  bounded 120-second renders plus comparison scans. Other files remain at
  180 seconds. Both real-render cases passed locally in 79 seconds; the full
  cloud gate subsequently passed. No assertions, render precision or release
  thresholds were weakened.

## Live verification

Observed 2026-09-22 15:38-15:39 UTC using the read-only deployment verifier:

- `https://youtube-studio-ai.vercel.app/api/health` returned the exact deployed
  revision and a no-store response.
- Canonical Convex `astute-camel-689` exposed 419 functions, including all eight
  required YuE2 function contracts. CI deployed it at 15:32:48 UTC. Function
  presence alone does not attest an implementation revision.
- Trigger production version `20260922.1` was DEPLOYED, clean, with the exact
  application revision.
- `STUDIO_DELIVERY_RECOVERY_MODE=shared` was written and read back in the Studio
  production environment only. Old workers did not consume this setting and
  continued servicing their schedules until the deployment transition.
- Two consistent inventory observations found one active shared recovery cron
  and zero of the six individual recovery crons. Thumbnail and GPU reaper
  schedules were not changed.
- Three naturally scheduled shared runs completed on `20260922.1`:
  `run_06gcjgnjn2h49v7iqf7se2r501`, `run_06gcjgvcveso49kh64eleq7g01`, and
  `run_06gcjh60kfrndhc5m35khqvv01`.
- The last run's output reported successful checks for bundle, factual, music,
  reviewed-data-story, route-qualification and serialized-episode queues. All
  were empty and zero child deliveries were triggered. This verifies idle
  execution, not loaded delivery latency or an approved music continuation.

Configured recovery starts per 30 days fell from 259,200 to 43,200: 216,000 fewer
(83.3%). These are cadence estimates, not measured billing savings; the underlying
queue reads still occur. No claim that the entire MVP is production-qualified.

## Remaining qualification

- The refreshed YuE2 GPU runtime is not yet deployed or qualified on the retained
  RTX 3090. VM restart and dedicated-key creation returned permission errors.
  A credential-free diagnostic request was sent to official OpenRelay support;
  no reply was present when checked. No new paid GPU window was started.
- Native audio still requires musical/personality audition and the existing
  approval gate. No human approval was fabricated or publishing enabled.
- Nonempty recovery delivery, eight-hour 4K output and full channel-quality
  acceptance remain separate checks. Legacy channel configurations were left
  unchanged.

Local operator logs: `/tmp/studio-main-release-35746407761-complete.log`,
`/tmp/studio-assembly-parity-35744552170.log`, and
`/tmp/studio-deployment-observation-7d1fb61a.json` (the last includes npm preamble).
