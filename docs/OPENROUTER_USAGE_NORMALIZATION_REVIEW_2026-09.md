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

Scoped lint and root TypeScript passed before the final added malformed-shape cases; the expanded regression passed afterward. Full frozen tests/build/audits and live release verification remain required before promotion. Existing immutable costs have not been recomputed; old charges require source/provider evidence before reconciliation. This does not change the previous pilot's historical recorded totals or claim that they match invoices.

The metadata envelope remains open: bound full repeated inputs and the complete seven-call retry graph, reserve/recheck the allowed cost before purchase, bind current provider price authority, and version the frozen contract. At the currently configured rate, the existing 16,200 maximum generated tokens alone imply $0.06075 before repeated full-source input. A seven-times-short-pass constant is still not an adequate bound. No paid classification or deployment permission was changed.
