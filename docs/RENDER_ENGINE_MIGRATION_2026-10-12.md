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
The managed API returned 404 for that workspace. Qwen narration, native Fish
narration/casting, and Music3 now use the owned managed workspace in this branch;
YuE2, other speech and other music lanes still need their own explicit migrations.
These source changes are not yet a deployed or fully qualified Studio release.

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

The authenticated `inspect` command rechecked these states during the casting
integration on 12 October and returned the same readiness table. It made no
model request, GPU reservation, or scheduling change.

## Registered project-specific Comfy reference workflow

The live managed API registered `studio-ernie-character-reference-v1` as workflow
`jn7fzvqf2nn087rhwtvhq75hjn8g4qx6` in the Studio-owned bucket. It returned
`executionReady: true` and `modelFilesVerified: false`: the native executor is
qualified, but each future job still checks its physical model seal and capacity.
No GPU or new persistent disk was allocated by this registration.

The actual twelve-node graph was compiled through Engine's current specification
and ERNIE executor compilers before upload. It retains the native enhancer,
attested enhanced prompt, four pinned model paths on existing filesystem 3975,
50 steps, CFG 4, BF16, and 896x1200 reference geometry. It does not replace
Z-Image landscape stills, thumbnails, or native H3 footage.

Immutable pins are in `src/engine/studioErnieComfyProfile.ts`. The operator command
`prepare-reference-comfy` registers/replays that exact profile and reads back its
complete specification, owned source bucket, source hash, effective graph hash,
settings, readiness, and capability. Changed model bindings/settings are rejected
even when hash labels agree. Comfy hashing preserves Engine's lexical numeric
node-ID ordering, independently from ordinary Studio request canonicalization.

This is a live workspace/workflow registration, not a generated-image quality
claim. Reference rendering and its consuming module remain to be connected.

## Native Fish new-channel casting

New-channel inception can select `fish` using an explicitly imported
`fishEngineReference` and `fishVoiceMetadata` (name, category, labels, optional
description). Reference metadata is an operator-declared fit score, never a
listened audition. The real native cold-open must pass the existing local
performance gate; final narration retains its independent source/quality gates.

The saved cast contains its reference and verified Engine receipt. Reuse binds
the exact reference hash/transcript, cold-open text, locally measured MP3 hash,
owned R2 receipt, immutable profile, and settled usage. Metadata/local measurements
without the native receipt cannot qualify a Fish cast. Convex now accepts that
receipt as a separate variant without reinterpreting legacy Qwen evidence.

Fish has no native rate control. Inception rejects explicit non-native rates and
wires `ttsSpeed: 1`, the actual narration parameter, rather than an ignored
`speed` field. Whiteboard's ElevenLabs-only audio contract remains incompatible
with a Fish cast. No implicit replacement voice or time-stretch is introduced.
Provider-start and receipt checkpoints fence casting against ambiguous retries.

New-channel design now seals its existing ElevenLabs casting default whenever
provider advice is nonbinding. Previously an unset provider was cast as ElevenLabs
but reserved as native Fish, making the standard business-channel inception test
exceed the unchanged $10 narration ceiling ($11.79). The fix aligns producer,
caster, and budget without lowering reservations, shortening output, raising the
cap, changing established channels, or replacing an explicitly selected provider.

This is functional source integration, not native Fish speech qualification.
No synthetic storage-test signal was used as a narrator and no paid model test
was submitted. Scheduling remains disabled.

## Managed H3 staging and readback

H3 staging, repair and materialization now use the fixed public managed API and
`RENDER_MANAGEMENT_API_KEY`, not the private Convex origin/project capability.
The live owned workflow `jn74f2wpbeb3v01p8j51v6m6k58g49nt` is pinned to revision
`ae37ff63af37c524f5dc620bc2c89616bd2dd9f3ebf7de634056f091f7fb18cf`.
Registration started no GPU and allocated no persistent disk.

