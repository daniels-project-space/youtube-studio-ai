# Data inserts — exact quantities and faithful bar geometry

12 September 2026. Partial progress on backlog item 61, not whole-module or channel qualification. No paid model calls, R2 writes, thumbnail changes or publication.

## Baseline and root cause

The actual exported gate at `b7175fd` accepted all three corruptions below. Integer-part and rounded-value credit confused related numbers with equal numbers:

| Spoken source | Incorrect rendered claim | Before | After |
| --- | --- | --- | --- |
| Returns are ten point two percent. | 10.9% | Accepted | Rejected |
| The bank held two million dollars. | $2.9 million | Accepted | Rejected |
| The change was two percent. | -2% | Accepted | Rejected |

These are actual subgate counterexamples, not a claim that every later final-master check would pass them. The planner also selected only digit-bearing sentences, so fully spoken quantities never reached it. Curve checks stripped signs and magnitude words and admitted arbitrary curves with a single anchor. In the real renderer, settled numbers were rounded to two decimal places, spaces before magnitude words disappeared, negative bars grew in the positive direction, and zero received an invented minimum bar length.

The old 19/19 legitimate and 181/181 adversarial director calibration is historical evidence only. Its narration/topic/channel files in `/tmp` are absent, so that exact corpus has **not** been requalified. Its digit-only sentence selection and distant mutations (`max * 7919 + 13`) missed the new failures. Do not replace that missing comparison with the passing tests below.

## Connected changes and design reasoning

- Move the title quantity parser to `numericClaims.ts` and use it in both production title callers and the insert planner, anchors, displayed-number checks, curve range and strict-manifest projection. Remove the older duplicate insert parser. Exact coefficient/decimal-place keys establish numeric equality; floating-point approximations are only geometry/legacy manifest values.
- Admit fully spoken numeric sentences to the existing director. Keep channel parameters, source-attribution and reviewed-manifest requirements, palette, spacing, overlap and retention/storage routing intact.
- Require exact quantities instead of granting integer-part or rounding credit. Exempt zero only in the existing axis-label context, not a hero claim or bar.
- Preserve legacy financial aliases `MM`, `mn` and `T`. Review caught an intermediate implementation classifying their digits as opaque identifiers; six positive/corrupt real-block cases now cover these aliases.
- Preserve signed/scaled curve anchors; require two anchors when a curve exists. The existing 2% geometry tolerance is symmetric for negative and positive ranges. This does not establish factual intermediate series points.
- Keep the renderer's final display string exactly as admitted. Preserve magnitude spacing during animation, use a shared zero origin for signed bars, and give zero zero length. No render-quality, resolution, codec or channel-template downgrade.
- Preserve an ambiguous possibly-paid planner error through the actual block to engine classification. Never turn it into successful empty output or an automatic second purchase.

Alternative considered: ask the planner/judge to repair every numerical mismatch. That adds paid requests and still leaves deterministic rendering corruption undetected. Shared exact parsing plus renderer invariants removes duplicate logic without a new provider call. Semantic unit/claim association must remain independent; this parser is not a factual judge.

