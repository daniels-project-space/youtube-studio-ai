# Held worked-example visual plan foundation

Status: **held and unregistered**. Pure contract/compiler work on checkpoint `4a1fda2ef8f4737effc55d59f00392dead369daa`, isolated at `/tmp/ysa-worked-example-visual-jeKonA/repo`. No production caller, renderer, catalog admission, provider, publishing, or infrastructure change. This is not a delivered arithmetic lesson module.

## Contract and ownership

`workedExampleVisual.ts` is browser-safe: it reuses the existing preparation verifier and canonical narration draft; it does not solve labels or call a model. The closed `worked-example-visual/sentence-end-v1` plan contains the request-bound verified derivation, exact source-identity projection, ordered TTS-unit/beat windows, canonical operand/operator/result table, and per-beat presentation slots. The existing `sentenceTimings` artifact means the producer's utterance units, not every grammatical sentence: problem, one whole step (announcement plus equation), then answer. One through eight steps yield three through ten units. Result tokens are selected by their node identity only at or after that whole step's bound end. A numeric result can legitimately already exist as an operand, so global text absence is not the oracle.

`workedExampleVisualCompiler.ts` requires the current request, preparation, exact script/narration, independent script approval and approval binding, finalized audio binding/key, transcript/performance/timing metadata, and timed Story Spine. It calls the existing audio metadata validator against current namespace and TTS inputs/params. No duplicate approval mechanism or permissive hash-only shortcut was introduced. The separate server compiler dependency is not imported into the browser-facing EpisodeGraph schema.

Every advertised arithmetic marker, including explicit undefined/null script markers in either input or output script, activates full-bundle validation. Both the compiler and graph handoff reject mixed factual/fictional/arithmetic intent. V1 requires explicit `16:9` and `chapterCards:false` with an empty chapter plan. Portrait, chapters, merged sentence beats, and other speech grammars are unfinished work, not silently approximated alternatives.

EpisodeGraph and SceneManifest add only optional root plans and closed per-scene references. A partial, missing, foreign, reordered or clock-edited marker bundle fails instead of disappearing into the generic diagram grammar. The pure `bindWorkedExampleVisualPlan` adapter maps an already existing graph's exact Story Spine beats to the plan; it is not connected to the runtime planner. Graph text retains canonical speech as provenance, while compiled scene labels/text/actions use safe phase copy such as `Step 1`, never the full spoken equation as an immediately visible label. Closed phases are `problem`, `step`, and `answer`; there is no invented step-introduction clock. No arithmetic beat kind or generic-diagram reinterpretation was added.

The future active caller must use `assertWorkedExampleVisualPlanCurrent` with its complete current bundle. A standalone plan schema can replay arithmetic and validate internal consistency; it cannot authorize a foreign current audio object just because its public hashes were recomputed. A test explicitly demonstrates this distinction. Actual local audio bytes still require the existing byte check; source/master speech and final visual QA remain independent downstream obligations.

## Timing and reveal limits

The compiler uses the existing bound sentence clock and preserves the actual supplied Story Spine beat windows exactly: it creates no midpoint clock, new hold, estimated duration, rounded boundary, or speech timing of its own. An equation result is not eligible until its bound calculation sentence end; it can then remain in completed-step history in the following scene. The answer scene may show the already revealed final-step result.

**Bound does not mean directly measured-only.** Current TTS may reconcile up to two estimated sentence durations, and its audio binding does not retain that per-sentence provenance. This layer verifies the bound clock exactly but cannot identify or certify away those estimates. Runtime admission requires separate upstream timing qualification and actual arithmetic speech/renderer evidence. Neither this compiler nor its synthetic fixtures qualify pronunciation or final footage. The final `qa_visual` source/master critical-speech result remains downstream; requiring it here would create a pipeline cycle.

## Verification

The new default test generates real preparation and script values, independently extracts/executes the actual private `narratedBlocks.ts:splitSentences` function with the TypeScript AST, creates a Story Spine using the real planner, then exercises the new compiler, schema, pure graph adapter, and existing manifest compiler. All positive fixture unit lists come from that actual producer function, not from the visual helper being tested or a copied regex. **Audio identity bytes, timestamps, and performance metadata are explicitly synthetic contract fixtures, not an audio file or measured speech evidence.** The test does not execute paid TTS. Network transport is forbidden and observed calls are zero.

