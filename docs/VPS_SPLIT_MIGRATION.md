# VPS split migration map

Status: design and local safety changes in progress. Neither VPS-first app nor
the release handoff is operational yet. The existing cloud deployment and the
older VPS site remain the current services; do not transfer their traffic or
data on the strength of this document.

## Ownership

| Concern | Current source | Target owner | Migration boundary |
| --- | --- | --- | --- |
| Channel identity, pipeline, configuration and locks | `convex/channels.ts`, `convex/schema.ts` | YouTube Automation | Preserve each channel and snapshot its selected settings; do not bulk apply an upgrade. |
| Runs, stages, invocation snapshots and video library | `convex/runs.ts`, `convex/videos.ts`, `src/engine/runner.ts`, `src/trigger/runPipeline.ts` | YouTube Automation | Preserve run and artifact identity, leases, retry and cost records; validate import counts and hashes. |
| YouTube connections, publish intents and approvals | `convex/youtubeAuth.ts`, `convex/publishIntents.ts`, `src/lib/publishDispatcher.ts` | YouTube Automation | Isolate credentials; reconcile connector identity and preserve manual release gates. |
| Module catalog, design, compiler and candidate evaluations | `src/engine/moduleCatalog.ts`, `src/engine/pipelineCompiler.ts`, `src/trigger/designChannelInception.ts` | YouTube Studio AI | Separate personal channel records from candidate data; do not write live Automation channels. |
| Executable blocks and artifact contracts | `src/engine/registry.ts`, `src/engine/moduleContracts.ts`, `src/trigger/blocks/` | Versioned execution component | Retain exact executable build and dependencies for every approved release; never resolve an unpinned default as immutable. |
| Final media and receipt | `src/lib/storage.ts` | Requesting project | Output to its R2 bucket and verify object hash and receipt; local disk is bounded scratch only. |
| Project navigation | Project Hub `src/lib/apps.ts`, `src/lib/app-icons.tsx`, `convex/projects.ts` | Project Hub | Two verified VPS links and distinct entries; app catalog and project records are separate. |

## Local runtime selection

The current UI and workers directly use Convex and Trigger. Select and qualify
self-hosted implementations or local replacements before moving real data.
Convex's self-hosted backend can preserve its existing query model. Trigger's
documented self-hosted v4 lacks cloud checkpointed waits; worker occupancy,
child tasks, idempotency, version pinning and recovery need real qualification
under this app's long-running workload before choosing it. Measure VPS memory,
disk and concurrency; do not share or disturb another project's database.

On 17 November 2026 an isolated, disposable self-hosted Trigger 4.5.9 stack
was started on loopback with its own database, secrets, networks, registry,
test project and worker. Synthetic tasks ran through the actual local service:
a parent awaited a child, a transient failure retried successfully, and two
requests with the same idempotency key returned the same run. Those behaviors
also passed on a locally built and deployed staging worker after its API
origin was changed from host loopback to the private container address. The
second synthetic project received its own staging credential, which could not
read the first project's run (HTTP 404). This checks one access boundary on a
shared test service, not the required independent app databases or identities.
The local development worker canceled an in-flight test when killed. A deployed
worker killed during a wait remained marked executing without a running
container for roughly five minutes, then retried the same run and completed
on attempt two. A completed run and its idempotency mapping survived restarts
of both the test database and web service, and fresh parent/child/retry work
completed afterward. A failed staging run cleared its Trigger idempotency key;
submitting the same request again created another run. Trigger idempotency
alone is therefore not a paid-work fence: the app's durable invocation and
provider claims remain essential. This synthetic proof does not qualify the
actual pipeline, its paid-stage recovery or long waits.

The disposable stack used about 2.4 GiB across its running services at one
observation, plus build and task containers; disk free fell from approximately
48 to 42 GiB while images and a test build were downloaded. These are point
measurements, not a production capacity or cost forecast. The supplied stack
started its supervisor before its bootstrap token existed; starting that test
supervisor after the web service initialized resolved the ordering problem.
The host's existing Buildx 0.12.1 lacked an option required by the current CLI,
so the test used a separately installed, checksum-verified Buildx and a unique
builder instead of modifying the shared one. The test configuration and data
are under `/var/tmp/youtube-trigger-qualification-20261117` and isolated Docker
resources prefixed `youtube-trigger-qual` / `yta-qual`; they are not either
finished application's data or service configuration. After qualification the
idle test services and its separate builder were stopped, with their volumes,
configuration and synthetic records retained. No production schedules or
publishing were enabled by this test.

