# Title quantities — complete numbers, not matching fragments

12 September 2026. Numeric-presence repair within the title rework; not a claim that factual verification or creative quality is finished. No paid calls, uploads, thumbnail changes or model/configuration changes.

## Cause and design

At `9c38b01`, `numberVariants` stripped both commas and decimal points, turning `10.2` into `102`. Its phrase matcher then accepted components of larger quantities: `1` inside `1.5` or `one hundred`, `2` inside `two million`, and `19` inside `nineteen-seventeen`. Conversely, it rejected legitimate spoken decimals, large quantities and hyphenated years in retained narration.

The existing visual-insert parser is not an interchangeable fix: it admits rounded/truncated values and chart baselines. Copying that contract would preserve false title approvals. Graphify traced the defective helper to both `lintTitle` and `titleOpeningSignal`; both now use one shared exact-number parser, and both old helpers are removed.

Unicode's [number-symbol documentation](https://cldr.unicode.org/translation/number-currency-formats/number-symbols) distinguishes decimal and grouping separators by locale. Its [English spellout rules](https://github.com/unicode-org/cldr/blob/main/common/rbnf/en.xml) distinguish cardinal, decimal and year readings. Those support retaining punctuation semantics and covering spoken years rather than removing separators indiscriminately. This implementation is **not** a complete CLDR parser or multilingual number-understanding certification.

The parser consumes complete English quantities, including signed decimals, cardinal compounds, magnitude words, compact numeric magnitudes and common year readings. Decimal arithmetic is exact string/BigInt arithmetic, never chart-style rounding. Ambiguous comma forms, fractions and times retain literal matching only; their components cannot establish an unrelated smaller quantity. Alphanumeric identities such as `WW1` or `H3` are not scalar numbers and remain the source-aware semantic judge's responsibility, not a match against any occurrence of “one” or “three.” Units, comparative scale, timing, causality and factual truth still require semantic/evidence review.

## Before/after evidence

The unchanged test inputs were run against the actual `9c38b01` implementation (loaded from Git and transpiled with the installed TypeScript runtime) and the replacement. Both production callers are exercised for every pair.

The compact result record, scope limitations and SHA-256 bindings to the exact parser and tests are retained in `test-fixtures/title-number-grounding/results.json`.

| Check | Before | After |
| --- | ---: | ---: |
| Valid claims accepted from retained narration | 20 / 29 | 29 / 29 |
| Altered claims rejected against the same passages | 22 / 39 | 39 / 39 |
| Additional edge cases and independent Intl formatter pairs correct | 39 / 81 | 81 / 81 |
| Total correct | 81 / 149 | 149 / 149 |

The real-source portion uses **16 exact passages from four channels**, located by stable prefixes in the unchanged, hashed title-baseline packets: Inked Histories, Gratitude Springs, The Quiet Stoic and Investory. Expected quantities were annotated explicitly. Finance-source presence is **not** endorsement of historical return claims or their citations. These are targeted counterexamples and regression cases, not an unbiased estimate of fleet-wide title quality.

`metacraftNumberGrounding.test.ts` covers decimals, precision beyond floating-point equivalence, negative values/currency, cardinal scales, hyphenated years, ordinal digits, punctuation, partial-word rejection, opaque identities and literal-only ambiguous forms. The separate Intl formatter sweep changes numeric presentation and injects a nonzero decimal tail to prove rounding cannot buy acceptance.

The actual `metadataOptimized` → title engine → semantic review → finishing → sealed UI receipt path accepts a valid `10.2` title against “ten point two.” Two altered sources are rejected before the permissive test judge or ancillary description/comment requests can run. Model responses and external reads are controlled seams here, **not** new model-quality evidence. Existing tests continue to replay four saved model-authored winners and their provisional/alternate handling.

A read-only sweep found no new numeric rejections among 88 saved title candidates from the prior paid comparisons. Most have no scalar digits (nine use `WW1`); this is compatibility evidence only. It does not certify their complete promises. A warm local timing sample of 200 checks across the five retained narrations (2,592–10,040 characters) measured a 0.386 ms median and 2.515 ms p95. This is not end-to-end latency or a cloud billing estimate; no additional provider request is introduced.

## Verification and remaining work

Focused number, source-handoff, candidate-admission, title-quality and gate tests pass. The full local production-readiness run passed **680 direct tests**, followed by actual hermetic assembly: 31.021995 seconds, 17,164.6 KiB, four rendered segments and no warnings. Final production build, changed-file lint and typecheck pass; all structural audits remain at or below the unchanged baseline. Convergence remains 118 fallbacks / 78 constants; inertness remains 23 optional parameters. The local code graph is updated and excluded from deployment inputs. Exact cloud release observations remain a separate gate; this is not paid media-render or publication qualification.

Still open: independent factual evidence, unit/claim association, alias calibration, unsupported locale spellout/notation, semantic handling of fractions and scientific notation, meaningful 15–30-second opening fulfillment rather than requiring every figure in the first beat, stronger creative candidates and owner-calibrated judgment. The broader module, UI, comic, Salad, healer and retention backlog remains active.

## Verified release

Revision `b7175fd0b410f3230371c347d46e0d027cc26f4d` passed cloud CI `34688413490`: all 680 direct tests, actual 31.02-second assembly (16,675.8 KiB), and unchanged audit bounds. Canonical Convex was ready at 10:39:24 UTC; Trigger version `20260912.21` deployed at 10:41:21 UTC. The Vercel provider API confirms `dpl_5qd7xkHG93oziqo7GfJL496R5KGF` READY / production, bound to `youtube-studio-ai.vercel.app` at that exact revision. The canonical `/api/health` returned the same SHA. These observations do not qualify paid creative outputs beyond the report's stated corpus.
