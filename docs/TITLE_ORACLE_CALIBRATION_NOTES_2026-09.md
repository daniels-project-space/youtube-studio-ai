# Title-oracle calibration: source fidelity and channel range

This is an **adversarial fixture authored by a separate coding agent**, not owner-approved video titles, a historical replay, human preference ratings, or a measured creative improvement. It follows [the module hardening method](MODULE_HARDENING_METHOD.md) and [the title research protocol](TITLE_MODULE_RESEARCH_2026-09.md): attack the oracle in both directions before trusting it. No external provider calls were made to prepare this fixture.

Authorship erratum: the frozen JSON's `policy.labelsAre` incorrectly says “Human-designed.” The author was a coding agent. The immutable fixture bytes are retained to preserve the measured input/hash history; this note corrects the attribution without changing cases or labels after observing results. That policy metadata was never supplied to the judge.

## Scope and label boundaries

[The fixture](../test-fixtures/title-oracle-calibration.json) contains 12 two-candidate cases: five exact retained narration excerpts and seven clearly synthetic fact packets. Current identity from the retained baseline is not represented as historical identity. Source support means fidelity to the supplied packet, **not independent verification that a retained script's history, conservation science, financial attribution or medical claims are true**.

There are 14 `supported`, eight `contradicted`, and two `insufficient` candidate expectations. Identity is a separate `acceptable` / `violates` / `not_asserted` annotation. A fact-supported title is not automatically a strong title, a passing click-score candidate, or safe to publish. Unsupported guarantees and unresolved allegations are `insufficient`, not automatically `contradicted`.

| Case | Evidence / format | Boundary attacked |
| --- | --- | --- |
| c01 | Retained Inked Histories motion comic | Wet earth preserves; exposure to air threatens destruction. The excerpt includes the letter discovery. |
| c02 | Retained Chalk & Compound whiteboard explainer | Sales tax on spending is not income tax on earnings, despite overlapping words. |
| c03 | Retained Gratitude Springs guided meditation | A gentle bedtime practice is supported; a universal insomnia cure is not. |
| c04 | Retained Quiet Stoic narration | Explicit rejection of enduring mistreatment in silence cannot support that definition. |
| c05 | Retained Investory documentary | The stated same-input compounding comparison favors the earlier, not later, starter. |
| c06–07 | Synthetic incident / rescue chronicles | `47 died` and `47 survived` each have a valid source; negation decides, not a banned verb. |
| c08 | Synthetic watercolor lore | Investigating a disputed betrayal is supported; asserting it happened is not established. |
| c09 | Synthetic crime case record | An accused clerk's acquittal must not become a conviction or transfer another person's guilt. |
| c10 | Synthetic narrated lesson plus artifact facts | A completed 720-second lesson is 12 minutes, not 2 hours; the number 2 also appears as diagram count. |
| c11–12 | Same synthetic tax source and title pair; different identities | Creature personification violates the calm classroom brief but fits playful money theatre. The direct explanation remains acceptable in both. |

The last contrast deliberately has **no forced winner** in the theatre case. It must not manufacture a rejection of a useful searchable title to demonstrate a style reversal. These subjective fit labels need review if the real judge disagrees; they are not a universal ban on monsters, metaphor, direct answers or any channel family. The fixture does not test rendered visuals, opening fulfillment, multilingual output or actual audience response.

## Integrity and input separation

Only `inputs[i].args` and `inputs[i].candidates` may reach `judgeTitleCandidates`. Case IDs, labels, rationales, provenance and this document stay outside the model input. The candidate frames are neutral positional names. Five factual pairs begin with the supported candidate; five begin with the unsupported candidate. No historical final-title field, approved thumbnail headline or proposed answer enters the judge packet.

Every packet has an exact source-text digest and a label-free judge-input digest. Retained cases additionally bind fixture bytes, run ID, narration stage, full narration digest, and exact excerpt start/end offsets. `sourceCoverage` explicitly declares excerpts and their available full-source lengths; synthetic fact packets have no invented full-narration length. Duration facts in c10 are synthetic artifact metadata included in the shared packet, not a fabricated production duration connector.

Before replay, verify those hashes and offsets, allowlist the outgoing fields, and assert that `suggestions` and `competitorTitles` are the explicit frozen empty arrays. Corrupt a source byte, candidate byte, source binding and expectation/input boundary to prove that the replay loader rejects each. A digest is an integrity check, not semantic evidence.

## Bounded replay guidance

Use the existing exported `judgeTitleCandidates(args, candidates, runtime?)` seam and the same configured production model, not a new route. Confirm that no generation, description, competitor lookup or suggestion call occurs. Run each of the 12 pairs in original and reversed order, remapping returned indexes before scoring. Twenty-four judge calls cover both orders; optional repeated unchanged controls should be separately budgeted and identified. Do not dispatch any calls until the caller has enforced explicit call/spend ceilings and durable partial-failure usage receipts.

Validate the complete real judge response first: unique integer indexes covering every candidate, finite in-range scores, a valid grounding enum, and nonempty reasons. Report malformed-response failures separately from semantic mistakes. A synthetic response replay can test this parsing and routing, but cannot establish real judge accuracy.

Score factual confusion counts (`supported` / `contradicted` / `insufficient`), identity false acceptance/rejection, and order sensitivity separately. Read every false acceptance and every rejected valid alternative. Do not combine a false claim with a high click score into a passing average, require a specific winner when both candidates are acceptable, or treat predicted click scores as CTR. The supported-candidate count is not a generation-quality result.

Use these pairs only as **oracle test corruptions**. Never insert them as few-shot creative exemplars, reference answers, prompt hints or hand-authored outputs of a new-channel test. Actual generation comparisons must use the independently frozen real inputs and retain their own model/code/source receipts.

## Offline checks performed

All 24 final candidates pass the real `lintTitle` with the matching topic and source, including the ten factual corruptions. They range from 34 to 49 characters. This isolates semantic checking from easy formatting rejection and demonstrates why lexical lint alone is not an oracle. An initial draft classroom title triggered the existing colon rule; only that synthetic test candidate was rewritten, with no production lint change.

The fixture's 12 input hashes, 12 source-text hashes, five retained fixture/narration bindings and exact excerpt offsets were verified. The two identity cases use identical source and candidate bytes. Preparation used zero model calls and no production mutations. These checks establish fixture integrity and lint reachability only: **real model calibration remains unexecuted**.