On 17 November 2026 the cached official Convex backend binary
`precompiled-2026-10-22-1447815` passed a disposable localhost qualification:
a synthetic function was deployed, a record was written and read, and the
same record survived a backend restart. Run `scripts/qualify-local-convex.py`
with `--backend` pointing to the binary to repeat it. This does not prove the
Studio schema, real authentication, import, production recovery, backup or
capacity. The official GHCR image registry returned HTTP 403 from this VPS;
the binary is an evaluated alternative, not an image deployment.

Studio's signing code and Convex authentication configuration now accept
deployment-specific `STUDIO_CONVEX_ISSUER`, `STUDIO_CONVEX_JWKS_URL`, and
`STUDIO_CONVEX_AUDIENCE` values, while retaining the existing production
defaults. Use distinct issuer, audience and signing keys for each project and
set matching values in its app and backend. Never expose the private key.
The local configuration and signed-token behavior have unit evidence only;
real backend verification and private owner authentication remain required.

Follow-up on 17 November 2026: the full Automation Convex schema and functions
were deployed to a disposable loopback backend from an isolated source copy.
The real Studio signer produced a service JWT accepted for its own owner;
anonymous and cross-owner queries and channel mutations were refused. A real
channel mutation created one synthetic draft, and the channel survived a
backend restart. Repeat with `scripts/qualify-local-studio-convex.py --backend
<absolute-binary-path>` (Python `cryptography` is required). The proof removes
its temporary data and uses a throwaway key. It does not authenticate a human,
import actual channels, deploy a persistent service, or run a video job.

The two apps need independent state and service credentials. Import a verified
snapshot to the Automation instance only after establishing an idempotent,
reversible mapping and checking channel, run, connector and artifact counts.
Never copy cloud credentials into a client bundle or source repository. Keep
the original system authoritative until private local end-to-end evidence and
the transition have been reviewed.

On 17 November 2026 an owner-scoped read-only capture retrieved 13 channels
and four connector status records, using the production Trigger environment's
service identity and cross-checking the deployment URL against the Hub Vault.
The protected local snapshot is
`/var/lib/youtube-automation/baselines/channels-2026-11-17T13-28-06-834Z.json`
(root-owned, mode 0600; SHA-256
`4183f97434de9ae89fcef1e89e20d735df3c1c895fb9ee67368c3af8dda7464e`).
Independent readback matched the source channel and connector status records.
Every channel was paused, and every stored pipeline entry was unversioned.
The two source queries are separate, not an atomic database snapshot. This is
configuration and connector metadata only: it does not contain connector
secrets, run history or media, and it does not freeze executable worker builds.
Do not import these records by calling `channels.createChannel` with its
current arguments. The 13 captured records include fields that mutation does
not accept or persist: `schedule` (13), `thumbnailPlaybook` (7),
`scriptPlaybook` (4), `folder` (2), `youtubeCreated` (3), and
`architectReport` (5). It is also an upsert that may patch an existing slug.
A dedicated migration must preserve the original settings and source identity,
map references explicitly, prevent unintended overwrites, keep every imported
schedule disabled, and verify readback against the captured records. Connector
metadata alone is not a working YouTube connection.

The local `channelImport:importBaseline` mutation and
`scripts/import-channel-baseline.ts` now provide that channel-record path. The
mutation requires an owner-bound service identity and the explicit backend
setting `YOUTUBE_LOCAL_IMPORT_ENABLED=1`; it refuses a nonempty destination,
preserves the original channel records in a receipt, translates group IDs,
and atomically imports paused channels with disabled schedules. The command
accepts only a private, hash-verified baseline file and a loopback backend,
then compares each imported record with the expected paused copy. Replays of
the same baseline are non-mutating; different baselines are rejected.

