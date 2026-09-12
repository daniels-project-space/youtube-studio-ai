# Title publication normalization review

Date: 12 September 2026  
Scope: `src/lib/metacraft.ts` and the shared metadata finishing boundary.

## Defect

The former metadata finishing pass removed a channel-name prefix or suffix only
after `metacraft` had linted, ranked, fingerprinted, and selected the title.
That could leave the decision receipt and alternate title describing a different
string from the one persisted to the upload package. The mismatch was visible
to the run-stage UI as title drift and was unsafe for later learning.

## Repair

`normalizeTitleForPublication` is now the single deterministic rule for that
legacy cleanup. Every warm-start and generated candidate is normalized before
deduplication, linting, ranking, thumbnail-promise construction, and receipt
fingerprinting. The finishing boundary reuses the same rule as an idempotent
compatibility guard; it does not have a second title-mutation policy.

## Evidence

- The isolated normalization test covers prefix, suffix, channel-name escaping,
  generic-channel bypass, and whitespace handling.
- The real `craftMetadata` fixture sends `Inked Histories: …` through the
  generator seam. It verifies the selected title, saved decision title, and
  browser presentation all retain the same normalized value.
- The metadata finishing test retains its source-grounding regression, proving
  final title cleanup still cannot bypass the shared title gate.

## Boundary

This does not prove that a title is creatively strong or that a native YouTube
experiment has happened. It only ensures the title that is judged is the same
title handed to packaging, upload, thumbnail planning, and the learning ledger.
