# Metadata request envelope: evidence before paid activation

Status: researched and transport coverage expanded; production numerical admission remains **held**. No route, model, request cap, paid flag or frozen invocation is changed.

## What the existing evidence actually covers

The 66 retained live responses were re-audited with request/response SHA checks and unique provider IDs. They contain 457–1,362 input tokens per call (50,337 total), 380–1,630 completion tokens, and $0.1895565 in response-reported charges. Serialized messages range from 1,660 to 6,341 bytes; whole requests from 1,915 to 6,596 bytes. The 36 structured-output samples add an 817-byte schema. None exceeds its output ceiling; none carries an explicit unit-price fence. All report Google AI Studio as the provider. These are small-packet observations, **not a safe maximum for long-form source or an invoice audit**.

The actual full-source integration test now exercises two much larger packets through `runPipeline` → the real metadata block → selection/checkpoint/parser/transport → actual authenticated lease and stage-write handlers. Only network/storage/database boundaries are fixtures. Both force the complete seven-call sequence: generator/judge twice, package twice, comment. The HTTP boundary asserts the exact JSON-escaped full source in every call, including its decisive final fact; recovery then restores the immutable decision without another call or outcome rewrite.

- Long-form source: 118,863 characters/bytes; actual serialized messages 123,540–124,815 bytes.
- Multilingual source with Japanese, Arabic, accented Latin, emoji, quotes and newlines: 82,863 characters / 126,063 bytes; actual messages 137,938–139,213 bytes.
- Both pass the existing lease, receipt, malformed-usage, resume and stage-handler integration suite. Log: `/tmp/ysa-metadata-full-source-transport.log`.

The fixed 1,000-input/200-output usage fixture and $0.012 test envelope deliberately remain labelled synthetic. They prove source transport and recovery, **not tokenization, pricing, quality or affordability** of these larger packets. New tests cannot be presented as 14 real model evaluations. The separate previous 644-test held gate predates these added cases; the expanded suite has its own targeted pass.

## Current provider contract, checked 9 September

[OpenRouter's parameter contract](https://openrouter.ai/docs/api_reference/parameters#max-tokens) bounds generated tokens, not the prompt's dollar cost. Its [provider price filter](https://openrouter.ai/docs/guides/routing/provider-selection#max-price) limits prompt/completion unit rates per million tokens; the `request` field refers to providers with per-request pricing, not a universal total-dollar ceiling. A unit-rate filter is only one part of admission.

[The current model listing](https://openrouter.ai/google/gemini-3.7-flash) and the public [endpoint inventory](https://openrouter.ai/api/v1/models/google/gemini-3.7-flash/endpoints) show a 1,048,576-token context and 65,536 maximum completion tokens. All six listed endpoint variants have no separate published prompt-token cap. Current standard rates are $0.75/$3.75 per million input/output, with different Flex/Priority rates and a promotion. Treating one unguarded static rate as a permanent maximum is unsafe. No endpoint/tier was selected or changed during this inspection.

[Context compression](https://openrouter.ai/docs/guides/features/message-transforms) can remove or truncate source messages. It is not an acceptable way to make the source-grounded title budget look smaller. No compression, source truncation or model downgrade was enabled.

At the currently listed standard rate, reserving seven *entire model contexts* with the existing combined 16,200 output ceiling would be $5.553624: `7 × 1,048,576 × 0.75 / 1e6 + 16,200 × (3.75 − 0.75) / 1e6`. This is a conservative calculation under that rate/context assumption, **not an approved cap**; it would be disproportionate to the observed small calls. Conversely, an observed maximum or byte/character heuristic is not an authoritative billing bound. Neither shortcut is activated.

## Reuse the actual integration seam

`ModuleCostContext` and `maxCostUsdFor` already exist. `configuredMaxCostUsd` only narrows an absolute paid cap. `pipelineCompiler` and preflight pass the exact entries/index without a runtime store; `runner` also supplies the current store before checkpoint admission. The metadata runtime's performance/evidence packet is frozen later. Therefore a smaller quote cannot simply read whatever partial source happens to be available during compilation, nor omit later packet/schema/candidate framing. Graphify's focused explanation confirms the compiler, validator, runner and remote-admission callers.

Next implementation requirements remain:

- One versioned request/rate/input contract used by compiler, runtime admission and the actual request path; no second generic cost engine.
- A defensible input-token bound or provider-enforced equivalent for the exact full packet, including schema, subsequent candidate/rejection framing and frozen performance/evidence. Missing admission evidence holds rather than silently truncating or guessing.
- Preserve the approved model/quality and existing output ceilings; reject before claims/HTTP when the legal remaining sequence cannot fit the allowance. Keep already-priced receipts durable and unknown operations held.
- Explicitly reconcile actual response-reported charges versus configured estimates across price tiers; today’s 66 matching receipts do not prove every future endpoint will match the static table.
- Version the paid contract and handle old frozen invocations explicitly before enabling it. Existing full-source, title identity/grounding, lease and cost-recovery tests remain independent acceptance requirements.

This advances the input/request evidence and avoids an unnecessarily expensive blanket reservation. It does not remove the title rollout hold. UI, other module and weekly Salad/R2 work continues independently of provider credits.
