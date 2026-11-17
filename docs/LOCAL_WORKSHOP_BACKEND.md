# Local Studio workshop backend

The isolated workshop backend listens only on `127.0.0.1:39420`, with its
HTTP actions on `39421` and public signing keys on `39440`. Its root-only
credentials are in `/etc/youtube-studio-workshop`, and its database is in
`/var/lib/youtube-studio-workshop/backend`. The services are
`youtube-studio-workshop-convex` and `youtube-studio-workshop-jwks`.

Install a new instance with `python3 scripts/provision-local-workshop.py
--install`. The installer refuses existing paths and checks the pinned backend
binary. `--resume-empty-install` is restricted to the early failure case where
only empty, root-owned private configuration directories exist. Deploy this
checkout's backend with `python3 scripts/deploy-local-workshop-backend.py
--deploy`. Install this checkout's dependencies with `corepack pnpm install
--frozen-lockfile` first. On 17 November the lockfile installation succeeded
from the local package cache and backend deployment succeeded using this
checkout's own toolchain.

On 17 November 2026, a signed service query confirmed that the workshop's
owner namespace contained no channels, while the separate Automation database
retained 13. Anonymous requests and both directions of cross-project JWT use
were rejected. The checks were repeated after restarting the workshop database.
No personal channel records were copied. This establishes the basic boundary;
it does not prove durable workshop drafts, background tasks, a working UI, or
a pipeline release handoff.

The private workshop web service runs on `127.0.0.1:39462` as
`youtube-studio-workshop-web`. Its standalone build at revision `0bc57f32`
connects to the local workshop backend. A real browser check verified the
password gate, rejection of an incorrect password, the separate HTTP-only
session cookie, and a local Convex WebSocket. The workshop password was
reconciled to Project Hub Vault as `youtube-studio-ai/LOCAL_WEB_PASSWORD` and
read back successfully; the temporary bootstrap copy was removed.

The private interface now opens the workshop draft editor. Drafts and their
selected formats persist in the separate database. The compatibility check
uses the actual registered modules and production compiler; it does not prove
provider readiness, execute a trial, or approve a release. The workshop worker,
trials, release handoff and rollback are not yet connected.

The local Trigger service hosts a separate Studio project. Its database relay
is `youtube-studio-workshop-relay`, and its scoped storage broker is
`youtube-studio-workshop-r2`. The broker mints short-lived credentials limited
to the existing `youtube-studio-ai-private` bucket; its protected issuer
credential never enters the worker. A read-only check verified access to that
bucket and rejection by the Automation bucket. Existing bucket lifecycle and
media have not been changed. Studio's bucket currently has multipart cleanup
but no diagnostic-object expiry; establish a scoped lifecycle rule before
writing disposable diagnostic artifacts.

Studio worker deployment `20261117.2` completed a read-only task against its
own local database and scoped R2 bucket and enforced excluded-model policies.
An Automation Trigger credential was denied access to a Studio run, and the
shared local Trigger service had zero schedules. This is connectivity evidence,
not a pipeline trial or render qualification. The CLI emitted a skill-discovery
warning; this checkout declares no `defineSkill` tasks. Use
`node scripts/deploy-local-workshop-worker.cjs` to deploy and
`node scripts/probe-local-workshop-worker.mjs` to run the read-only check.

The workshop's HRS project is separately onboarded with output prefix
`projects/youtube-studio-workshop/` in the Studio bucket. Its scoped credential
was verified and reconciled to `youtube-studio-ai/HRS_YOUTUBE_PROJECT_TOKEN`.
Onboarding and identity checks submitted no render job and did not change the
paid worker. A real Qwen or video output remains unverified.

For subsequent web releases, build the current committed checkout with
`NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:39420 YOUTUBE_WORKSHOP_STANDALONE=1
node_modules/.bin/next build`, then run `python3
scripts/release-local-workshop-web.py --release` as root. The release script
completes missing pnpm package links inside the standalone artifact, verifies
link containment and retains the previous release for rollback.
