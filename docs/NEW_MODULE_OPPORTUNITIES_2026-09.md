# Item 160: executable-code opportunity audit

Read-only research, 12 September 2026. Repository: `/tmp/ysa-next-bcb`; observed HEAD `9cbab32b161a067de80afcacec6db25129459bba`. No application, backlog, production, provider, or paid-render changes. These are proposals, not shipped modules or qualified savings. Read items 160–163 in `docs/GOAL_MODULE_AND_UI_HARDENING_BACKLOG_2026-09.md` and queried existing Graphify before focused caller inspection; Serena was unavailable.

## Baseline that makes the proposals genuinely new

- Actual registration is `registerAllBlocks()` in `src/engine/blocks.ts:47`, not the UI catalog. Inspected registered capabilities already include quiz, documentary/casefile, timeline/map/chart, music loops, story/learning planning, synthetic scenarios, image generation, narration, captions, comic/whiteboard, and scene rendering. The three proposals below need new executable producers absent from that registration, not renamed cards.
- `SCENE_KINDS` in `src/remotion/sceneCompiler/SceneCompiler.tsx:26` is map/chart/diagram/panel/puppet/screen. `ScreenVisual():554` renders seeded rectangles and browser chrome, not a recorded application. `TownVisual():577` renders seeded buildings/agents, not a numerical experiment. Neither can validate actions or state transitions.
- `src/engine/syntheticScenario.ts:1` explicitly says its fictional thought experiments are NOT simulations. `syntheticScenarioWritingDirective():114` prohibits inventing measured outcomes. A real solver must remain separate from that fictional contract.
- `EpisodeVisualStateSchema` in `src/engine/episodeGraph.ts` admits existing illustrative/factual evidence fields; `DeterministicSceneSchema:185` and `SceneManifestSchema:208` carry timed scenes, not legal-game, experiment, or execution traces. New data needs a typed, hash-bound renderer handoff; putting text into `action` will not implement it.
- Reusable actual output path: `sceneCompiler` in `src/trigger/blocks/sceneCompilerBlocks.ts:138` calls `renderSceneManifest()` in `src/lib/sceneCompilerRender.ts:45`, mixes narration/music, probes final media, and records an owner/channel/run-scoped R2 asset. It currently admits only audited 1920×1080 16:9 output (`resolveDimensions():58`), not all formats automatically.

## Ranked shortlist

### 1. Rules-backed chess replay and explanation — recommended first

**New channel range:** opening walkthroughs, classic-game replays, endgame demonstrations, rule explanations. This is actual legal board state, not an illustrated history story or a question-and-answer quiz. Other board games require their own rule adapters and are not included in the initial claim.

**Missing capability:** a provenance-bearing PGN/FEN source packet and allowed-corpus selector; a deterministic `chess_replay` producer yielding every ply's before/after FEN, move, captures/check status and stable IDs; a trace-to-narration binding; a board renderer consuming the exact trace. No best-move, evaluation-score or forced-mate-in-N claims without a separately qualified analysis engine. chess.js supports parsing, legal moves, position and game-state checks, but deliberately is not chess AI: [official chess.js documentation](https://jhlywa.github.io/chess.js/).

**Smallest real integration:** add one versioned replay contract/producer and a typed chess scene variant to the existing Scene Compiler, not a second renderer/upload stack. Reuse `narrationTts` (`src/trigger/blocks/narratedBlocks.ts:1190`), `storySpine` (`src/trigger/blocks/storySpineBlocks.ts:11`), `episodeGraph` (`src/trigger/blocks/episodeGraphBlocks.ts:368`) and the actual media output path above. New pre-TTS validation must bind supported narration claims to replay events; a post-timing adapter must preserve ply order and reading time. The current `story_spine` runs after TTS and cannot itself save the cost of a bad pre-TTS script. Channel controls: board/piece identity, orientation, highlight style, replay pace and maximum supported length, with lock enforcement.

**Rejecting quality oracle:** known independent PGN/FEN fixtures include castling, en passant, promotion, checks and captures. Reject illegal/truncated/skipped/duplicated plies, wrong side to move, unsupported "best" claims and narration referring to the wrong event. Independently check actual rendered square/piece positions and orientation at those events—not only the producer's self-reported FEN. Native video review checks move dwell, arrows, legibility and narration synchronization. Resume must reuse the accepted trace and audio.

**Cost and risk:** zero generated visual assets; ordinary text/TTS plus local SVG/browser encoding and small immutable trace storage. Versus an illustrated N-position workaround, potentially replaces N paid image generations; there is no currently qualified legal-replay solution to assign a measured savings percentage. Lowest implementation risk of these three. Main risks are source rights/provenance, authoritative commentary and readable dense games.

### 2. Verified experiment lab — a real simulation, not an AI scenario

**New channel range:** visual physics, mechanics and engineering experiments; controlled "what changes if…" demonstrations. Start with one bounded model family such as ideal one-dimensional elastic collisions; electrical, orbital or fluid solvers are separate future qualifications, not immediate generic support.

**Missing capability:** typed experiment specification (units, initial conditions, model version, assumptions), a real deterministic solver producing sampled states/events and numerical receipts, an outcome-bound explanation bridge, and a state-driven experiment scene. Current `visual_inserts` (`src/trigger/blocks/insertBlocks.ts:279`) displays supplied values; it does not compute experimental outcomes. Current fictional `synthetic_scenario` must not be relabeled as evidence.

