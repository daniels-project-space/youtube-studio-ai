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
session cookie, and a local Convex WebSocket. The credential's bootstrap copy
remains root-only at `/etc/youtube-studio-workshop/web-password-bootstrap.env`
because the Project Hub vault bridge currently rejects authentication; it
must be reconciled and read back before removing that bootstrap copy.

The interface currently opens the inherited Golden module catalog and still
contains legacy navigation and catalog status labels. The workshop worker,
trials, draft lifecycle, release handoff and rollback are not yet connected;
the catalog must not be interpreted as evidence that a module can run locally.
