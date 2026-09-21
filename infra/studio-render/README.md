# YouTube Studio isolated render build

This builds Studio's existing H3 API contract with its own pinned ComfyUI
installation. It does not borrow Book Forge or Lito's image, Python environment,
custom nodes, writable model cache, request queue, or receipts. It does not
change the existing OpenRelay A100 fallback or legacy channel pipelines.

From a clean, committed Studio checkout:

```sh
node scripts/studio-render-build.mjs build
node --test scripts/__tests__/studio-render-build.test.mjs
```

The builder creates independent detached worktrees for Studio and the pinned
renderer source `42faf114e1088f8ff10369f02095f9ec82493b4d`. Each build attempt has
a separate curated Docker context and JSON receipt under
`/var/lib/youtube-studio-render/builds/<studio-revision>/`. Only the H3 worker,
common worker utilities, exact model/profile manifests, and Studio Dockerfile
enter the context. No environment files, graph output, media, or weights enter.

The image has an app-owned tag, OCI source/revision labels, ComfyUI commit
`f938505952476e48a12687eac696cdc94d48a3fe`, and retained Python dependency inventory
at `/opt/youtube-studio/python-freeze.txt`. The build receipt records the actual
local image ID; this is not a registry digest or proof of a deployed image.
Release labels follow dependency layers so unrelated Studio commits can reuse
those expensive layers. Other projects' Docker cache/images are never pruned.

## Disk boundaries

| Purpose | Studio-owned host directory | Container path |
| --- | --- | --- |
| Verified H3 weights and local manifest | `/var/lib/youtube-studio-render/volumes/h3/models` | `/models` |
| Input cache and completion receipts | `/var/lib/youtube-studio-render/volumes/h3/state` | `/workspace/youtube-studio/h3` |

Mount these directories only into this Studio worker. The model directory is
writable because the existing hydrator locks and maintains its verification
receipt there. It must never be a shared writable model mount. Another lane
(YuE2, Qwen, LTX, or a future ComfyUI control route) needs its own worktree,
image, volume subtree, and qualification; none uses this lane's mutable state.
Directory and worktree symlinks are refused by the builder.

The image performs GPU admission and checksum-gated cache verification before
starting its API. `MODEL_CACHE_MODE=preseeded-only` and offline Hugging Face
settings prevent a customer render from downloading models. Populate and
verify the exact five-file H3 pack using the existing operator staging path;
`scripts/build-openrelay-h3-bootstrap-manifest.ts` produces the hash-bound
verification manifest and a separate sensitive, short-lived bootstrap manifest.
Never commit or include the signed bootstrap URLs in an image.

This image retains the RTX 5090 profile. It is not a drop-in replacement for
the legacy A100 VM image: hardware admission deliberately rejects that swap.
No GPU lifecycle command is part of this builder. Provider credentials stay in
the control plane; worker tokens must be injected at runtime, not baked in.

## Verification boundary

Every successful build executes `smoke.py` against the actual container API,
with networking disabled, read-only root, no Linux capabilities, and ephemeral
test state. It verifies the Comfy pin, unauthenticated denial, authenticated
GET-only receipt recovery, drain behavior, and an honest not-ready response for
an empty model cache. It never renders an image or thumbnail.

The receipt deliberately keeps `gpuQualified` and `modelCacheVerified` false.
An image build/API smoke pass cannot prove GPU inference, warm-cache integrity,
output quality, provider deployment, or production activation.

## Credential and volume discovery: 21 September 2026

Canonical `openrelay/OPENRELAY_API_KEY` passed `/v1/whoami` with HTTP 200 for
organization `626c2959-4f58-4779-b867-2a74129e93e5`. The stale Studio copy returned
401; it was replaced from the canonical vault record and independently read
back and tested with HTTP 200. Lito's rejected copy was not changed. This
supersedes the earlier conclusion that no available OpenRelay key worked.
Never copy a key into this document, a build receipt, or the worker image.

Read-only live inventory found eight stopped VMs. Studio-owned retained disks:

| VM | Capacity GB | Provider-reported used bytes |
| --- | ---: | ---: |
| `yt-minimax-h3-a100-persistent` | 150 | 68,665,212,928 |
| `yt-minimax-h3-a100-fallback` | 100 | 65,957,593,088 |
| `yt-qwen3-tts-3090-primary` | 30 | 26,302,087,168 |

These are populated disks, not missing infrastructure. All three reported SSH
offline while stopped. Disk usage does not attest individual file hashes or
runtime health. No VM was restarted, resized, deleted, or moved between apps
by this build/discovery operation.