Frozen batch admission is now connected before scene binding/upload/staging.
Managed staged receipts use v3 and a separate `.engine-h3-managed-v3-staged.json`
key. Legacy v1/v2 receipts and their stored assets remain separate; the managed
materializer refuses to relabel them. Shared source/model request digests stay
sealed, input uploads verify exact bytes/hash, R2 transfers prohibit redirects,
and scene readback requires the exact owned bucket/prefix. Metadata and video
reads are bounded. Every scene must be independently verified before transfer;
the complete ordered scene set is checked again before writing the final sidecar.

Engine's source binding now accepts the explicit managed alias while retaining
the original legacy name and the same source owner/frozen-handoff checks. Its
scoped publication changed one action and verified all 818 live module hashes.
Both project-binding environment values were read back; no budgets, model
controllers, schedules or provider/storage allocations changed.

This is source integration plus live workflow/source configuration, not a new
H3 output-quality qualification. The existing staging geometry/native profile
boundary described below still needs physical output validation before rollout.
The fresh-channel launch proof and native Z-Image execution remain unfinished.

## Remaining launch gates

1. Move H3/still staging from the older project capability to the owned managed
   workspace and register/verify the real project-specific visual workflows.
2. Resolve YuE2's score/precision handoff and qualify current native music/Fish
   routes without substituting models or raising approved budgets.
3. Deploy the complete validated Studio/Convex/Trigger revision and verify the
   exact production alias, then create a fresh channel through the cooperating
   modules and inspect its retained final output against its channel identity.
4. Keep publishing and scheduling inactive until separately authorized.

### Visual contract findings

The current shared still renderer remains `renderImages` in
`src/lib/novitaRenderFarm.ts`; it rejects new Novita generation before its old
direct-fleet code. Weekly image preparation also rejects that route. Engine
already has the exact `studio-zimage-turbo` Final contract (same Z-Image revision,
9 steps, CFG 0, BF16; production 1920x1088, hero 2048x1152), but its executor is
held and `/client/studio-zimage-batches` is not in the managed-operation allowlist.
That native route needs public API exposure and genuine executor completion.

Update: the public managed API now exposes `studio-zimage-batches`, Studio batch
admission/scene binding, and H3 scene-batch intake/readback/output. Authenticated
invalid requests to the exact Vercel public alias returned 400; requests without
credentials returned 401. No probe created a job or GPU. Studio registered
`studio-zimage-turbo-final` as `jn739qpstjjme9afp2zw3a07dh8g580s`, with the exact
Z-Image profile digest above. The SDK validates paired production/hero geometry,
candidate count/identity, unsigned seed, independent negative prompt, workflow
ownership and native request digest before accepting a staging receipt.
`prepare-zimage` registers/replays that workflow; `stage-zimage REQUEST_JSON`
saves its immutable admission and observes the same job on replay. A held state
is reported as staged, never as successfully rendered imagery. Scene rendering,
candidate readback/QA, and the producer-module replacement remain unfinished.

Shared Studio H3 generation is the 1344x768, 124-frame, 24-fps Turbo8 profile.
The older weekly scene-batch client uses private `/client/h3-scene-batches`
endpoints and a different 1280x736/5-second staging request. Those endpoints and
the Studio batch admission/scene-binding endpoints are not exposed by the current
managed-operation allowlist. Their external Studio source reader is additionally
bound to `STUDIO_BATCH_PROJECT_NAME`, not a general arbitrary-project reader.
The newer native FL2VA contract has distinct Base/BF16/50-step identity. Migration
must explicitly reconcile those model/profile and timing boundaries; substituting
the ready ERNIE/Qwen image route or another H3 variant would not preserve the
approved contract. The registered portrait Comfy workflow does not solve these
landscape/video boundaries by itself.

### Current validation evidence

The focused Fish/casting/readiness tests, channel-inception contract test, routing
test, TypeScript, scoped ESLint, and full 64-page production build pass.
The broader module-contract suite still fails its default-budget coverage check:
`narrated_stock` declares a $2 creator floor while its correctly sealed default
pipeline reserves $3.5282. That floor was not raised and the test was not weakened.
Budget admission must remain honest; this mismatch is a remaining launch gate,
not evidence that a channel was successfully rendered or deployed.

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
example. No model/GPU job ran. Fish casting still requires migration and genuine
reference/voice quality acceptance.