The disposable real-backend qualification imported all 13 captured channel
records, compared all fields and translated groups, restarted the backend,
and verified both persistence and import-command replay. It also tested
cross-owner rejection and conflicting-baseline rejection using synthetic
records. The temporary qualification backend was removed after testing.
Connector secrets, history, media and retained executable pipeline releases
still need separate migration and verification.
Use `scripts/capture-channel-baselines.ts --capture` with the Vault-injected
production Trigger key, project ref and expected Convex URL to capture again.
The production Trigger schedules API returned zero schedules at the same
inspection. This is not proof about other scheduling systems or future state.

On 17 November 2026 a dedicated, supervised Automation Convex backend and
loopback-only signing-key endpoint were installed as
`youtube-automation-convex.service` and `youtube-automation-jwks.service`.
Their data is in `/var/lib/youtube-automation/backend`; private configuration
is under `/etc/youtube-automation` and runtime binaries under
`/opt/youtube-automation`. The backend listens on 127.0.0.1:39320, HTTP
actions on 39321, and the public-key endpoint on 39340. The pinned Convex
binary SHA-256 is `044eedfe569b1550d5003683aec7fceb4dcee3f82abf00ab9baf1c10d3ca0b4c`.
The qualified startup shim keeps the instance secret out of the process command
line and removes the shim and secret from the application environment. It
depends on the pinned binary and libc; requalify startup, authentication and
restart before changing either. Its source and install/deploy instructions are
`scripts/convex-secret-launch.c`, `scripts/provision-local-automation.py` and
`scripts/deploy-local-automation-backend.py`. Secrets are root-only.

A fresh read-only source capture at 14:40 UTC matched all prior channel and
connector metadata records. Its protected snapshot is
`/var/lib/youtube-automation/baselines/channels-2026-11-17T14-40-59-294Z.json`
(SHA-256 `4dd8fe9684a24e01ec9466a9a34ffc1e9266d1445a33c35aced225b6b4556ef2`).
All 13 channels were imported into the dedicated local database, with every
setting verified against the paused copy and group IDs translated. The local
records remained unchanged after a backend restart; the import switch was
removed afterward. This is a private data migration, not a working UI, worker,
upload connection or active release. The source remains authoritative.

The source snapshot at
`/var/lib/youtube-automation/baselines/channels-2026-11-17T14-51-34-676Z.json`
(SHA-256 `6c2e4f4d245d26bcbef7940188f1fa7ceec46f223f6754587c5ebc8ac7cb6596`)
also captures the one channel room, which contains two channels. The earlier
channel-only import had preserved their room names but omitted the room row,
making those channels unreachable from the room navigation. The separate
`scripts/import-channel-folders.ts` command restored the verified room without
changing any channel. Its real-backend qualification included replay without
duplicates. In a temporary loopback-only browser proof, all 11 standalone
channels and both room members were reachable using the local Convex WebSocket.
The proof used an artificially issued owner session, not a working owner login.

The VPS build command produces a standalone package. Private Automation mode
requires an owner session, disables the legacy anonymous viewer token and adds
a local password sign-in. An isolated browser proof verified anonymous denial,
wrong-password rejection, owner login and access to all 13 channels through the
local WebSocket. The owner password is stored as `LOCAL_WEB_PASSWORD` in the
`youtube-automation` Project Hub Vault service; the local web process receives
only its scrypt verifier. The proof used a separate disposable password.

`scripts/provision-local-web-auth.py` creates the private local web identity;
`scripts/install-local-automation-web.py` installs a clean standalone build as
a non-root, loopback-only systemd service. After a clean standalone build,
`scripts/release-local-automation-web.py --release` installs a separate,
root-owned release and restores the predecessor if its startup checks fail.
The authenticated browser flow must still be checked after a release.
On 17 November 2026 the private
`youtube-automation-web.service` was installed and enabled at
`http://127.0.0.1:39362`, running as `youtubeautomation`. The previous build
`ad60301eb4cb3967bc4c11519ee25db4223eb6aa` is retained for rollback. On 17
November 2026 the live build was updated to `e583b6bcc6b2d0b91f62f8ceb0570b754bf0b5ad`.
A browser using the actual
Vault-backed owner password verified anonymous token denial, wrong-password
rejection, owner login, all 13 channels and the local backend WebSocket. The
same proof passed after restarting both web and database services. This is a
loopback address on the VPS, not a remotely accessible link. The build embeds a loopback
backend address and is not a remotely usable release. Before any public routing,
configure TLS and a trusted reverse proxy, provide an external backend address,
add durable proxy-level login throttling, and verify every route's authorization.
The in-process login throttle alone is not a public deployment boundary.
For direct VPS access, `YTA_LOCAL_WEB_ORIGIN` binds state-changing requests to
the exact configured loopback origin and Host header. Remote access will need a
separate, explicitly configured trusted-origin design.
The interface now has the local Automation job-project credentials. An
authenticated browser retrieved a completed local worker safety-probe run
through `/api/build-channel`; anonymous token access remained denied. This is
not yet proof of a video generation flow. An authenticated read of the local
publish-intent list also succeeded using the local vault snapshot and local
database secret. Google/YouTube sign-in remains
unqualified.

