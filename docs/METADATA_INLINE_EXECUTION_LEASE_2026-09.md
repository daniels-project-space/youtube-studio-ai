# Metadata inline execution ownership — 9 September 2026

Status: **implemented and locally integrated; not deployed**. This is the local
execution-ownership slice of [the admission design](METADATA_PAID_ENGINE_DESIGN_2026-09.md).
It does not resolve the separate metadata budget envelope or historical-credit
admission hold. No production model, thumbnail, GPU, publishing or retention
operation was performed.

## Defect and change

Metadata previously checked only an optional remote-child lease callback. The
ordinary inline Trigger execution has no remote-child callback, so it could
continue requesting title/package work after losing its run generation.

The actual Trigger task now binds a local callback to its existing service
client, owner, channel, run, lease owner and execution token. The engine passes
that callback into the real metadata block. No permissive default is supplied.

`runExecutionAdmission.assertInlineLease` is a service-only, read-only Convex
query. It validates channel/run ownership, active status, exact worker/token
and finite, unexpired lease time using the server clock. It neither renews a
lease nor clears remote-child waiting state. Existing channel scheduling-pause
semantics remain unchanged; pausing future starts does not cancel an active run.

The callback freezes its identity, uses a fresh UUID for every check, validates
the echoed request identity, and subtracts monotonic round-trip duration from
the server's remaining lifetime. An expired-in-transit, malformed or failed
response never grants authority. There is no cached or coalesced approval.

