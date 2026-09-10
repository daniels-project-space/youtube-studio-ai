# Held worked-example native renderer review — 2026-09-10

This is a **held, unregistered visual foundation**, not a delivered arithmetic module, channel-quality approval, measured-speech result, or production admission. Worktree: `/tmp/ysa-worked-example-renderer-pLBlHA/repo`, based on `df6cc8118c46257ce938c8afdc151085d6626cb6`. No canonical edits, commits, deployments, model/storage/provider calls, or cloud GPU work were performed in this slice.

## Scope and contract

Exactly seven files: `src/remotion/sceneCompiler/{WorkedExampleScene.tsx,workedExampleLayout.ts,SceneCompiler.tsx,layoutProfile.ts}`, `src/lib/__tests__/sceneCompilerWorkedExample.test.ts`, `scripts/scene-compiler-worked-example-proof.mts`, and this document. The accepted five-file visual-plan layer, TTS, runtime block callers, registry, admission, QA, and production 16:9 fence remain unchanged from the checkpoint.

The existing Remotion entry/bundle/render helper is preserved. A full typed arithmetic marker selects a dedicated branch before generic scene normalization. Full manifest/plan/DAG validation occurs in memoized preflight and before browser/bundle work in the actual render helper. Only bounded slot selection and at most eight step comparisons occur per frame; problem line wrapping is memoized.

Native 1920×1080 at 30fps only. Marked portrait, other dimensions, children presentation, incomplete/stale markers, mixed factual/scenario data, and transitions other than cut/match_cut refuse. Unmarked scenes retain their previous rendering path. Labels are the compiler's safe `Step N` labels; expressions, operands, operations and results come from the independently verified typed plan, never parsed narration or random graphics.

The presentation keeps the original canonical expression (40px, at most two lines), current operands (72px), newest complete equation (64px), older complete equations (30px, original order), and footer label (52px). It never shrinks text, removes parentheses, adds ellipses, invents a hold, or changes the supplied clock. Before a step's bound end, its result-role node is absent; on the first eligible actual frame it becomes the persistent newest complete equation. Later operands may legitimately equal an earlier/future result by value, so the oracle checks roles and node identity rather than banning numeric strings.

The fixture constructor is localized in exported `workedRendererFixture()` and reused by the browser proof. It uses actual preparation → canonical draft → AST-extracted **actual TTS sentence splitter** → synthetic timing/audio-identity metadata → actual Story Spine → accepted binder/compiler. Three steps produce five whole utterances, not the rejected historical eight-unit assumption. No actual speech or audio bytes are fabricated as production evidence: the local metadata is explicitly synthetic, and the rendered AAC track is silent.

## Before, visual repair, and final native evidence

Evidence/log root: `/tmp/ysa-worked-example-renderer-pLBlHA`.

- Exact clean `df6cc81` renderer baseline: `/tmp/ysa-worked-native-proof-jGGjB3/before-generic-69.png`; `before-frozen-proof.log` exits **1** because the actual renderer mounts the generic node diagram and no content-bound math. Same marked manifest, real installed browser and real bundle; no copied renderer approximation.
- First pass: `/tmp/ysa-worked-native-proof-BYbZ7P/results.json` (30 samples; full local MP4 and four initial negative bundles). Independent pixel review found a weak hierarchy: a completed equation appeared only in 30px history while the main equation advanced. These frames remain retained, not retroactively called final.
- One runtime visual repair promoted the newest completed relation to a persistent 64px region, leaving older rows at 30px and clocks unchanged. Provisional before/after reveal and eight-step frames are in `/tmp/ysa-worked-native-proof-l22UEM`.
- Final native run: `/tmp/ysa-worked-native-proof-GweKrZ/results.json`, `native-final.log`, terminal **0** (session 67924). There are 34 positive frame snapshots plus four initial negative snapshots. The 16 primary samples are also extracted from the actual encoded H.264, with unrestricted raw OCR saved beside them.

Final media: `/tmp/ysa-worked-native-proof-GweKrZ/signed-lesson.mp4`, SHA256 `88875f310491b5246a0c55a6099cae7a19099fedc578ade3c38d253957ac660c`. FFprobe: 1920×1080, H.264, **319 video frames**, video duration **10.633333s**; silent AAC/container duration **10.688s**. Input synthetic duration is 10.625s. Frame count is exactly `ceil(duration × 30)`; container padding is reported separately and satisfies the already established 0.12s final SceneCompiler mux seam, not a new acceptance tolerance. Tools: Chrome145.0.7632.159 and FFmpeg6.1.1.

Encoded samples: frames `0,5,69,127,128,129,133,191,192,193,197,254,255,256,260,318` under `/tmp/ysa-worked-native-proof-GweKrZ/encoded-{frame}.png`. Exact actual boundary results:

| Result | Last ineligible frame | First eligible frame |
| --- | --- | --- |
| -66 | 127 / 4.233333s | 128 / 4.266667s |
| -198 | 191 / 6.366667s | 192 / 6.4s |
| -33 | 254 / 8.466667s | 255 / 8.5s |

All 16 encoded samples and 18 additional positive native samples were visually inspected, using retained contact sheets plus native-size critical/dense frames. No clipping, unsafe glyph bounds, overlap, wrong sign/operator, or early result was found in these final positive samples. The fixed source formula, active equation and completed relation remain distinct. OCR sometimes misreads `÷` as `+`/`=` and changes reading order; raw output is retained without a corrective whitelist. Exact DOM token identity plus visual inspection, not OCR normalization, determines the result.

