# Explicit module selection, 19 September 2026

## Purpose and release boundary

The owner chose module-first development, with current channels/pipelines kept
as legacy baselines for later matched-input comparisons. This development batch
adds executable selection and transports the selection through the existing
system. It does not claim that every legacy dependency or worker deployment is
already immutable. No live channel records, schedules, or provider selections
are changed. No alternate production module is registered by this batch.

The production baseline remains Studio commit `722facc4`. New music direction
work and this dispatch work stay on the development branch until the remaining
activation requirements below are proven.

## Selection contract

An existing `{ block, params }` entry selects the existing default. An explicit
`{ block, version, params }` selects exactly one installed manifest version:

```ts
{ block: "music", version: "2.0.0", params: { /* admitted module controls */ } }
```

This example describes the schema, not an installed or qualified music version.
`registerManifestVersion` requires an existing default and refuses duplicate
versions. Registering an alternate never changes the default or adds the
alternate to default discovery. Version ranges, `latest`, whitespace-normalized
aliases and unavailable revisions do not fall back to another implementation.

Validation uses the selected manifest's actual input/output and capability
contracts. Compilation records its version and changes the compilation
fingerprint. The runner and compiler reject inconsistent entry/manifest/block
selections before execution; the runner checks before reading resume state.
Existing stage receipts bind producer versions and refuse old outputs under a
new selected version rather than silently regenerating/reusing them.

## Transport and composition

Optional versions survive channel schemas, frozen profiles and invocations,
architect edits, certified composition parameter merges, runtime parameter
materialization, length enforcement, inception customization and probes, and
qualification benchmark cloning. Concurrent pipeline comparison includes the
version, so a stale write cannot overlook another writer's pin. Publication
configuration fingerprints include versions of external-side-effect modules.
Unversioned fingerprints retain their prior shape.

Runtime policy completion inspects the selected manifest, not the default's
capabilities. Structural-only catalog projection refuses explicit selections
because it cannot attest their executable contracts. Legacy retirement rules
cannot silently remove explicitly versioned entries. These are refusal gates,
not automatic migration or automatic qualification of a new revision.

Weekly preparation is a separate boundary: its manifest digest preserves the
pin, but its current script, narration, image and music producers call their
existing implementations directly. The new admission guard therefore refuses
any explicit version before those tasks reuse sidecars or generate content.
Week-ahead channel admission also refuses it before planning. Unversioned
legacy preparation remains supported. This is an explicit unsupported-path
error, not a qualified versioned weekly implementation.

## Evidence scope

- `moduleVersionDispatch.test.ts`: default/discovery parity, exact installed
  selection, unavailable/malformed/duplicate revisions, reset semantics.
- `moduleVersionExecution.test.ts`: real compiler/runner/receipt handling with
  pure CPU fixture implementations; selected outputs, compilation identity,
  stale recovery rejection, and refusal before sink I/O for altered selections.
- `moduleVersionPolicy.test.ts`: actual policy capability selection, parameter
  materialization, length changes, structural refusal and retirement guards.
- `moduleVersionInception.test.ts`: executes the actual private DNA, no-cast
  voice and probe transformation functions, extracted with the TypeScript
  parser. This does not exercise live channel creation or qualified voice setup.
- `pipelineVersionTransport.test.ts`: profiles, exported Convex validators,
  frozen snapshots, real compare-and-swap handler with fixture storage, benchmark
  copies, publication fingerprints and unchanged legacy serialization.
- `architectVersionTransport.test.ts` and the extended composition compiler
  suite: actual transformation and receipt-admission behavior.
- The four added `remoteStageReuse.test.ts` cases exercise the real remote
  worker with real frozen reconstruction, compilation and cost admission.
  CPU-only v2 executes without invoking the v1 trap; a missing v2 or changed
  selection under an old fingerprint refuses before storage/provider work.
  An unchanged historical unversioned invocation still executes v1 after v2
  registration. These are fixture implementations, not live remote deployment
  or rendering evidence.
