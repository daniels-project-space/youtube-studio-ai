# Retained Studio VM preflight

The existing read-only preflight plans a new RTX 3090 allocation. It checks
global free capacity before inventory and recognizes only its default creation
name. On 22 September it stopped at `Exact RTX 3090 VM shape is unavailable`,
although the retained Studio VM and its disk existed under the credential-test
name. That result did not establish whether the retained VM could resume.

The same operator CLI now accepts an optional explicit retained VM UUID:

```sh
ai-vault openrelay OPENRELAY_API_KEY=OPENRELAY_API_KEY -- \
  npx tsx src/scripts/preflight-yue2-openrelay.ts \
  626c2959-4f58-4779-b867-2a74129e93e5 18 \
  29e245a2-2e1a-431e-b5b3-654cf0ba1587
```

This mode makes three GETs: identity, exact VM detail, and that VM's live burn
metadata. It validates organization/ID binding, private community-tier RTX 3090
24 GB, one GPU, minimum guest RAM/disk, an allowed retained status, the operator
rate ceiling and no disk billing. It does not query global availability or infer
ownership from a name. Missing, mismatched, terminated or incompatible resources
fail; none falls back to creating another VM.

The live command passed at `2026-09-22T02:33:46.090Z`: retained VM stopped,
28,672 MB guest RAM, 60 GB disk, 18 cents/hour, no disk billing. The report keeps
`authorizedToCreate`, `authorizedToRestart`, `restartCapacityVerified`,
`placementVerified` and `gpuQualified` false. It does not validate mounted model
bytes, available guest RAM, GPU execution, or musical quality.

Default new-allocation behavior is unchanged. In particular, the provider's
`activeOnly=true` inventory filter was not removed: its documented meaning is
non-terminated, not currently running.

The admission regression suite covers exact retained-ID selection without any
global capacity request, malformed IDs before HTTP, foreign organizations/IDs,
wrong GPU/VRAM/count, undersized RAM/disk, public or wrong-tier VMs, unavailable
statuses, excessive/missing cost, disk billing and denied reads without secret
leakage. Existing new-allocation and paginated-inventory cases still pass.
Typecheck and focused lint pass. No provider mutation, GPU inference, credential
change, thumbnail work or production deployment is part of this change.

This removes a misleading provisioning preflight, not the live organization
permission refusal documented in `yue2-source-ownership-comparison-20260922.md`.
