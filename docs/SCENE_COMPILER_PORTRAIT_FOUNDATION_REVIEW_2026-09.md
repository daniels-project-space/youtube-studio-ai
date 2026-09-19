# Scene Compiler portrait foundation — held review

9 September2026, goal item176. **Implemented and locally reviewed foundation;
not a production-enabled portrait channel capability.** Existing ordinary
archetypes/designer, the production block's16:9 fence, receipt schema, QA and
children-supervision rules are unchanged.

## Scope and reasoning

The current Scene Compiler has reusable local primitives but assumes
landscape geometry. The smaller first change is a versioned native layout
profile in the existing renderer, not a new generation provider or a second
scene engine. `scene-layout/landscape-v1` retains the historical default and
accepted explicit16:9 sizes. `scene-layout/portrait-v1` requires explicit
selection and exactly1080×1920; it independently places its artwork, labels
and fictional-scenario disclosure. It does not crop or uniformly shrink the
landscape frame.

The renderer refuses unfinished factual-evidence and children portrait
grammars, unknown profiles/kinds, invalid/discontinuous timing, unsafe labels
and incomplete fictional-scenario declarations before browser/bundle work.
Unsupported evidence/children layouts remain unfinished requested work, not
a waived scope item. Three-line label wrapping preserves font size and fails
on unbreakable/oversized text rather than silently truncating it.

The renderer's actual bundle initially failed to resolve its existing
`@/engine/evidenceVisualManifest` import. A scoped Webpack alias now binds `@`
to the existing `src` directory while preserving other aliases. An explicit
installed-browser option permits local hermetic diagnostics without changing
the normal production browser selection.

Full-manifest preflight is memoized against manifest identity, profile and
dimensions in the React composition; the renderer entrypoint still validates
before browser/bundling. This avoids sorting and validating every scene on
every frame. Existing landscape composition logic otherwise stays unchanged.

## Real-render evidence and discovered defects

Final full proof: `/tmp/ysa-scene-portrait-proof-EJv81Z/results.json`; log
`/tmp/ysa-scene-portrait-verified.log`, exit0. It runs the real local renderer,
H.264 encoder, FFprobe, frame extraction and OCR with no provider, R2 or
production writes. Its six base renderer kinds are explicitly broader than
the Episode Graph schema; the fixture keeps that distinction visible. The
five fictional-scenario variants use schema-valid scenario fields.

- Native portrait1080×1920 and landscape1920×1080: each330 frames and exactly
  11.000000 seconds of video. Both containers end at11.050667 seconds because
  of silent AAC padding. The retained original landscape video has the same
  stream/container timing. The0.12-second mux boundary is pre-existing in
  `sceneCompilerBlocks.ts`, not a newly weakened portrait tolerance.
- All11 landscape PNGs match the original composition byte-for-byte.
- All11 encoded portrait label/disclosure cases retain every required word
  inside their declared regions. Fixed uppercase disclosure OCR uses only
  its actual uppercase alphabet; ordinary labels use unrestricted OCR.
  Actual missing and incorrect disclosure images are independently rejected.
- All26 sampled transition/start/end frames retain visible artwork. Visual
  review of an earlier nominally passing render found an opaque incoming
  background hiding the previous artwork at wipe start. Clipping the incoming
  background and artwork together fixed it. The retained before frame fails
  the new contrast oracle at15; the final matrix's minimum is147.

Retained failures: `/tmp/ysa-scene-before-bundle.log`,
`/tmp/ysa-scene-first-duration-assertion.log`,
`/tmp/ysa-scene-original-unrestricted-ocr.tsv`, and
`/tmp/ysa-scene-wipe-before-oracle.log`. Earlier cleanup warnings remain in
their logs; the final full proof did not emit that warning.

The full video proof precedes the final memo-only change. Its composition
SHA-256 is `f4be8839cc296148a8da128e79ebc51e35aceaf1bff0abf3a9987621338dd301`.
Final composition SHA-256 is
`c0fd657c861a532665e415448fc3cf0d8af548ec3557fd61d9891302733125f0`.
Actual post-memo three-line-label and two-character-garden PNGs are
byte-identical to the pre-memo stress images:
`/tmp/ysa-scene-portrait-proof-8193oH` versus
`/tmp/ysa-scene-portrait-proof-GYTwEm`. No full post-memo video matrix is
claimed by those targeted checks.

The implementation agent completed full nonincremental typecheck, focused
lint, existing renderer tests and new real-renderer caller tests. The latter
verify zero browser/bundle/render calls for rejected requests. The main agent
reviewed the runtime, profile and full proof script, independently reran the
new caller regression (`/tmp/ysa-scene-portrait-main-review.log`, exit0), and
inspected all11 final scenes, all26 transition samples and both post-memo
native stress images. These establish layout/readability/transition behavior,
not a completed narrated episode.

## Remaining integration gates

The current seeded charts/maps/cards/screens are simple illustrative layout
primitives, not topic-bound factual data, arithmetic steps or a real software
demonstration. Correct pixels and a disclosure cannot manufacture those
semantics. The existing `sceneKindFor` legacy mapping still defaults current
`opening`, `claim`, `observation`, `problem`, `experiment`, `choice` and `result`
beat kinds to diagrams; this discrepancy was not rewritten inside the layout
change. Explicit presentation binding and semantic validation are next work.

Before admission: finish those connectors, qualified factual/children layouts
where applicable, exact portrait receipt/QA geometry and legibility, actual
narration/captions/reveal binding, duration policy, planner selection, useful
UI/progress and a complete unfamiliar automatically created channel. A silent
11-second diagnostic is not a Shorts qualification, a channel-quality Golden
example or proof of learning effectiveness. No production release is claimed.