The [ONS bar-chart guidance](https://service-manual.ons.gov.uk/data-visualisation/chart-types/bar-charts) supports encoding bars from a zero baseline. The signed geometry follows that principle without forcing the line-chart domain to zero. [Remotion's transparency requirements](https://www.remotion.dev/docs/transparent-videos) match the existing PNG → VP8/`yuva420p` render path. The footage-review skill prompted inspection of actual frames and alpha composites, not acceptance from successful encoding alone.

## Verification evidence and limits

- `insertExactNumericPipeline.test.ts` runs the actual block and all its gates through **33 numeric cases**, plus ambiguous-paid-outcome preservation. Six exact retained Investory narration sentences receive valid displays, corrupt displays and corrupt anchors; the remaining cases cover magnitude aliases, signed ranges/bars, zero policy and one-anchor curves. Only planner/render/storage/filesystem boundaries are controlled. Accepted rows reach the existing storage namespace with preserved timing/palette; rejected rows never render or upload. This is wiring evidence, not new director creativity evidence.
- Existing displayed-number, integrity, director-retry and series tests pass. The integrity test now imports actual functions instead of extracting and compiling a source fragment that enshrined integer-part acceptance.
- All **149** title-number regression pairs still pass after consolidation; title/source/candidate tests remain part of the full release gate.
- The actual React renderer test checks five exact settled representations, magnitude spacing, negative/positive origin and zero width.
- Three **real 1920×1080, 7.008-second** VP8/alpha clips were rendered locally at the unchanged production settings. The first completed encode survived a contact-sheet quoting error; extraction was repaired without rerendering it. The other two completed normally. No model rendered these declared diagnostic inputs.
- Independent inspection covers **27 alpha-composited samples**, at 0, 0.5, 1, 1.6, 2.3, 4, 6, 6.6667 and 6.9667 seconds per clip. Entry/exit, exact settled values, spacing, signed geometry, contrast and bounds are visible. The solid preview background is diagnostic, not invented channel footage. Raw-decoder sheets were also retained but cannot establish alpha behavior.
- The review found no blocking defect in this diagnostic scope. The early negative counter briefly formats rounded zero as `-0%`; this pre-existing cosmetic issue remains explicit, not a claim of final presentation polish. Whole-film timing, audio, identity, collisions against real scene art and mobile/portrait variants remain unqualified.

The first full suite passed 681/682 tests and exposed a real disk-cache accounting omission in vision. The [separate cache review](VISION_DISK_CACHE_ACCOUNTING_REVIEW_2026-09.md) documents its deterministic reproduction and repair; the assertion was not removed. A new frozen full gate is running. An independent actual assembly already passed at 31.021995 seconds with four rendered segments and no warnings. Build/typecheck, changed-file lint and structural audits passed the prior checkpoint; final frozen results and deployments must be recorded separately.

**Frozen gate completed:** runtime commit `db1515913607a5088376ef80f26f1bee6b335f78` passes all **682 direct tests** and actual hermetic assembly (31.021995 seconds, 17,164.6 KiB, four segments, no warnings). Final build/typecheck and changed-file lint pass. All structural audits are at or below the unchanged baseline; convergence remains 118 fallbacks / 78 constants and inertness 23 optional parameters. The code graph is refreshed and ignored by Git/deployment. Documentation-only successors do not alter that tested runtime. Exact production deployment is still a separate, pending observation at this checkpoint.

Proof manifest: `test-fixtures/insert-exact-numbers/evidence.json`. Artifact hashes bind the physical renders to the reviewed files. The three clips and composite sheets are retained under its `media/` directory, excluded from Vercel inputs by the existing `test-fixtures/` rule. The manifest paths are repository-relative. These are diagnostic evidence, not production channel exports or an automated vision-service certificate; unlike the missing old `/tmp` corpus, their bytes survive this workstation's temporary files.

## Still open for item 61

Recover or transparently rebuild and freeze the real director calibration; compare legitimate and adversarial output in both directions. Extend malformed plan/field validation, exact citation matching (including short names), source/unit/claim association, reviewed-manifest precision beyond its existing numeric ABI, chart-point evidence, planner candidate coverage, identity-specific visual design and complete final-channel compositing. Known malformed director output can still yield a visibly logged empty optional data layer; required-layer semantics need their own repair. No whole-module completion is inferred.

Read-only follow-up probes make the next work concrete: `sourceSpoken` rejects the genuine citation “IMF” in “According to the IMF…” but accepts “World Bank” in “The world of bankers…”. The numeric-only gate also returns no rejection for “5%” against “Returns were two percent over five years.” These are unchanged subgate limitations, not evidence that complete final QA accepts those outputs. Fix citation token/entity identity and typed quantity/unit association at their respective contracts; do not disguise the missing semantic requirement by further tightening scalar equality or by rerolling the same planner until a convenient result appears.

The existing `EvidenceVisualValue` already carries `id`, `sourceId`, `narrationAnchorId`, `role`, `unit`, `display` and optional `label`. The insert handoff reduces planned marks to `number[]`, and `evidenceVisualManifestAllowsNumbers` checks membership across all reviewed values without those identities. A direct helper probe confirms that a reviewed x-axis `5 years` admits bare `5`; it cannot tell which unit the resulting mark displays. Preferred next design: bind rendered fields to the existing reviewed value IDs and narration anchors, preserve their unit/role/display through rendering, and test swapped units, axes, labels and anchors using full actual-block admission. This reuses an existing evidence contract and needs no extra research/model call; a second unconnected evidence module would duplicate ownership. It does not by itself solve non-strict free-narration semantics, which needs its own measured claim extraction or evidence handoff.
