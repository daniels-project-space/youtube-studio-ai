# Fresh title-judge holdout

[Fixture](../test-fixtures/title-oracle-holdout.json), version `title-oracle-holdout/v1`.

```text
SHA-256: 69d5f205d6a1c850cc681602269f405c2242084c1bf1fe972b0f2fd921ce82a3
Bytes: 19791
```

Six fresh pairs were authored by a separate coding agent from the reported **failure classes**, without inspecting the revised judge prompt. Exact sources, titles and labels were not shared with its editor. Record the prompt/code freeze before revealing or replaying the cases. Do not tune against this fixture and then continue calling it held out; freeze a new independent set for another iteration.

Authorship erratum: the frozen JSON's `policy.labelsAre` and `candidateOrigin` incorrectly describe human authorship. These are agent-authored expectations, not human or owner ratings. Retain the immutable bytes as measured and read the [provenance correction](../test-fixtures/title-oracle-provenance-errata.md); no case, source, label or score is changed by this correction. Provenance metadata never entered the judge prompt.

Every source and channel identity is explicitly synthetic. Four pairs distinguish a supported rhetorical device from a changed quantity, an invented event, missing story entities or a false consequence. Two evidence-led pairs distinguish an unresolved conclusion from a disproved claim while retaining valid plain titles. This is **English source fidelity and channel compatibility**, not real-video generation, creativity, virality, novel-channel end-to-end validation or external factual verification.

The 12 expectations comprise six `supported`, four `contradicted`, and two `insufficient`. Three factual controls appear first and three second. Supported titles are labelled compatible, not guaranteed strong performers. No particular winner or numerical click score is required. A missing material fact remains insufficient; explicit contrary evidence supports contradiction. Figurative expression does not itself add a literal event, but cannot excuse an invented entity or false number.

Only `inputs[i].args` and `inputs[i].candidates` enter the real `judgeTitleCandidates` call. Keep case IDs, provenance, expectations, reasons and this document outside model inputs. Candidate frames are neutral. Explicit empty suggestion/feed arrays prevent lookups. Each source-text hash and label-free input hash was verified, along with the input-field allowlist and candidate/index binding. No revised-prompt inspection, generator calls, judge calls or production mutations occurred during preparation.

Replay the frozen real judge with original and reversed candidate order, remapping indexes before comparison. Validate response completeness/schema separately from grounding and identity errors. Report per-case mistakes, false acceptance/rejection and order sensitivity; do not hide an error in an average score. Do not filter away a case or rewrite its labels after observing a result. If independent review finds a genuinely ambiguous label, disclose it and version the fixture rather than repairing the measured score silently.

Store results and source/model/prompt/usage receipts separately; the sealed fixture stays unchanged. These are adversarial test candidates, never production-title substitutions, generator exemplars or few-shot answers. Integrity checks do not establish real judge accuracy: replay remains pending.
