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
The managed API returned 404 for that workspace. Music and speech still have
direct-provider request/receipt contracts; those are not migrated by merely
changing an endpoint URL.

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

## Next acceptance steps

1. Connect Engine request and artifact receipts to the existing music, narration
   and image/video module consumers, retaining channel direction and quality gates.
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
