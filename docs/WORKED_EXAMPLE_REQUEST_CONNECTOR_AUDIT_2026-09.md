# Worked-example request connector audit — held, not admitted

This is a read-only runtime audit and a proposed connector design. No pipeline, catalog, provider, payload, baseline or compiler rule was changed. The existing owner-lock directory was checked and contained no markers. Only this audit document was added.

## Finding

`workedExampleRequest` has **two registered required consumers and no producer**. It is not a supported run-payload seed. Merely adding it to a connectivity allowlist would hide the missing implementation.

Retained executable: `/tmp/ysa-arithmetic-narration-independent-jIV7IE/producer-audit.ts`; results: `producer-audit.log`. It exercises the actual registry, canonical brief, route resolver, seed-carrier function and validator with a network-denying fixture, and records eight source hashes. The actual unproducible-consumes audit is retained as `unproducible-consumes.log`: **5 findings**, consisting of the three existing unrelated inputs plus the two new arithmetic consumers. No audit baseline changed.

The executable also proves that a normal narrated-stock concept saying “Teach integer addition and multiplication through worked examples” still resolves to `narrated-stock/foundation/v1`, requiring `topic_select → script_gen → qa_script`. It does **not** gain arithmetic semantics. An undeclared `worked_example_integer` program intent is rejected. This is correct present-day behavior, not a reason to keyword-route generic channels into arithmetic.

## Current automatic-channel and run path

1. `src/app/(app)/channels/new/page.tsx:477`, `programBriefResolution`, builds one canonical `ChannelProgramBrief` for both preview and submission. Current explicit intent choices are quiz and fictional-scenario variants, not worked examples. Free-form concept, audience and sample topics remain creator context.
2. `src/engine/channelProgramBrief.ts:445`, `createChannelProgramBrief`, canonicalizes the semantic brief. `ChannelProgramIntentSchema` is a strict discriminated union. Operations, arithmetic domain or difficulty are not part of it today.
3. `src/app/api/channel-pipeline-preview/route.ts:POST` calls `compileChannelPipelinePreview` (`src/engine/channelPipelinePreview.server.ts:177`), which uses `designPipelineCore`. The build endpoint (`src/app/api/build-channel/route.ts:123`) validates the exact request-key-bound brief, refuses browser-supplied program routes, derives the route server-side and dispatches `design-channel` with server-owned owner identity (line 684).
4. `src/trigger/designChannelInception.ts:1475`, `executeDesignChannel`, validates the canonical brief and resolves its route before work. `designPipeline(designOptions)` at line 1847 uses `src/engine/designerCore.ts:259`. Later architect changes must survive `certifyChannelPipeline` at line 1336 before the exact pipeline is persisted at line 3517. The architect cannot make an unregistered arithmetic intent true merely by naming its blocks.
5. `src/engine/channelProgramRoute.ts:650`, `matchingDefinition`, selects by exact family and declared intent, not keywords. `resolveChannelProgramRoute` at line 721 binds the selected definition to the canonical brief. `channelProgramRouteRunSeed` at line 908 projects the frozen run context. The current seed carries selected quiz/synthetic profiles but does **not** copy arbitrary `programIntent` or the free-form concept. A future structured arithmetic profile needs an explicit typed projection, not an undeclared ambient read.
6. `src/trigger/runPipeline.ts:398`, `runPipelineTask`, reloads both channel and durable run. Owner identity comes from `channel.ownerId` at line 445, then `assertRunPipelineAdmission` verifies the run belongs to that owner and channel. The request may not supply an alternate owner namespace.
7. Fresh channel identity is frozen into `seedStore` at line 1661, including `channelProgramRouteRunSeed` at line 1715. `payloadSeedInputs` at line 1740 imports only the four actual operator packet keys listed in `src/lib/payloadSeedInputs.ts`. It does not carry arithmetic requests or solutions. A new invocation is normalized, hashed and atomically claimed at lines 1926–1974; retries use its own entries and seed store rather than current mutable settings. The engine receives the claimed namespace and snapshot.

## Compile-seed divergence to resolve truthfully

The creator designer validates a bound route as an existing seed (`designerCore.ts:1359–1363` includes `channelProgramRoute` when `programRoute` exists). In contrast:

- `certifyChannelPipeline` uses `validatePipeline(args.pipeline, ["contentLane", ...childrenShowBibleSeedKeys(lane)])` at `designChannelInception.ts:1376`.
- `runPipelineTask` uses that same reduced list at `runPipeline.ts:1622`, before constructing the fresh seed store.

`childrenShowBibleSeedKeys` (`childrenShowBible.ts:392`) supplies only supervised child/curriculum packet keys, never `channelProgramRoute`. Therefore a future request producer declaring a genuinely required route would expose a creator/runtime validation mismatch even though the route is later physically seeded. Existing branches often consume the route optionally; their success does not prove this new required port is connected.

The proper change is a common, truthful projection of seed keys whose values are actually admitted and frozen at each boundary, including route only when present. Do not add `workedExampleRequest` as an assumed seed, make a required route optional to avoid validation, or seed a handcrafted request in the end-to-end test.

## Smallest truthful future connector

Introduce one deterministic **request-planning producer**, for example `worked_example_request`, that consumes the existing admitted, frozen `channelProgramRoute` and produces only a typed `workedExampleRequest`. The name is illustrative; it is not currently registered. It would run before `worked_example_prepare → worked_example_script`, as the sole request producer, and remain unpaid and provider-free.