The real `synthNarration` Fish path now uses the registered S2 Pro Engine
workflow; its hosted Fish POST and local 429 retries were removed. It requires
`fishEngineReference` with the exact imported object key, SHA256 and transcript.
Voice identity is `engine-fish:<reference-sha256>`. Hosted voice IDs are not
equivalent, and non-native speaking-rate requests are rejected before submission.
Text, reference transcript, seed, scope and profile revision bind the request.

Completion verifies current owned native WAV bytes and settled usage, then
delivers 192 kbps/44.1 kHz mono MP3. Qwen retains 160 kbps/24 kHz. Fish receipts
keep native R2 and encoded output identities separate, without inventing a
hosted bill or quality grade. Pending, ambiguous, incomplete-billing and
over-budget outcomes retain the original job for reconciliation, never automatic
repurchase. Narration runs forward their lease/run scope, retain take receipts
in R2 and deduplicate costs. Weekly preparation forwards its manifest scope and
uses native usage. Failed receipt writes cannot double-count an accepted take.

Run ceilings remain enforced. Native reservation estimates follow the existing
conservative Qwen envelope rather than retired hosted Fish character pricing;
this is not an Engine-enforced cap or measured economics. Fixture responses with
actual FFmpeg encoding, identity/tampering, unsupported controls, usage and
recovery checks pass. Qwen, runtime accounting, weekly narration, typechecking,
lint and production build pass. Studio production was not released by this
source change. Fish casting and live speech acceptance remain unfinished, and
Engine last reported Fish executor readiness false. Legacy channel records and
generation schedules were not changed.

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

## Measured H3 media and assembly timing

The managed H3 completion bridge now counts decoded frames with bounded
ffprobe execution on the actual hash-verified MP4, before copying that clip.
It checks the admitted 1280x736 H.264/24fps contract and the five-second
acceptance window (114-126 frames), rejecting decode errors and incompatible
media. Receipts retain measured frame counts and durations, bound to output
SHA-256; scene boundaries accumulate those measured durations. They no longer
borrow the legacy Turbo profile's fixed 124-frame duration.

New `youtube-studio-render` footage requires that media evidence and exact
timeline consistency. Historical `youtube-studio-ai` receipts keep their old
validation, so this change does not rewrite legacy pipelines or evidence.
CPU-generated MP4 fixtures exercise 120/124 frames, wrong geometry/frame rate,
short/corrupt output, cleanup, receipt tampering, and rejection before a clip
write. This is physical-media validation, not model-output quality acceptance.

The broad module contract check still fails: the narrated-stock creator budget
is below its compiled default reservation. No budget was raised, pricing
understated, or quality requirement removed to hide that failure. Still-image
execution and the remaining native music/speech qualification work are not
complete. Scheduling remains disabled; this integration branch is not live.

## Shared scored-music Engine source

The current shared `music` module is now version 4.0.0-yue2-engine-candidate.
It submits the composer-owned accepted ABC and retained channel context to
the isolated youtube-studio-render workflow, with explicit OpenRelay RTX 3090,
cost and execution-window constraints. Five channel-family/playback selections
compile with the new version; existing explicitly pinned pipelines are not
rewritten. Historical v3 candidates remain readable, but v3 cannot generate.

The durable bridge retains one admission, actual Engine usage, all six hashed
native sidecars and original 48 kHz stereo FLOAT WAV in private project R2.
Recovery observes the same job, never a substitute or legacy supervisor.
Authorization is checked before execution, evidence writes and candidate
publication. A linear attenuation-only derivative may supply listening
headroom; original source bytes and exact frame count remain retained.
Review and approved assembly consume either verified historical sources or
this new immutable source. Musical quality still needs audition; technical
success cannot grant production approval or claim a verified provider invoice.