- `weeklyPreparationVersionAdmission.test.ts`: actual four producer task
  boundaries with intercepted external services, plus actual week-ahead
  pre-reservation refusal. Explicit/malformed/default-version pins cannot read
  a reusable sidecar, generate content or dispatch another task; unversioned
  calls still reach their existing reuse path. Existing producer suites retain
  their separate success-path coverage.

These are executable contract/transport tests, not video or music quality proof.
Their fake modules are test-only; they are not catalog entries or providers.

The production build including TypeScript, focused ESLint, structural audits
and a real 31.02-second hermetic assembly smoke test pass for this batch. The
code graph was refreshed. All 831 direct readiness tests passed. The assembly
uses synthetic local media, not a new channel output or music-quality
qualification. This batch has not been activated in production.

## Still required before activation

### First real opt-in revision

`timeline_assemble@2.0.0-composer-mix` now declares and validates the optional
`musicBrief` artifact. Its mix precedence is explicit assembly numeric settings,
then an explicit assembly duck profile, then composer directives, then existing
assembly defaults. Explicit zero is preserved. It delegates to the existing
assembly paths without changing their source, enabling EDL, or processing
narration effects. Default discovery and unversioned selection remain unchanged.

`composerAwareAssembly.test.ts` exercises the real deterministic directive
producer, registry selection, legacy assembly, EDL adapter, planner and backend,
with storage and FFmpeg intercepted. This is contract evidence, not a rendered
audio-quality qualification. No channel has been opted in.

For this revision, all 832 direct readiness tests, the production build including
TypeScript, and scoped ESLint passed. A separate 14-invocation compiled-runner
probe confirmed absent settings stay absent and explicit presets remain
authoritative. The code graph was refreshed. No deployment was performed.

### Worker isolation audit

Installed Trigger SDK 4.5.9 supports `tasks.trigger` options `version`, serialized
as `lockToVersion`. Plain triggers do not automatically inherit their parent
worker; `triggerAndWait` does inherit `taskContext.worker.version`. Local source
inspection does not establish remote retention or unavailable-version behavior.

The immutable invocation currently lacks worker deployment identity. Same-run
serialized-episode retries, publish resumes, factual-review and music-audition
continuations, automatic doctor resumes, and scheduler reattachments need a
verified frozen binding and exact dispatch pin. Receiver admission must reject
a mismatched worker before provider work. Preserve existing global idempotency
keys; never stamp historical snapshots with the current worker retrospectively.

The actual worker identity is `taskContext.worker.version`; optional
`ctx.run.version` and `ctx.deployment.version` must agree when present. An
environment variable is not proof of the executing deployment. Older deployed
code also contains an unpinned retry path, so merely retaining that deployment
does not yet establish legacy isolation. Convex and mutable external settings
remain separate boundaries even when a worker is pinned.

### Activation gates

1. Preserve actual legacy implementations and affected transitive helpers at a
   known source/dependency revision. A changed function re-registered under an
   old version is not isolation, and these tests do not prove otherwise.
2. Bind real alternate modules to their qualified contracts and exact worker
   deployments, including schedules, retries and remote reconstruction. Missing
   implementations must refuse execution, never choose the newest available.
3. Verify direct and weekly-prepared paths use the same accepted planning
   artifact and revision. A version field does not qualify a separate planner.
4. Qualify the opt-in composer mix revision with real rendered evidence;
   implement the remaining ownership repairs: consume accepted arrangement,
   and remove score generation from comic rendering for opted-in pipelines.
5. Complete real YuE RTX 3090/instrumental/audio-quality qualification and the
   actual production provider integration. The current evaluation worker does
   not replace any production music provider.
6. Compare retained new-pipeline outputs with preserved legacy evidence using
   the same briefs and explicit revision/quality/cost records. Do not rewrite
   legacy channels or regenerate old evidence to manufacture a comparison.