The saved pipelines passed the current structural flow compiler without
adding or removing blocks; policy completion left their stored entries and
parameters unchanged. This does not verify runtime configuration, worker
availability, duration, audio quality or actual video output.

The read-only `scripts/audit-channel-narration.ts` check materializes the
saved channel module controls and applies Automation's new preflight. Six
channels with `narration_tts` require an explicit Qwen provider. Chalk &
Compound's `whiteboard_scribe` selects Fish/ElevenLabs, while Inked Histories'
`motion_comic` invokes ElevenLabs dialogue; neither has a qualified Qwen path
yet. The other five captured pipelines have none of these inspected blocks;
that is not a provider or output readiness claim. Automation now rejects these
unqualified narration paths before running pipeline blocks. Saved channels
and selected voices are not silently rewritten. Qwen integration for the
specialist modules and channel-level voice selection remain required work.
The local whiteboard code now rejects an explicit unsupported provider or an
ElevenLabs selection without its voice instead of silently substituting Fish.
It binds newly cached narration to its requested text, provider, voice, speed,
and audio bytes. Existing unbound audio is preserved and requires review; the
local cache receipt is not independent proof of its source. The compiler now
reserves the conservative Qwen rate for a Qwen request, but actual Qwen
execution, provider evidence, and output quality are not yet implemented or
qualified for this module. HRS does not currently report per-job Qwen cost.
The separate `plan-week-prepared-narration` task is not covered by the
`run-pipeline` preflight and still accepts non-Qwen providers. Its existing
prepared-narration sidecar does not carry provider provenance; it needs its
own fail-closed admission and a migration-safe receipt before that path can be
declared Qwen-only. Do not enable that preparation flow as an Automation
shortcut until it is fixed and verified.

## Release handoff

Studio AI creates a candidate containing its ordered modules, exact executable
versions, settings, capability contracts, policy version, worker build digest
and test evidence. Automation validates that the named build is available and
compatible and requires an explicit channel-specific approval before it can
activate the candidate. Keep the previous executable build for rollback. A
failed validation must not fall back to the current default implementation.

Local changes in this worktree make the Doctor's fleet sync and legacy sync
entry points preview-only, and make the architect task proposal-only. They are
not yet a persisted release registry, approval UI, installed worker build or
complete protection against every possible direct channel write.

## Outstanding proof

Establish two independent VPS apps and data stores; qualify the selected local
job runner and authenticated UI; verify the import; implement the release
handoff and rollback; then generate and inspect one private existing-channel
video and its R2 receipt. Validate Project Hub links and readiness from the
actual interface. Public publishing and scheduling remain gated.

## Local job service

`scripts/provision-local-automation-trigger.py --install` installs a dedicated
self-hosted Trigger stack using the pinned manifests under `deploy/local-trigger`.
It refuses to overwrite existing installations or use an overlapping Docker
network. Credentials are generated into root-only files; the dashboard listens
on VPS loopback and the private worker bridge, and the image registry listens
on loopback. A separate, bounded relay exposes the local
Automation database only to its private worker subnet. The service owns its
volumes and retains them when stopped. Provisioning does not deploy tasks,
enable schedules, or connect the dashboard to the web app.