Focused source/module/selection/assembly checks use real FFmpeg/ffprobe and
mocked provider/storage transports. They do not qualify GPU generation or
channel personality. The Engine scored-source backend release and a genuine
new-channel render remain required. No schedule or paid render was started.

OpenRelay provider invoices remain unknown after shutdown, so its existing
usage.complete is deliberately false. Music now also understands the Engine's
separate, physically stopped allocation receipt, debiting the full reservation
against the existing budget with engine-reservation-debit as its explicit
basis. Review labels this Reserved budget debit, never a final provider bill.
An incomplete allocation still cannot publish a source candidate. The actual
Engine job-reader test preserves unknown invoice usage, and the real Studio
adapter fixture exercises incomplete billing plus stopped reservation recovery.

## Verified Current Status (13 October 2026)

This section supersedes earlier readiness snapshots in this document. It is a
read-only assessment; no provider resource, production alias, schedule, or
customer pipeline was changed.

- Studio production is still the healthy `5033ba839d1e6fc76a6626d448fbb7d6384f55c5`
  deployment. The migration branch is 34 commits ahead at
  `ad698ce10a35106fff719127ad95f69eb42ef68e` and has a READY protected preview.
  Same-project authenticated preview checks returned `/api/health` `ok: true`
  with this exact revision and `/channels` HTTP 200; signed-in owner UI
  acceptance was not performed.
  The Render Engine YuE2 integration is a
  READY preview at `fa730d38b212d5287d1eda57cbdb80208eff27c7`; Engine production
  is `d770f377481eb6cb2422366df3f492d1374d6e60`. The integration branch is three
  production commits behind and must absorb the current production baseline
  before it can be considered release-ready.
- The authenticated Engine inspection confirmed the isolated project
  `youtube-studio-render` and output bucket `re-youtube-studio-render-p2w18g596q`.
  H3 and Qwen3 TTS have qualified routes. YuE2 accepts the request contract but
  has no qualified route: RunPod is only model-installed, and OpenRelay lacks
  exact model-storage, persistent-runtime, and provider-final-qualification
  evidence. This does not establish that an RTX 3090 is unavailable; it does
  establish that this project cannot currently submit a qualified YuE2 job.
  Music3, Fish, image/upscale and reconstruction routes likewise include
  model-installed or prepared states that are not final qualification.
- The latest recorded portrait Comfy reference readback (12 October) was
  `executionReady: true` with `modelFilesVerified: false`; it was not re-read
  in this assessment. Registration and an accepting API are not proof of a
  model-backed image. No retained output from a complete new-channel render has
  yet been qualified.
- YuE2's private candidate review, owner audition, exact-source approval and
  guarded assembly handoff are implemented. The focused selection, assembly,
  music-source and Engine-client tests pass, but the new candidate has not been
  generated or auditioned on a qualified provider. No thumbnail-generation
  tests or Nano Banana Pro requests were made.
- The module-contract test's static version resolver was corrected to follow
  aliased imported string constants while retaining exact version resolution.
  The test now reaches the real existing failure: `narrated_stock` defaults to
  a `$3.5282` compiler reservation while its creator floor is `$2`. Neither
  value nor the assertion was changed. This remains an admission/release gate.
- The separately named `studio-render-engine-migration-20261012` Vercel project
  has no Git link, deployments, ignored-build command, or build-queue setting.
  It is not the release target. The existing `youtube-studio-ai` project remains
  Git-linked and has its ignored-build guard and `WAIT_FOR_NAMESPACE_QUEUE`;
  its production alias has not been advanced to this migration.

TypeScript passes. The bounded eight-file Node test run passed 12 of 13 suites;
the remaining failure is the unchanged `narrated_stock` budget mismatch above.
The migration is not ready for production or a complete fresh-channel quality
claim. Keep schedules, publishing and production aliases unchanged. Next, bring
the Engine integration branch to the current production base, resolve the
approved storage/runtime qualification for the exact YuE2 route within the
provider disk cap, then produce and owner-audition one retained new-channel
output before final deployment qualification.