Why the nonce matters: Convex documents that time passing alone does not refresh
a query subscription and that results can be reused for the same arguments.
Using a unique argument here is an engineering inference to prevent reuse of a
previous time-based grant; this is a per-request service check, not a reactive
UI subscription. A rounded client timestamp would be insufficient authority.
[Convex time-dependent query guidance](https://docs.convex.dev/understanding/best-practices#dont-use-datenow-in-queries).

The metadata executor checks ownership before each new immutable manifest or
paid-operation claim and immediately before each JSON request. It preserves
already-received outcomes even if the local generation changed during the
request. Those writes remain bound to the original create-only claim; later
requests and the actual Convex stage-write fence still reject the old worker.
The existing remote-child callback behavior is unchanged.

This distinction prevents throwing away completed paid work. Direct R2 reads
have strong read-after-write behavior, but neither that guarantee nor the new
query makes Convex, R2 and a model request one atomic transaction. An already
admitted in-flight request can finish after revocation. Unknown outcomes still
hold instead of being automatically repurchased. [R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/).

## Measured boundaries

- The real authenticated query handler performs three logical record reads
  through the existing authorization wrapper plus handler, with no writes,
  heartbeat, stage scan or bucket listing. This does not assert billed physical
  reads; Convex may optimize repeated access within a query.
- An ordinary successful four-request metadata execution makes eight checks:
  manifest, three operation claims and four JSON calls. The tested maximal
  selection/package retry path makes twelve checks for seven JSON calls. This adds safety work, not a
  claimed request-count reduction. Complete checkpoint restoration makes zero
  authority checks and zero provider requests.
- A lost partial selection remains held. A fully received selection resumes
  packaging/comment only; a fully received package resumes comment only. The
  selected title, frozen performance and exact receipt identities are retained.

## Actual verification

`runExecutionAdmission.test.ts` invokes the authenticated query handler and
tests service/owner/viewer isolation, foreign records, absent records, invalid
tokens/nonces, inactive statuses, expired/nonfinite expiry, database failure,
and a caller attempting to backdate the check. Remote wait fields do not change.

`inlinePaidExecutionLease.test.ts` tests the production callback with concurrent
and sequential calls, immutable identity, unique requests, malformed responses,
round-trip expiry and failures. It verifies actual Trigger binding in source.

`metadataExecutionLease.test.ts` traverses the **real runner, registered metadata
contract, metadata block, title selector, OpenRouter JSON transport/parser,
model accounting, checkpoint validation, local callback and authenticated
Convex query handler**. HTTP, R2 and database boundaries are deterministic
fixtures; no model function or accounting result is substituted.

It tests initial denial, absent authority, cancellation, expiration, revocation
between claim and request, after generation, after judging and after packaging;
complete restoration still works without a provider key or an authority callback.
Every actual HTTP request is immediately preceded by a successful query check.
Costs in engine results match the exact saved receipt sum without duplication.
The two-selection/two-package retry scenario also passes through the real
transport, verifies twelve checks and keeps all seven priced requests in cost.

A second integration path uses the **actual `makeConvexSink` stage writer and
`upsertRunStage` mutation handler**. Revoking after judge, package or final
comment rejects the stale terminal writes and leaves the stage running. Saved
R2 outcomes retain the received work/cost; a new generation resumes only missing
work, records the full cost and finishes. This tests handler behavior against
an in-memory database, not live Convex OCC or a live R2 outage.

The first TypeScript run caught an overly narrow UUID literal type in the
invalid-nonce fixture. Its input type was widened before the passing rerun;
production validation was not loosened. Scoped ESLint, the final TypeScript
rerun and the full production build pass (51 static pages). The full sweep
passed **637/637 direct production-readiness test files**. The subsequently
extended real-stage-write and maximal-retry integration cases were rerun
separately and passed, along with the related lease/inspection/recovery suites.

The same command completed an actual hermetic 31.021995-second, four-segment
1920×1080/30fps assembly without reported warnings. Its output is
`/tmp/assembly-smoke-kOM41A/bk_smoke_2_loudnorm.mp4`. This synthetic-media check
does not qualify a live channel render or its visual identity.

Logs: `/tmp/ysa-inline-lease-readiness.log`, `/tmp/ysa-inline-lease-build.log`,
`/tmp/ysa-inline-lease-typecheck.log` and `/tmp/ysa-inline-lease-lint.log`.
Graphify was refreshed after the final code edit: 21,434 code nodes, 52,399
edges, 701 communities. No semantic model calls were used; generated graph
files stay excluded from runtime/deployment inputs.

### Structural audit is not green

`npm run audit` reports 68 inert-produced-key findings against baseline 67.
The additional key is `metadata.titleDecision`, already present in the previous
saved title draft. It is the saved selection receipt, not another generation
call. Package recovery validates its fingerprint, and the actual engine tests
persist and restore it, but no downstream block declares/reads the **store
output**. Those distinctions matter: persisted evidence can be legitimate,
and the current audit explicitly reports it for review rather than proving
unused paid generation. Its baseline has not been increased or the key
artificially consumed. Resolve its intended typed evidence/inspection consumer
or document an evidence-only disposition before release. Full audit log:
`/tmp/ysa-inline-lease-audit.log`; key inventory:
`/tmp/ysa-inline-lease-inert-produces.log`.

The unbounded-normalized audit improved from two to one; the remaining audit
counts did not regress. Neither this improvement nor 637 passing test files
is presented as an entirely passing production release gate.

### Before/after reproduction

The exact saved checkpoint implementation from
`edb558671875ca33aeac26ecc74927835dab2f3a` and the changed implementation were
tested with identical valid inputs, in-memory create-only storage and
deterministic JSON responses:

| Revocation | Previous code | Changed code |
| --- | --- | --- |
| Before any work | Four requests; success; no check | Zero requests; rejected |
| After first response | Four requests; success; no check | One request; remaining work held |

At the fixture's simulated $0.01/request this is $0.04 versus $0.00/$0.01,
**not real spend or a forecast of provider savings**. Diagnostic:
`/tmp/ysa-inline-lease-before-after.ts`; exact saved source:
`/tmp/ysa-metadata-checkpoint-before-inline-lease.ts`.

## Release hold

The metadata contract is deliberately still `paid: false`; this document does
not present it as budget-safe. Required before rollout: verified engine-level
ledger admission, exact historical receipt credit, a defensible finite input
and request-cost envelope without silently truncating narration, versioned
frozen-run migration, and live deployment/API qualification. No UI change is
claimed. Title prompts, provider transport and the 66-call quality-study inputs
remain byte-identical to the previous checkpoint.
During this validation, the exact production alias's read-only health endpoint returned
HTTP 200 and revision `2c8e64a0e973808e11a5bb177543f0a3ebe0c632`. This is evidence
that the previous release remains live, not that this draft was deployed.