The 68 focused cases include the actual producer's five-unit, three-step boundary; generated signed add/subtract/multiply/exact-divide paths; eight steps; stale/foreign current inputs; missing markers; changed TTS controls; changed bound text/clocks; reordered/merged/overlapping units; forged results and operations with recomputed public hashes; premature reveals; result removal; unsafe labels/props; stale references; and mixed grammar. Generated `role-aware-2` independently yields `(-84) × 0 = 0` and `(-84) + 0 = -84`, proving role-aware reveal even when result text equals a legitimate existing operand.

The optional historical oracle loads an explicitly supplied absolute `WORKED_EXAMPLE_VISUAL_PARITY_SOURCE`; it never asks CI to read Git history. The exact retained EpisodeGraph source SHA256 is `fa24307f20ad513a736ca5fb5ef1df599413224626884b835fb84e36c7fc6b0e`. No full historical runtime duplicate is checked into the repository.

Local evidence directory: `/tmp/ysa-worked-example-visual-jeKonA`.

- `tts-units-before.log`: unchanged real-producer oracle fails because the rejected first visual helper invented eight units where current TTS emits five. `tts-units-after.log`: the same oracle passes after whole-step correction. Root independently retained the same failure in `/tmp/ysa-arithmetic-next-checkpoint-ghJ7BN/actual-tts-unit-boundary-before.log`; neither counterexample uses supplied clocks or providers.
- `corrected-before-checkpoint.log`: final opt-in actual checkpoint comparison still fails as intended because the checkpoint strips the complete arithmetic plan and displays the entire step utterance as an immediate label. Source and generator values are real; timestamps remain synthetic.
- `corrected-default.log` and `corrected-parity.log`: 68 pass, zero network. Optional parity compares exact byte-for-byte old/new unmarked graphs and manifests on three generated Story Spines, with identical graph fingerprints. This is source/contract parity, not pixel equivalence.
- `corrected-gitless-default.log`: the unchanged final default test passes without `.git` or historical source. `gitless-git-check.log` independently records Git refusing the sandbox as a non-repository. Historical parity is explicitly false in that default report, not silently claimed.
- `corrected-episode-graph.log`, `corrected-lint.log`, and `corrected-typecheck.log`: existing actual EpisodeGraph regression, focused lint, and nonincremental typecheck. Numeric terminal receipts accompany the final handoff.
- `corrected-browser-bundle.log`: the actual renderer's existing bundle helper succeeds, followed by a browser-platform bundle of the real Remotion entry plus runtime EpisodeGraph/visual schemas. The latter forces real schema inclusion instead of vacuously passing their type-only import. No Node fallback/polyfills are added; metadata excludes the server compiler, audio binding, TTS and FFmpeg implementations. No video was rendered.

## Rejected first iteration

The first 67 passing synthetic cases were **not valid actual-connector proof**. They mistakenly split `Step one. negative ...` into separate announcement/calculation units, while the real TTS splitter only starts a new unit before uppercase text. That proposed eight-unit source/doc slice is retained byte-for-byte under `rejected-eight-unit/`, together with its earlier logs; it is not an accepted checkpoint. The corrected contract preserves one whole-step utterance and tests it independently against the real source function. Early failed lint/typecheck and old-shape proof logs remain retained for audit rather than being overwritten or treated as current qualification.

No render or actual speech fixture was available or fabricated for this slice. The five-file ownership is `src/engine/workedExampleVisual.ts`, `src/engine/workedExampleVisualCompiler.ts`, `src/engine/episodeGraph.ts`, `src/engine/__tests__/workedExampleVisual.test.ts`, and this document. Root coordinates the held checkpoint, graph refresh and later caller/render qualification.

## Independent composed-checkpoint review

The coordinator applied the corrected five-file slice onto exact `4a1fda2`
alongside the already released shared transcript-count repair and the corrected
held arithmetic caller fixtures, in
`/tmp/ysa-arithmetic-next-checkpoint-ghJ7BN/repo`. All four source/test files are
byte-identical to the corrected reviewed slice; this section is additive.

Independent actual-producer segmentation replay passes five versus five
(`actual-tts-unit-boundary-after.log`, terminal 0), with the earlier five-versus-
eight failure retained beside it. The composed 68-case suite passes with zero
network calls (`visual-composed-root.log`, terminal 0), and full nonincremental
typecheck passes (`visual-composed-typecheck.log`, terminal 0). These checks
do not change the synthetic-timing or unregistered-runtime limits above.
