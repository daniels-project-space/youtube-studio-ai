# Studio Render Engine migration

## Delivery priority

Finish integration and qualify complete new-channel creation with retained,
high-quality output. Keep scheduling disabled. Preserve each channel's creative
requirements and explicit module responsibility. Thumbnail rendering is excluded
from this migration; Nano Banana Pro is not authorized for tests.

This does not complete or replace the original additive module/backlog objective.

## Current source and production

The current production web health reports
`5033ba839d1e6fc76a6626d448fbb7d6384f55c5`, from
`fix/youtube-manual-h3-release-20261005`. Migration work is based on that revision
in `/root/worktrees/studio-render-engine-migration-20261012`. The older checkout
and its uncommitted Qwen/Runpod changes were preserved.

Existing Studio source has Engine batch/H3/still staging and verified footage
materialization, but it uses the older `youtube-studio-ai` project capability.
The managed API returned 404 for that workspace. Qwen narration and Music3 now
use the owned managed workspace; YuE2, other speech and other music lanes still
need their own explicit migrations.

## Owned Engine workspace

The authenticated managed API created `youtube-studio-render` and reported ready.
Its requesting-project output bucket is `re-youtube-studio-render-p2w18g596q`.
Integration and model-storage GETs returned 200. Four named native audio
workflows were actually registered, with their returned IDs and immutable
profile revisions in `src/lib/studioRenderEngineWorkflows.ts`.

Live model-storage assessment on 12 October:

| Profile | API Accepts Requests | Executor Ready |
| --- | --- | --- |
| MiniMax H3 | yes | yes |
| ERNIE image | yes | yes |
| ERNIE image turbo | yes | yes |
| Qwen image 2.1 | yes | yes |
| Qwen3 TTS | yes | yes |
| MiniMax Music3 | yes | no |
| YuE2 | yes | no |
| Fish S2 Pro | yes | no |
| FlashVSR | yes | no |
| WorldMirror | yes | no |

These are the Engine's reported states, not proof of a Studio output. GPU
availability is resolved by Engine during dispatch; Studio must observe the
same accepted job rather than choose another provider or submission key.

The current Qwen public request is restricted to English/Ryan, 4000 text
characters, at most 120 seconds, 24 kHz mono WAV. A different channel voice or
language must be reported as unsupported until an appropriate Engine contract
exists; it must not silently be replaced. YuE2 exposes lyrics/style and FLAC,
while Studio's existing composed source carries an explicit instrumental score
and native-float evidence. The score/precision handoff needs resolution before
replacing that module or declaring music quality accepted.

## Implemented execution handoff

`studioRenderEngineClient.ts` uses only the public managed API, a fixed owned
project, and registered native workflows. It bounds responses, refuses redirects,
redacts transport errors, and preserves ambiguous submission identity.

`studioRenderEngineAudio.ts` accepts an immutable request, persists its admission
through a caller hook, checks current execution authority, observes one job,
and provides a caller-supplied checkpointed wait. Saved admissions bind the
complete original input hash. Completion requires matching workflow/profile and
request digest, exact owned R2 receipt, full downloaded hash/size, requested
audio format, and a second current completion observation. Signed capabilities
are not persisted. Finished audio is not written to VPS storage.

YuE2 completion additionally requires all six native sidecars: `score.abc`,
`semantic.npy`, `latent.npy`, `request.json`, `config.json` and `result.json`.
Each is bound to the primary output's job prefix, expected media type and size
limit, and its independently signed `If-Match` read; each full byte hash is
verified. Those artifacts do not include a float WAV and do not resolve the
frozen-score input gap by themselves.

The operator CLI is a real consumer:

```sh
ai-vault render-engine MANAGEMENT_API_TOKEN=RENDER_MANAGEMENT_API_KEY -- \
  node_modules/.bin/tsx scripts/studio-render-engine.ts inspect
```

Other explicit commands are `prepare-audio MODEL`, `observe JOB_ID`,
`render-audio REQUEST_JSON`, and `register-comfy SPEC_JSON`. Rendering persists
a metadata-only `.engine-admission.json` recovery record next to its frozen
request; rerunning observes that saved job. The command itself is manual render
authority. Production pipeline callers must supply their active execution lease.

Custom Comfy registration uploads the exact graph to this project's immutable
R2 namespace, passes approved library model bindings, settings and optional LoRAs,
then verifies specification readback. It preserves `executionReady: false` when
reported. No fabricated production Comfy graph or custom executor was registered.
The native model workflows remain separate from Comfy executor qualification.

## Connected Qwen narration module

The real `synthQwenNarration` entry point now submits only to the owned Engine
workflow. Pipeline narration forwards its active paid-execution lease and a
channel/run-scoped immutable identity; prepared weekly narration uses its sealed
manifest identity. Trigger waits checkpoint rather than hold a polling worker.
The old direct-worker POST and OpenRelay startup dependency were removed from
new Qwen synthesis. Historical receipts remain verifiable offline.

The adapter verifies the native R2 WAV and settled Engine usage, parses its
actual 24 kHz mono sample frames, and produces the existing 160 kbps MP3 format
using FFmpeg. Private seekable encoding scratch is deleted in `finally`.
Native R2 provenance and local transformation are recorded separately; a worker
image or raw transport attestation is not fabricated. Reused Engine job costs
are counted once in source/preflight evidence. Incomplete billing, changed
completion, ambiguous admission or exceeded stage envelopes stop advancement
and retain the accepted job identity for reconciliation.