The local deployment guard requires an explicit local project, local service
endpoint, private worker database address, and database signing identity. The
two local job projects are separate identities; this alone does not establish
separate Studio AI application data or release handoff. On 17 November 2026,
the Automation project deployed its real worker locally with 75 registered
tasks. Its `convex-auth-probe` task verified signed local database access and
unsigned denial. The local job service had zero schedules at that point. This
project's credentials could read the probe run, while the Studio AI project's
credentials received a not-found response for that same run. This does not
prove video generation or publishing readiness. The web app is connected to
the local worker, but individual legacy controls still require qualification.
Do not copy credentials into the repository or use
the legacy cloud project as a fallback. Trigger's local deploy defaults to a
builder named `trigger`; explicitly select the dedicated
`youtube-automation-trigger` builder to avoid using another project's builder.

The local worker runs with `YOUTUBE_AUTOMATION_PRIVATE=1`. Its YouTube upload
boundary rejects public, unlisted and scheduled uploads, and its social
cross-post boundary rejects posts, unless publication has been explicitly
enabled. Private drafts remain permitted. The deployed `automation-safety-probe`
verified these decisions without opening a file or contacting a provider; both
the generation and publishing scheduler tasks also returned disabled, and the
local service had no schedules. This does not cover arbitrary direct calls to
external APIs or prove the rest of the publishing approval flow.
While private review mode is in effect, the channel-settings API also refuses
new public/scheduled or cross-post approvals before modifying channel policy or
pipeline settings, so the interface cannot report an approval the worker will
reject.
The actual private interface rejected same-owner public, scheduled and
cross-post approval requests with HTTP 409, rejected a cross-origin request,
and left the tested channel's pipeline and publishing policy unchanged.

Private Automation can load a curated secret snapshot from the root-only
`/etc/youtube-automation/local-vault.json` through `YTA_LOCAL_VAULT_JSON`.
The runtime files carry it as `uri:` followed by URI-encoded JSON, and the
worker marks it secret. In private mode a missing or malformed service fails
locally rather than contacting the managed Hub database. On this VPS the
snapshot currently covers the independent local internal-query secret and
selected OpenRouter, Pexels and Pixabay credentials. It does not yet configure
Qwen, YouTube OAuth or all other pipeline providers. A Hub
credential rotation must be followed by a deliberate snapshot refresh and
runtime update; a vault connection alone does not update this copy. The
deployed Automation safety probe confirmed local access to the internal and
OpenRouter settings without returning values. A separate authenticated local
database query accepted the new internal secret and rejected an incorrect one.

## Automation storage

The dedicated `youtube-automation` R2 bucket has seven-day cleanup for
incomplete multipart uploads and for `diagnostics/` and the dedicated
`owner/owner_daniel/diagnostics/` test prefix. Other
objects, including finished output, do not have an expiry rule. A root-owned
broker runs as its own systemd dynamic user and receives its parent credential
through a systemd credential file. The web and worker receive only a separate
broker bearer token; the broker issues temporary object credentials scoped to
this bucket. The Automation storage client refuses to fall back to an
account-wide R2 credential in private mode. A live scoped write/read/hash test,
cross-bucket denial, anonymous broker denial, byte-range read and short signed
URL expiry passed. An authenticated browser also used the live app's media
signing API and fetched a test-object range; anonymous signing was denied. The
deployed worker wrote and read a diagnostic object through the broker and
verified its hash without receiving a parent R2 key. An actual browser could read a byte range from the exact
private interface origin; a different origin was rejected. The bucket CORS
policy currently allows only that loopback origin and read operations, so a
future remote interface needs its own reviewed origin and access test. The
diagnostic objects are subject to the verified expiry.

`scripts/provision-local-r2-broker.py --install` installs the broker after the
bucket and lifecycle have been established, with `YTA_PARENT_TOKEN`,
`YTA_PARENT_ID`, and `YTA_ACCOUNT` supplied through the authorized vault
bridge. `/etc/youtube-automation/r2-broker.json` and both runtime environment
files remain root-only. Parent-key rotation requires updating that file and
restarting the broker; existing temporary credentials expire independently.
These checks do not prove a final video, its render receipt, or a Studio AI
storage boundary.
The bucket currently contains only small disposable qualification objects;
their actual billed usage has not been measured. No subscription or spending
limit was changed. The account-wide parent credential is not readable by the
web service account and is not forwarded to the worker.
