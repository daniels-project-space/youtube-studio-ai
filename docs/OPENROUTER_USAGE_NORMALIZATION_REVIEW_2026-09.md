# OpenRouter reasoning accounting — reproduced, held repair

Status: **local targeted/integrated checks passed; not deployed**. This is an accounting prerequisite found while reviewing the remaining metadata admission envelope. It does not enable paid metadata, change a model/prompt/output ceiling, or qualify title quality. It is kept separate from the frozen Lo-Fi UI release.

## Actual defect and evidence

Graphify traces `openRouterChat` into `recordModelUsage` and the real metadata executor. The transport recorded `completion_tokens` as visible output and also recorded the older top-level `reasoning_tokens`. The generic accounting contract adds visible output and reasoning because native Gemini reports these separately. OpenRouter's completion total already includes reasoning. Its current nested `completion_tokens_details.reasoning_tokens` was not read at all.

The initial real-client HTTP fixture reproduces eight failures, including double-counted flat reasoning, ignored native breakdown and malformed details accepted as priced. `/tmp/ysa-openrouter-usage-before.log`. One unrelated initial harness assertion incorrectly expected an entirely silent client; it was corrected to test absence of the starvation warning specifically, before retaining that baseline. No application behavior was weakened to satisfy the test.

For the fixed response of 100 input tokens, 196 inclusive completion tokens and 189 reasoning tokens, the old flat-shaped path reports **$0.00151875**, versus **$0.00081** under the configured rates. The native-shaped path already prices the inclusive total correctly, but loses the reasoning breakdown/warning. These are simulated response/accounting amounts, **not actual provider spend, refunds, or an efficiency saving**.

Primary sources checked on 9 September:

- [OpenRouter usage accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting) documents the nested breakdown, native token counts and response-level charge. This repair requires no extra usage lookup.
- [OpenRouter reasoning guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) describes reasoning as billable output. Suppressing its display does not make it free.
- [Request limits](https://openrouter.ai/docs/api_reference/parameters#max-tokens) document the generated-token ceiling.
- [The pinned Gemini 3.7 Flash model page](https://openrouter.ai/google/gemini-3.7-flash) currently lists standard input/output rates matching the configured $0.75/$3.75 per million. The page also shows promotional and service-tier differences; a static rate is not permanent price authority.

## Narrow repair

Normalize only at the OpenRouter boundary. For a valid breakdown, emit `inclusive completion − reasoning` as output and reasoning separately. Accept the older flat shape; equal flat/nested counts are not duplicated, and conflicting counts are not silently selected. Read the same normalized count for the existing starvation warning. Other provider pricing semantics are unchanged.

Missing optional breakdown leaves the inclusive total undifferentiated. Invalid/conflicting detail preserves the priceable inclusive completion charge while marking the call incomplete, so paid continuation cannot treat it as fully reconciled. Invalid/missing completion totals remain unpriced. No guessed tokenizer, source truncation, generation replay, extra API call, request-quality reduction or historical-receipt rewrite is introduced.

## Validation and limits

The actual HTTP/client/accounting regression covers 20 native/legacy/missing/null/conflicting/malformed cases, original and inferred totals, unchanged request limit and exactly one dispatch. Related routing, schema compatibility, native-Gemini accounting and starvation regressions pass. Logs: `/tmp/ysa-openrouter-usage-{after,warning,accounting,routing,structured}.log`.

The actual metadata runner → selector → HTTP parser → checkpoint → authenticated lease query → production stage sink/mutation-handler test now covers both response formats. Each four-request fixture retains exactly $0.006 through stage persistence and zero-request restoration, with byte-identical immutable outcomes. Malformed reasoning retains the known $0.0015 first-call charge, blocks the judge, and repeats recovery without another provider purchase. HTTP/R2/database boundaries are fixtures, not live provider/Convex concurrency evidence. `/tmp/ysa-openrouter-usage-metadata.log`.

Scoped lint and root TypeScript passed again after the final malformed-shape cases. Frozen combined checkpoint `c2b5c80af2fdf90c5d46178da2ca0e2899d0bd75` is being validated at `/tmp/ysa-usage-held-check-D6ngME/repo`; its full direct test sweep is still running. Build, typecheck, zero-error lint, unchanged/improved structural audits, defect proof and actual hermetic assembly have completed successfully. Assembly: `/tmp/assembly-smoke-tcMm58/bk_smoke_2_loudnorm.mp4`, 31.021995 seconds at 1920×1080. Logs use `/tmp/ysa-usage-held-` with tests, typecheck, lint, build, audit, defect-proof and assembly suffixes. No production promotion is claimed.

### Real retained-response check (no new generation)

A read-only scan validates every saved request/response SHA and unique provider ID across 63 live experiment files: **66 responses**, all with native nested reasoning, no flat reasoning and no invalid bindings. Their response-reported cost, original configured accounting and normalized configured accounting each total **$0.1895565**. Therefore the earlier pilot total is **not** affected by the flat-shape overcount. Historical artifacts remain unchanged; response-reported charges are not a separate invoice audit.

`scripts/verify-openrouter-usage-replay.mts` then runs all 66 exact historical HTTP request/response pairs through the **actual repaired client and accounting scope**. It verifies exact outgoing request bytes, immutable response SHA, one intercepted dispatch per response, unchanged charge, and **30,341 reasoning tokens** that now reach the breakdown. Result: `/tmp/ysa-openrouter-usage-retained-replay.log`, zero live requests and zero historical writes. The first ESM diagnostic loaded a separate accounting-scope instance and observed zero counters; it was corrected to use the same CJS/alias module identity as the transport, with an explicit one-accounted-call assertion. No production code or oracle expectation was loosened for this diagnostic repair.

The offline replay script was added after the frozen checkpoint above; it has its own successful execution and scoped lint check. The old benchmark's independent reservation calculator also still duplicates a supplied flat reasoning field; that conservative over-reservation is an explicit follow-up, not silently rewritten historical evidence. Full release gates and live runtime verification remain required before deploying the accounting repair.

The metadata envelope remains open: bound full repeated inputs and the complete seven-call retry graph, reserve/recheck the allowed cost before purchase, bind current provider price authority, and version the frozen contract. At the currently configured rate, the existing 16,200 maximum generated tokens alone imply $0.06075 before repeated full-source input. A seven-times-short-pass constant is still not an adequate bound. No paid classification or deployment permission was changed.
