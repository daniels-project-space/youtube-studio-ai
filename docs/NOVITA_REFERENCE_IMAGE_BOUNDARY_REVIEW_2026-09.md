# Novita reference-image boundary — 9 September 2026

Status: narrow fail-closed correction, not reference-image conditioning support.

Graphify and current imports identify MotionComic, Lore and Documotion callers of
`createAttestedNovitaImageGenerator`. The generic constraint only requires prompt,
negative prompt and seed. MotionComic's extended request additionally carries
`images`, but the factory previously discarded that field when projecting the
request into `renderAttestedNovitaImageBytes`. Attestation of the resulting
text-only image did not prove that the requested reference pixels were used.

## Change

`src/lib/novitaMedia.ts` adds a check at the start of the returned factory
function, before `args.id(request)` or any renderer call:

- Missing/undefined `images` and an empty array retain their existing behavior.
- Every nonempty array is rejected, including sparse or malformed entries.
- Non-array values, including null, strings, objects, booleans and typed arrays,
  are rejected rather than interpreted as “no references.”

The error does not include reference bytes or URLs. No new runtime test hook,
provider route, worker, model, quality setting, geometry setting, receipt format,
publishing policy or caller API was added. Existing `aspectRatio: "4:3"`,
`imageSize: "2K"` and other comic knobs are not newly rejected. This does not
claim those knobs override the route's actual pinned profile; their previous
transport behavior is preserved.

The unit protected here is one factory invocation. Earlier work in a larger
comic/job is not rolled back or erased. Full reference conditioning and any
earlier whole-workflow admission remain separate work.

## Actual-factory evidence

New focused test: `src/lib/__tests__/novitaReferenceImageBoundary.test.ts`.
It executes the real factory, media adapter, cost envelope and actual profile
conversion. External `renderImages` transport is replaced with an instrumented
stop; storage/usage dependencies are guarded. No provider was called and no
generated-media success is claimed.

Evidence directory: `/tmp/ysa-novita-reference-review-E0htth`.

| Evidence | Result |
| --- | --- |
| `novitaMedia-before.ts` | Exact retained pre-change source; SHA256 `558e8e95c0e526d4cdf8b4cebaa5fde4e61d034aeeb81029350a7b1a5ae8c5c4` |
| `failing-before.log` | Expected exit 1: nonempty refs reached ID/lifecycle/provider/spend-hook boundaries while reference data was absent from transport |
| `retained-baseline-replay.log` | Same expected exit 1 using retained source after the correction |
| `passing-after.log` | Exit 0: 12 nonempty/malformed cases rejected with no ID, lifecycle, spend-hook, network, storage or receipt side effects |
| `transport-parity.log` | Exact canonical request bytes equal before, retained replay and after; four absent/empty/legacy-knob requests also equal |
| `production-image-routing.log` | Existing attestation/receipt/routing suite passes |
| `keyframe-recovery.log`, `clip-recovery.log` | Existing recovery suites pass |
| `typecheck.log`, `eslint.log` | Pass, empty logs |
| Convergence/inertness before/after logs | Byte-identical audit output |

Preserved production transport SHA256:
`bfd97e4a43675a654983f4a29107cbb56938042a85b17a35164153f73724a9cb`.
The comparison includes prompt, negative prompt, seed, worker count/concurrency,
cost ceiling, lifecycle identity and every pinned image/infrastructure setting.

```sh
./node_modules/.bin/tsx src/lib/__tests__/novitaReferenceImageBoundary.test.ts
NOVITA_REFERENCE_BASELINE_SOURCE=/tmp/ysa-novita-reference-review-E0htth/novitaMedia-before.ts ./node_modules/.bin/tsx src/lib/__tests__/novitaReferenceImageBoundary.test.ts
```

The second command deliberately fails: it replays the original silent-drop bug.
No source outside these three scoped files was changed for this correction.
No paid calls, Git actions, deployment or Graphify refresh were performed.
