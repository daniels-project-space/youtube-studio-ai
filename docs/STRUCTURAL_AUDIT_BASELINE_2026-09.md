# Structural audit baseline reconciliation — September 2026

The structural audit runner compares findings with a checked-in baseline and
fails on an increase. On 13 September the source at both `ae92f87` (the parent
of the H3 capacity work) and the current checkout produced the same counts:

| Audit | Findings | Why this remains open |
| --- | ---: | --- |
| `audit-inert-produces` | 68 | Mostly terminal receipts, human-facing advisory values, and gate evidence; paid findings remain candidates for explicit owner decisions. |
| `audit-unproducible-consumes` | 4 | Four specialised source/cinematic inputs are currently unaccounted for; their seed/provenance review remains open rather than being silently fabricated. |
| `audit-undeclared-store-reads` | 4 | Two `visualMatterReferenceAssets` reads are policy-protected helper branches; the metadata and Lo-Fi reads are existing declaration debt tracked for the typed-store cleanup. |

The previous checked-in values (67/3/2) predated source changes already present
on the parent commit. The baseline is therefore raised to 68/4/4 in the same
reconciliation commit. This does not waive the findings or claim they are
fixed; future source deltas still fail the audit, and the underlying cleanup
remains on the module-hardening backlog.

Verification: each audit was run independently, then `pnpm run audit` completed
with no regressions. No provider, database, storage, or production mutation was
performed.