Additional real generated fixtures cover subtraction, exact division, `(-84) × 0 = 0`, `(-84) + 0 = -84`, eight additions, eight multiplications (`density-signed-30`, widest complete display31 characters; final981319680), and mixed eight operations (`density-signed-16`, widest27 characters; final2172962). The long seeds came from a bounded128-seed generator search; its exact output is `generated-density-search.log`. Widest-step and final-step pre/reveal samples are retained. These specific dense cases pass; this is **not** a claim that every possible eight-step expression fits. Wider/unbreakable/two-line-overflow requests refuse at the fixed readable sizes.

## Negative oracle strengthening

Visual inspection also found a proof-only weakness: the first “missing result” mutation removed the semantic role but retained its pixels. The final proof instead genuinely omits the result text. Its clipping mutation now translates the actual equation outside the safe frame while keeping 72px type, so the unchanged bounds assertion—not a font-size mismatch—must reject it.

Final targeted negative run: `/tmp/ysa-worked-native-proof-vjg7vC/results.json`, `negative-strengthened.log`, terminal **0** (session61373). Four generated temporary bundles of the actual component are rejected: premature results, a removed negative sign, visibly missing result text, and actual out-of-frame clipping. All other renderer/schema/theme code is real and unchanged. Defective bundles, their hashes, actual screenshots and exact failed assertions remain retained; runtime files were not mutated. The missing-result and clipping pixels were independently inspected after strengthening.

The full native/positive proof and its exact failing baseline used proof hash `9a64ad549d34ff0c88555b1ccd69d2835022bce5e174a475eb4718434b0168ea`. The final proof hash is `e054bac32f77c1518bbff449e0d7502461c0f00e08ba966fd76f80da05b4b7f1`: only negative fixtures plus the bounded `--negative-only` mode changed afterwards. All positive assertions and runtime bytes are identical. Therefore the final negative-only receipt is **not** described as another complete media encode. The default final script still runs the complete encode/positive/negative suite.

## Qualification and ordinary-path preservation

- 28 focused actual-preparation/compiler/preflight/real-renderer-caller cases: `unit-final-expanded.log`, terminal0. Invalid root/scene markers, unsupported geometry/transitions, mixed input, long text, and whole-step/final-answer windows without an actual frame refuse before any renderer transport. A supported request reaches the real render helper's external-work seam exactly once.
- Full nonincremental TypeScript and focused lint: `typecheck-final.log`, `lint-final.log`, terminal0 (session97923); final proof-only refinement is separately checked in `proof-typecheck-final.log` / `proof-lint-final.log`.
- Existing portrait profile and actual render-entry refusal test: `portrait-regression.log`, terminal0. This is a regression check, not new portrait arithmetic admission.
- Exact ordinary **11-scene native PNG parity**: baseline `/tmp/ysa-worked-ordinary-parity-fTFHed/results.json`, candidate `/tmp/ysa-worked-ordinary-parity-ozFjf0/results.json`, `ordinary-before.log` / `ordinary-after.log`, both terminal0. The retained `/tmp/ysa-worked-example-renderer-pLBlHA/ordinary-parity.mts` executes the exact existing portrait-proof's ordinary fixture construction and actual render helper; every map/chart/diagram/panel/puppet/screen/scenario PNG is byte-identical against clean `df6cc81`. Fixture/source hashes are recorded. The earlier full portrait transition footage was not rerendered for this unchanged unmarked branch.
- `git diff --check` passes. Accepted five files are unchanged relative to `df6cc81`. Owner locks were checked before edits; no lock was bypassed. Parent owns canonical Graphify refresh and qualification after integration.

## Frozen runtime hashes and remaining boundary

| File | SHA256 |
| --- | --- |
| WorkedExampleScene.tsx | `3f4284724c07c10c88ea34be8f62ea734062fea3a1abaaf7c7bffd3a3b423b4b` |
| workedExampleLayout.ts | `0bc59747139000e2e2bf19e052fff43370b91a73a862f4f8ae30c85a2b8beaf3` |
| SceneCompiler.tsx | `d25faeb887ec8525816e2a77b53156126b6a7899f3dc451a0825aa05e57eddab` |
| layoutProfile.ts | `3a9013ad2295182a6b3c86dc66b82c8639763cc6d4ad7092b144b06616543267` |
| focused test | `a859fd0034d475181091e6ce7d66ab10ea779e04468e52fb50b931672c861c27` |

The footage-review skill required actual full-span/boundary pixel inspection and drove the one readability repair. Hyperframes entry guidance respected the owner's explicit existing Remotion framework: no framework port or workflow installation. Review verdict is **pass only for this held synthetic-clock native visual foundation**: 34 positive content-bound frames reviewed, coverage of the encoded artifact from first through last frame (last start10.6s, end10.633333s; largest primary sampling gap2.133333s), one visual repair cycle, no unresolved blocking positive-frame findings.

The current `df6cc81` clock binding may include reconciled estimates and does not establish measured-only provenance. The separate pending strict `segmentClock` work must be composed at the single fixture seam without presenting synthetic metadata as measured speech. Actual consumer/current-bundle and local audio-byte checks, natural speech clarity/timing, critical-speech/source/master QA, actual runtime caller wiring, portrait presentation, channel-specific pedagogy and production admission remain separate unfinished work. No general prose, factual lesson or finished channel capability is implied by these arithmetic pixels.
