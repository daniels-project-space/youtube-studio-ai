# Source-performance prompt comparison: prepared, not executed

## Question

The retained Seaside request specified a 30-second, ten-bar score at 80 BPM but
produced 142.4386667 seconds of native audio. Its style also said `Playback:
repeat.` Assembly, not source generation, owns final-video repetition.

This is a hypothesis to test, not an established explanation. The prepared
comparison keeps the ABC, seed 42, requested duration, natural-loop policy,
personal-use acknowledgement and runtime quality pins unchanged. Only that
style sentence becomes:

> Performance: play the supplied score once, then finish with its written cadence. Repetition for the final video is handled separately.

Baseline job:
`yue2-eval-cb3b5e41babd7634f0b40ebc8ed278297874394b6b6a09052d73291c667fb813`

Prepared diagnostic job:
`yue2-eval-b98ec675a4a3f82a3d73a7d11636795f5b2681cdfb8a0d4eddf5d4e3d3785f99`

Unchanged ABC SHA-256:
`d55583ffc39cdd5a1ce4ae2e87a36a9af579c098a93647b7c2aa84421be8d37d`

The raw diagnostic is not an accepted composer arrangement, durable Studio
candidate or review approval. Existing requests and production prompts were not
modified. Even a shorter output would require listening and musical-fidelity
review, not automatic acceptance.

## Live Provider Evidence

On 22 September 2026, the vault-backed key authenticated through `/v1/whoami`
for organization `626c2959-4f58-4779-b867-2a74129e93e5`, reporting
`clusters:read`, `vms:read`, and `vms:write`. The retained RTX 3090 VM
`29e245a2-2e1a-431e-b5b3-654cf0ba1587` remained stopped.

Two bounded restart requests returned HTTP 403, `FORBIDDEN`, with the second
response explicitly saying `not permitted for this organization`:

- `0ddc161d-e999-435c-8bf1-fdcebccf62f0`
- `c6ee2dce-eedb-462a-9b26-0ed9d9ba2ec1`

The [documented restart endpoint](https://docs.openrelay.inc/docs/vms/restartVm)
was used. No alternate identity, exposed historical key, replacement VM or
permission bypass was attempted. Read access and reported scope labels do not
prove current write authorization. This is not evidence of inadequate funding
or unavailable GPU capacity.

The provider again confirmed `stopped` at `2026-09-22T02:29:17.598Z`; SSH also
reported no running VM. Burn metadata still reported 18 cents/hour and
`diskBilled: false`. No new job was submitted and no inference result exists.
Both the comparison guard and Studio tunnel are inactive.

## Reproduction State

- Local diagnostic request and comparison metadata:
  `/var/lib/youtube-studio-render/operator/source-ownership-comparison-20260922/`.
- Operator script:
  `/var/lib/youtube-studio-render/operator/compare-source-ownership.mjs`.
- Current-source CPU validation passed using `PYTHONPATH=src` and
  `.venv-test/bin/python`. The environment's installed package is older and must
  not substitute for the current runtime source during validation.
- The independent systemd guard needed explicit `HOME=/root`,
  `XDG_RUNTIME_DIR=/run/user/0`, and the trusted executable PATH for vault access.
  Its first failed startup was corrected and verified active before restart was
  attempted; no secrets were copied into the unit definition.
- Conservative reservations are now 63 cents of the approved $1, including the
  unused five-cent comparison window. This is not an invoice or a claim that
  those five cents were spent.

Resume only after rechecking current provider authorization, budget, manifest,
execution policy and independent shutdown guard. The expired window is not
restart authority. Check for an existing submission before any POST; a lost
response must be recovered by job ID, never retried as new inference.

The musical timing question, perceptual approval and broader MVP remain open.