**Smallest real integration:** reuse narration/story timing, Scene Compiler framing/render/upload, and existing chart presentation only where a new typed simulated-result contract honestly distinguishes model output from observations. Implement closed-form collision results first; if later using a numerical solver, lock timestep/tolerances and version. SciPy documents local-error control via absolute and relative tolerances; merely returning solver success is not a physical correctness oracle: [official solve_ivp documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html).

**Rejecting quality oracle:** independent analytical solutions, mass/unit validation and momentum/energy invariants; repeat the exact experiment with one changed input. Reject NaN, unstable/divergent trajectories, frame/time-unit mismatch, swapped control/treatment, invented numerical labels and narration claiming real-world measurements. Compare actual rendered event position/time with trace values, then integrated narration and explanations. Models must disclose idealizations and validity limits.

**Cost and risk:** zero image/video generation; local solver plus browser encode and normal narration. This adds correctness/range to the existing zero-provider scene renderer, so it is not automatically cheaper than that renderer. Potentially avoids generated-scene calls only when that is the measured comparison. Medium implementation/qualification risk: solver validation and clear boundaries dominate, not generation expense.

### 3. Execution-backed software lessons — show the real action/result

**New channel range:** programming demonstrations, browser-tool tutorials and reproducible debugging/data-workflow lessons. This is actual execution and capture, not decorative code-like panels or stock screen footage.

**Missing capability:** a pinned, allowlisted lesson recipe/environment; bounded execution/capture runner; an execution receipt containing input/version hashes, actions, result assertions, screenshots or clips and timing; then an evidence-bound tutorial scene. Start with trusted owned fixtures, not arbitrary model-authored host commands or third-party websites. A secure arbitrary-code service would be a separate substantial project.

**Smallest real integration:** Playwright is already a dependency (`package.json:58`); reuse it for actual DOM actions/captures, then feed durable artifact references into a new typed screen-capture variant of the existing renderer. Reuse narration/timing, framing/highlights, media retention and locks. Browser contexts provide test-state isolation, not permission to execute arbitrary untrusted code: [Playwright isolation](https://playwright.dev/docs/browser-contexts). Official Docker guidance warns about untrusted sites and the disabled Chromium sandbox when running as root: [Playwright Docker](https://playwright.dev/docs/docker). Captured videos must be finalized by closing their context and explicitly sized for the qualified output: [Playwright videos](https://playwright.dev/docs/videos).

**Rejecting quality oracle:** independently execute the lesson's declared expected result; assert real DOM/output state before capturing it. Negative fixtures include changed selectors, wrong result despite zero exit, stale output, truncated terminal, hidden important controls, clipped code and highlights on the wrong line. Require reproducible captures in the pinned environment, readable native footage and narration aligned with observed actions. No fabricated output or manually substituted recordings.

**Cost and risk:** zero generated screen images/video; actual browser/capture/encode CPU and normal writing/TTS remain. It replaces unreliable image-generation or manual recording work, not a measured existing automated tutorial route. Highest integration/security and maintenance risk of the three; selected applications change and must fail closed before costly downstream work.

## Shared real integration and proof requirements

1. Follow `Block`/`ArtifactRef` in `src/engine/types.ts:120`, actual `register()/registerManifest()` in `src/engine/registry.ts:18`, and `MODULE_CONTRACTS` in `src/engine/moduleContracts.ts:268`: versioned declared reads/writes, immutable input hashes, checkpoint ownership, independent recovery and cost receipts. No ambient optional store reads or generic "simulation" payload that the renderer ignores.
2. Extend only explicitly admitted schema/scene/route variants. Keep existing fictional and source-evidence semantics intact; do not overwrite another module's `sceneManifest` after it is sealed. Reuse the 16:9 audited output profile initially; new aspects need their own tests.
3. Add discovery only after proof: `ARCHITECT_TOOLBOX` in `src/engine/creative/architect.ts:76`, qualified catalog/admission via `src/engine/creative/creativeCapabilityCatalog.ts` and `adviseCreativeCapabilitySelection()` in `src/engine/creative/capabilityAdvisor.ts:130`, with real compiler obligations. Current catalog has only data story/editorial evidence/casefile/children's intake; a card alone enables nothing.
4. Qualify producer alone, deliberately corrupt handoffs, actual renderer pixels/audio, existing-format regression, recovery and measured calls/wall time. Then give the automated channel creator a genuinely new concept and an approved source corpus, without choosing modules, rewriting the script or replacing outputs after the run. Inspect full native output before granting automatic admission. Items 161–163 remain open until that succeeds.

Recommendation: implement the bounded chess replay route first. It has the smallest new producer, strongest independent state oracle, no GPU dependency and a visibly new channel family. Use it to prove the trace-to-narration-to-render contract before considering the broader solver or execution systems. Do not build a universal abstract simulator up front.

## Source fingerprints inspected

- `src/engine/blocks.ts`: `ee9f0160c1c2e6e51e9d8f4efbc3835b16b7d663ae11af8b76346b2dce57e39a`
- `src/engine/moduleContracts.ts`: `c6d8cf32a10fd2c0b640363d706b92286a1325ad461fd633428ff744d4c039fc`
- `src/remotion/sceneCompiler/SceneCompiler.tsx`: `73826f4915f99ba7e78618a76a570dc3fc846f1d674a5a36531d82e5117d4eef`
- `src/engine/syntheticScenario.ts`: `2c4125dcf223421824da4efd8324deac053f970efd6c0574685d0215cbad2d5a`
- `src/engine/creative/creativeCapabilityCatalog.ts`: `4594b7fcbc4909e544d62f28fcfb4af38b95e60e105593f03e34ffd453a9f98c`
