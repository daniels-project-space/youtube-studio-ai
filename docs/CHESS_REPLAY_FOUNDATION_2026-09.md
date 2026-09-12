# Chess replay: legal-state and native-visual foundation

12 September 2026. Development for goal items 160–163, **not a registered/admitted channel capability or completed module**. No text/image/TTS provider calls, R2 writes, GPU allocations, publishing or production deployment. The existing script producer and automated creator do not yet consume this replay.

## Real implementation

`buildChessReplay(source)` validates a bounded PGN mainline against independently supplied expected ply count and final FEN. The immutable trace records every before/after position, square, piece, capture, promotion, check and mate. Revalidation reconstructs the source; recomputing a forged trace's hash cannot make it acceptable. Source locator and rights note are provenance, not proof of licensing or authenticity.

The existing Episode Graph and Scene Manifest carry the complete trace and typed event references. Scenes cannot supply substitute board arrays. Admission enforces complete ordered source coverage, stable theme/orientation, readable dwell and stationary coordinates. The native Scene Compiler consumes those exact events through original vector pieces and frame-seekable motion, including coordinated castling, en passant and promotion.

The current bridge requires one event per scene and at least two scenes. One-move lessons, multiple narration sentences per move, and several plies inside one Story Spine beat need subsequent timing integration. Nothing is advertised in the catalog yet.

## Counterexamples repaired

- Actual native build failed to resolve the source alias. The Scene Compiler bundle now declares `@` while preserving existing Webpack resolution options.
- Setup games displayed move numbers from the replay array index. Labels now use the original FEN fullmove counter; both sides are tested.
- Independent review reproduced no-rook castling and phantom en passant, including an invented pawn during chess.js history reconstruction. The original setup is now validated **before** history reconstruction: correct king/rook homes, actual en-passant pawn/origin/target and clocks, followed by exact starting/final position comparison.
- Nominal 1.2-second intervals falsely failed floating-point subtraction. A narrow 1e-6 tolerance fixes that without accepting genuinely short scenes.
- Direct composition props could evade normal timing admission. Chess composition entry and the real render wrapper now reject gaps, overlaps, nonfinite/negative time and incomplete output before rendering.

Current-position checks do not prove arbitrary setups historically reachable. chess.js is a rules library, not a strategic evaluator; this contract supplies no best-move, evaluation-score or forced-mate-in-N authority. [Official documentation](https://jhlywa.github.io/chess.js/).

## Validation

- Final core: **68 cases**, including both independently reproduced phantom moves, all four castling rights, both en-passant colors, capture/promotion, checkmate, illegal/omitted/reordered moves, forged hashes and invalid source state.
- Scene integration: **14 corrupt handoffs rejected**, plus source→graph→manifest→renderer admission, both orientations, minimum dwell and setup labels.
- Actual render preflight: **six malformed inputs** reject before browser/encode and create no output.
- Initial native review: four actual 1920×1080/30fps clips — six-ply opening (360 frames), reversed castling (120), en passant (120), underpromotion (120). **48 sampled frames** cover before/mid-move/settled/final state for all twelve moves; one native-resolution opening frame was also inspected. Native AAC silence is not narrated-channel evidence.
- Final source-bound rerender: all four clips completed, and current source/video hashes were checked. [The retained outputs and receipts](../test-fixtures/chess-replay/README.md) preserve all 720 video frames and their timestamps exactly against the initially inspected candidates. No new visual qualification is inferred solely from an encoder exit code.
- Production build, final typecheck and scoped lint pass. Structural audits have no regression; audit baselines were not changed. The broad **689-file regression sweep and actual hermetic assembly passed**. Its initial discovery preceded the six-case preflight file and final core repair; all three final focused suites pass separately, not a claimed frozen 690-file sweep. The final scoped lint removes the one new unused-test warning; existing global warnings are unchanged.
- Local code graph updated: 22,483 nodes / 54,060 edges; it remains excluded from runtime/deployment. Exact production-scoped dependency audit passes with four moderate findings, zero high; the separate full development audit has four high findings in pre-existing packages. No package was upgraded except adding dependency-free chess.js 1.4.0 to both lockfiles.

Frozen core SHA256: `913a4dc465d63ceb81126d5ffbca6079bb453c7c71a5fb3b52764ae7e84c3a25`; core test: `69a5fb9a30c5299f6ff3e9b00a5a3ef18256e3544abffdd0c2501ba1ce97fe20`.

## Still required

1. Versioned producer registration, typed persisted artifacts, locked controls, recovery and a real source selector; no opaque/unconsumed outputs.
2. Existing `script_gen` source-bound integration and validation of the **current** narration before paid TTS, including reuse/translation and source/script fingerprint checks. No manually substituted narration in the automatic test.
3. Actual normalized TTS/Story Spine interval binding, supporting several sentences/plies per beat and legitimate pauses/chapters. No synthetic timing IDs or round-robin mapping in production.
4. Narrated native output, rights, QA/metadata, resume, module-order/overwrite tests and existing-format render parity; full call/cost/latency measurement. Zero generated visuals here is not a measured percentage saving against an already qualified chess route.
5. Qualified architect/Golden discovery and a new automatic channel without manual module selection or replacement outputs.

The [dependency follow-up](DEPENDENCY_AUDIT_FOLLOWUP_2026-09-12.md) preserves exact production/development scope and safe upgrade requirements. All other requirements remain in the [163-item backlog](GOAL_MODULE_AND_UI_HARDENING_BACKLOG_2026-09.md).