The public API's optional legacy `maxCostUsd` field is not an enforced spend
cap. Studio does not send it or claim a provider-enforced limit: this adapter
checks settled usage against the existing stage envelope after execution.

Casting admits only the presently supported English/Ryan pair for new Qwen
requests. Existing voice metadata and retained casts are preserved. Per-take
auditions, transcript/source QA and channel direction remain required; configured
Engine admission is not a quality acceptance result. The Convex receipt union
must be released before the new production Trigger writer. Runtime credential
access and live model output have not yet been qualified in this branch.

Focused lifecycle tests use fixture API responses, real WAV bytes and actual
FFmpeg encoding. Casting, source provenance, retained legacy receipts, bootstrap,
prepared narration and source-QA wiring tests passed, as did TypeScript checking.
These are integration contracts, not a live model or complete-channel test.

## Next acceptance steps

Fish S2 Pro cannot consume the old hosted Fish voice IDs. It needs actual owned
reference audio and a transcript. A separate Engine API patch, based on release
`d1a0e94b` in `/root/worktrees/engine-studio-voice-reference-upload-20261012`, adds
immutable voice-reference upload and verification endpoints plus OpenAPI shapes.
It preserves the requesting-project bucket, uses create-only PUT and conditional
GET, verifies full SHA256 and actual PCM16 frames, and allocates no GPU/storage
volume. Engine release `717a47b3` is now live through an additive overlay against
the actual deployed 815-module baseline, not a full push of the old checkout.
Post-publication hashes verified all 826 modules; schema/root and 812 unrelated
modules stayed exact. Public integration guidance exposes both new endpoints.

Studio's `import-voice-reference SOURCE_JSON` operator command reads a consented
local WAV and uses those endpoints. Its source JSON needs `audioPath` and
`consentConfirmed: true`. The client validates 1-30 seconds of 44.1 kHz mono
PCM16 before upload, checks the exact owned key/bucket and signed headers,
verifies fresh or existing immutable objects, and returns only durable metadata.
It never stores temporary capabilities. Transcript accuracy, voice identity,
rights evidence and musical/speech quality remain casting/QA responsibilities.
No real voice was imported or certified by these fixture checks. The explicit
live smoke command `scripts/test-studio-voice-reference-live.ts --live` additionally
verified owned R2 upload and full-byte readback of a synthetic signal, then
immutable reuse with PUT statuses 200/412. Its receipt SHA256 is
`d9a973f35fcb8db925635592b20f32c7e7bb4b88c62dd063d6caa2e4bf00543f`;
176444 bytes, 88200 frames, two seconds, 44.1 kHz mono PCM16. That private object
is storage qualification evidence, not a registered voice or speech quality
example. No model/GPU job ran. Fish generation and casting consumers still
require migration and genuine reference/voice quality acceptance.

Music3's real shared-module generation entry point now uses its registered
owned Engine workflow. Its direct Novita worker POST, output fetch and worker
URL/token readiness dependency were removed. Archived Comfy receipts remain
readable without reviving that generation lane. New receipts preserve native
R2 provenance, program/caption/instrumental-control hashes, actual WAV duration,
settled usage and the immutable native BF16 profile. The same model revision
is retained, but native BF16 is not represented as the former Comfy FP16 graph.
Explicit old CFG/top-k controls are rejected before submission, not ignored.

The production caller forwards its active execution lease and owner/channel/run
scope. Technical analysis, rejected-take evidence, bounded musical repair,
per-song auditions, prepared-source checks and publishing disclosure remain
in place. License safeguards remain required. New Engine qualification requires
`MINIMAX_MUSIC3_ENGINE_QUALITY_QUALIFIED` and its separate receipt hash; historical
Comfy qualification cannot open this route. Those controls were not enabled by
this migration. Engine still reports Music3 executor readiness false, and no
live Music3 sound or new-channel quality acceptance is claimed.

Fixture tests exercise the actual generation entry point, owned output bytes,
settled and incomplete accounting, tampering, unsupported controls and ambiguous
admission. Source-direction, audition/disclosure and prepared-reuse checks pass.

1. Finish connecting Engine request and artifact receipts to the remaining music,
   speech and image/video consumers, retaining channel direction and quality gates.
2. Resolve required scored YuE2 and speech voice contracts through Engine. Only
   remove a legacy generation path after its replacement is verified.
3. Build the project's required real Comfy profiles from supported nodes/model
   mounts and verify their exact executor/output contracts where custom graphs
   are needed. Registration alone cannot satisfy this step.
4. Run a complete fresh channel build through architect, declared modules,
   real renders, assembly, metadata and thumbnail. Inspect the retained output,
   repair specific failures, and verify the resulting production UI/API.
5. Release the validated integration through the current Git deployment flow.
   Leave channel status paused and all generation schedules disabled.

No paid render was started during this assessment/connection checkpoint. No GPU
or persistent model disk was provisioned. Nine focused lifecycle/ownership
checks, TypeScript and scoped lint passed; no full output
or production migration qualification is claimed.
