# Reviewed claims before paid narration

## Reproduced gap

The shared `qa_script` module could approve narration that omitted a reviewed
editorial claim or changed its numbers. The existing deterministic packet check
ran only in `story_spine`, after paid speech synthesis. A passing craft critic
therefore did not prevent avoidable spending on text that the later source-binding
gate would reject.

The new actual-module regression reproduced that behavior before the fix:
`qaScript.run` returned approval when the reviewed numbers had disappeared.

## Shared boundary repair

`qa_script` now declares optional consumption of `editorialEvidencePacket` and
checks every reviewed claim against the complete narration before invoking the
paid critic. It uses the same sentence splitter as this narration implementation.
The claim text and numeric-anchor checks are shared with the existing timed
Story Spine validator, not a second independently evolving matching policy.

A missing, changed, split or malformed reviewed claim fails deterministically.
The module does not rewrite text, generate substitute evidence, approve a new
claim, or retry a paid model to conceal the mismatch. Valid input still needs
the existing independent craft critique. Packet-free legacy inputs retain that
same critic route and output contract.

The post-synthesis Story Spine check remains necessary: a text check cannot
prove measured audio, sentence timing, or the claim's attachment to a visual cut.
No new timing receipt or factual-production admission is manufactured.

## Evidence and limits

Eight focused test files passed with external networking disabled: actual
script/evidence/runner integration, critic response validation, timed evidence
binding, program-route runtime, module contracts, composition compiler and
capability catalog. The real runner executes the packet producer and script QA,
then stops before the existing `narration_tts` block on a bad claim. Its fixture
records zero critic calls and zero model cost for that refusal. Scoped lint passed.

The matching semantics remain the existing normalized claim/number-presence
policy. This is not semantic fact checking, proof that every sentence is sourced,
or a guarantee against contradictory extra prose. It does not authorize an
unreviewed packet, replace final media QA, or qualify an entire channel family.

No live provider requests, thumbnail tests/generation, GPU work, legacy channel
changes, publishing or production deployment were performed. The full MVP and
additive module-quality backlog remain active.

The production build also passed, including TypeScript and page generation.
Logs: `/tmp/studio-editorial-prepurchase-tests.log` and
`/tmp/studio-editorial-prepurchase-build.log`.