The trusted inputs are:

- `ownerId`, `channelId`, `runId`: the actual `StageContext` established from server-loaded channel/run records, never brief, params, prompt or model output.
- Operation sequence: an explicit, versioned arithmetic program profile in the canonical brief and its sealed route projection. No keyword interpretation of topic titles or general-channel prose.
- `requestId` and seed: a bounded canonical hash of the exact route/profile and durable episode/run identity. Same frozen episode retry must reproduce the exact request; a different run must obtain a distinct identity. `Date.now()`, random values on retry, mutable channel state and human-provided example answers are not sources.
- Policy: code-owned `worked-example/integer-v1`, only while that exact domain and generation contract is supported.

`prepareWorkedExample` already contains the automatic numeric source. Its `generateDerivation` at `workedExample.ts:155` deterministically generates integer operands from the seed and operation sequence, then the independent verifier replays each step. The new request planner must **not** produce equations, asserted results, narration, approval or solutions; it supplies intent to the existing generator. This is procedural arithmetic content, not external research or a general-purpose solver.

For week-ahead work, a stable scheduled-episode identity may replace “new run” as the episode selector, but it must already be claimed and frozen. The current request embeds run ID in its binding; precomputing under a fictional temporary run and relabeling the result later is not valid reuse. Either create/claim the durable future run first or design an explicit independently reviewed plan-to-run binding. This is an additional integration requirement, not permission to change the existing request identity silently.

## Where operations and difficulty belong

A genuinely new declared capability must state **what the channel teaches**, separately from its visual family. A future canonical intent could identify signed-integer worked examples and a versioned ordered operation profile. The exact shape should be reviewed before implementation. It must survive canonicalization, route fingerprinting, preview, ShowProfile obligations, inception persistence, invocation freezing and request generation. A novel brief asking for fractions, algebra, word problems, taxes or application-specific factual examples must be refused or remain on another genuinely supported route; it must not be silently flattened into random integer chains.

The current request supports exactly `add`, `subtract`, `multiply`, `exact_divide`, with 1–8 ordered operations. Its current generator uses an initial integer in −100…100 and subsequent operands in −12…12, choosing actual positive divisors for exact division. This is **not a difficulty model**. It may generate negative values, zero, multiplication by zero, division by one and very different expression complexity. It is not justified to expose “easy/medium/hard”, “ages 5–7”, fractions or curriculum mastery as if those controls already change generation.

For a first honest bounded intent, expose only supported operation/profile selection and describe its fixed signed-integer domain. If difficulty is needed, introduce a versioned typed domain profile with real operand/range, sign, operation-count and degenerate-problem constraints in the generator and verifier, with measurable tests. Do not add a slider, parameter or metadata label that the arithmetic core ignores. A child-focused brief must also retain the existing supervised children-show/curriculum approval path; this module does not substitute for it.

The channel's concept/audience still matters. The preview should identify the interpreted supported capability and its limitations, and semantic admission must reject incompatible concepts rather than silently ignoring them. Any future model may propose a bounded intent, but canonical validation and the deterministic generator own executable meaning. A family such as whiteboard describes presentation, not authority to teach arbitrary math.

## Conditions for a genuine 5 → 3 audit improvement

1. Register the real request producer with `workedExampleRequest` as its output and only actually seeded/produced inputs. Do not modify `KNOWN_SEEDS` or the baseline to remove the findings.
2. Test exact canonical intent/profile round-trip through preview, build admission, route seed, channel persistence and frozen invocation. Wrong/missing/stale/foreign profile must fail before providers.
3. Test actual runtime seed-key projection at creator and execution boundaries; derive it from admitted values, not a test-only list. A required route must be physically present, not merely declared available.
4. Execute the registered request → preparation → script chain using only an ordinary automatically constructed route/run context. Do not hand-supply `workedExampleRequest`, preparation, draft, approval or reference answer.
5. Independently verify resulting arithmetic across all supported profiles and seeds; prove retry determinism, distinct episode identity, namespace refusal and exact requested operation order. Include unsupported domains, impossible difficulty and degenerate-problem policy counterexamples.
6. Preserve independent `qa_script` and current exact narration approval. Repair and test stale completed-audio restoration before admission. Retain measured timing/byte evidence, then audition actual speech.
7. Recheck duplicate script/request producers, missing/reordered blocks, module locks and exact catalog ownership. No catalog mapping may claim renderer or lesson quality without its evidence.
8. Keep the existing production policy requirements, including real topic/research, compliance, crew/story alignment, final QA, packaging and publishing safety. Do not award `topic.researched` to procedural arithmetic generation simply to satisfy compilation. A new truthful lesson route needs an explicit policy-compatible planning design, not weaker compile allowlists.
9. Re-run all ordinary families/route snapshots and the untouched unproducible-consumes audit. The two arithmetic findings should disappear because a real registered producer exists; the three unrelated findings stay visible.
10. After measured narration and content-bound renderer integration, test an entirely new automatically created private channel through the real workflow, with no manual replacement of module outputs. UI and creative quality remain separate evidence gates.

A registry-only producer can make the static count drop while remaining unreachable from automatic creation. The number alone is not completion. Until all connector and output gates are met, the arithmetic capability remains held and must not appear as production-ready or auto-publish.
