# Research: Orchestration Patterns for Director-Agent + Tools-per-Module + Per-Account Profiles

**Date:** June 2026
**Goal:** Inform migration of our YouTube-video-generation studio (Convex + Trigger.dev + Mastra) toward a "Mastra tools-per-module + Director orchestrator agent + per-account profiles" architecture, where a Director agent reasons about which module tools to call, heavy tools run as durable Trigger.dev tasks, state lives in Convex, and everything is customized per channel/account.

Our target shape (validated by the research below): **Director agent decides → module exposed as a tool → tool triggers a durable Trigger.dev task → state in Convex → per-channel profile threaded via runtimeContext.**

---

## 1. Mastra orchestration patterns (current, June 2026)

**Key finding: `AgentNetwork` / `.network()` is DEPRECATED.** The idiomatic Director is now a **Supervisor Agent** — a normal `Agent` with subagents/workflows/tools attached, invoked via `agent.stream()` / `agent.generate()`. Same multi-agent coordination as `.network()` but with simpler API, better control, and easier debugging.

- **Supervisor agents** — [mastra.ai/docs/agents/supervisor-agents](https://mastra.ai/docs/agents/supervisor-agents). Attach subagents via the `agents` property; the supervisor uses its own `instructions` plus each subagent's `description` to decide when/how to delegate. **Maps directly to our Director.** Our modules become either subagents or (better, for deterministic single-step modules) plain tools.
- **Agents/workflows auto-convert to tools** — [mastra.ai/docs/agents/using-tools](https://mastra.ai/docs/agents/using-tools). Mastra converts each entry in `agents` to a tool named `agent-<key>` and each `workflows` entry to `workflow-<key>` (using the workflow's `inputSchema`/`outputSchema`). **This is the exact "module-as-tool" mechanism we want** — a Director with `tools: {...}`, `agents: {...}`, `workflows: {...}` and one object key per module.
- **Agent vs Workflow for composition** — [mastra.ai/guides/concepts/multi-agent-systems](https://mastra.ai/guides/concepts/multi-agent-systems). Decision table: **Workflows** when the path is known in advance (deterministic graph); **Supervisor agents** when the task needs dynamic delegation (open-ended). They compose: "a supervisor can delegate to a workflow for a task with fixed internal structure." → **Takeaway for us:** the Director is a supervisor (dynamic ordering of modules), but a fixed module-internal pipeline (e.g. script→tts→render) is best as a Mastra Workflow exposed as one tool.
- **Delegation hooks** — `onDelegationStart` (modify/reject a delegation, inject per-channel prompt), `onDelegationComplete` (`context.bail()` to stop, feed back results), `messageFilter` (cap context), `onIterationComplete`. Configure in `defaultOptions` so they apply to every call. **Use these for our guardrails** (e.g. reject a render before script approval; bail on cost overrun).
- **Background subagents** — long-running delegations dispatch as background tool calls; use `streamUntilIdle()` so the stream stays open until they complete. Relevant because our render/voice modules are slow.
- Reference guide: [Build a research coordinator with supervisor agents](https://mastra.ai/guides/guide/research-coordinator) — canonical supervisor+subagents+delegation-hooks+scorer example to copy.

---

## 2. Agent-orchestrated media/content pipelines (open source)

The dominant shape is **`input → script → assets → voice → subtitles → render → publish`**, almost always with a central **orchestrator/task service** plus **config-driven provider selection**.

- **MoneyPrinterTurbo** (~85k★) — [github.com/harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo), [DeepWiki](https://deepwiki.com/harry0703/MoneyPrinterTurbo/3-system-architecture). MVC, central `TaskService` orchestrator coordinating LLM/Voice/Material/Subtitle/Video services; Redis or in-memory task state; 13+ LLM providers swapped via `config.toml`. **Gets right:** provider-as-config-swap (two lines in `config.toml` to change model) — exactly our "config-as-data" goal. **Gets wrong for us:** orchestrator is a hardcoded sequential `task.start()` — no agent reasoning about *which* steps to run; not durable beyond Redis state.
- **ShortGPT** — [docs.shortgpt.ai](https://docs.shortgpt.ai/). LLM-oriented "video editing language" + asset sourcing (Pexels) + neural TTS. Decomposition by editing primitives. Glue-heavy, not modular-tool-contract-driven.
- **script2vid** — [github.com/boyaloxer/script2vid](https://github.com/boyaloxer/script2vid). **Closest to our target.** Autonomous Observe→Orient→Decide→Act loop; **per-channel settings, OAuth tokens, content prompts, strategies**, each channel with its own workspace/calendar/schedule (`channels/<id>/content_prompt.md`). Multi-perspective critic (3 parallel reviewers). **Copy:** the per-channel folder/profile model and the content-prompt-as-file pattern.
- **faceless-gen** — [github.com/KTS-o7/faceless-gen](https://github.com/KTS-o7/faceless-gen). LangGraph `StateGraph` (5 nodes), **persona-as-data**: `personas/<name>/personality.md` + `character.md`, swap via `ACTIVE_PERSONA` env. **Copy:** persona = narrator voice + visual character, stored as data not code.
- **youtube-automation-agent** — [github.com/nilpatel7530/youtube-automation-agent](https://github.com/nilpatel7530/youtube-automation-agent). Cooperative multi-agent hierarchy (Content Strategy → Script Writer → SEO → Production → Publishing), SQLite workflow-state persistence. Clean agent-per-stage decomposition.
- **mesin-cuan** — [github.com/algojogacor/mesin-cuan](https://github.com/algojogacor/mesin-cuan). `--profile shorts|long_form`, per-channel retention analytics, two-step render→upload-queue split (avoids bulk-upload flagging). **Copy:** the render/publish decoupling and profile flag.

**What they get right:** clean stage decomposition; config/persona-as-data. **What they get wrong:** hardcoded sequential orchestrators (no dynamic tool selection), weak durability (in-memory/Redis/SQLite, no replay), tight glue between stages. Our Mastra-Director + Trigger.dev approach fixes exactly these gaps.

---

## 3. Tool/capability contract design (module-as-tool checklist)

Sources: [Anthropic — Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents), [MCP tools concept](https://github.com/modelcontextprotocol/docs/blob/main/docs/concepts/tools.mdx), [MCP Schema Design 2026](https://yaw.sh/mcp-in-production/mcp-schema-design/), [AgentPatterns MCP server design](https://agentpatterns.ai/tool-engineering/mcp-server-design/), [MCP Tool Design Part 4](https://bishrulhaq.com/posts/mcp-tool-design-agents-get-right-schemas-errors-and-structured-output).

**Module-as-tool contract checklist (apply to every Mastra module tool):**

1. **Name = `verb_noun`, snake_case, <32 chars.** The name is the first thing the Director reads (`generate_script`, `render_video`, not `script`).
2. **Description is the firing predicate — answer 3 things:** (a) what it does, (b) **when to use it / when NOT to** ("Use after the script is approved; do NOT use for thumbnails"), (c) what it returns if non-obvious. Self-contained: domain context, return shape, selection signals all stand alone. (Anthropic: 1–5 realistic examples raise tool-selection accuracy 72%→90%.)
3. **Input schema enforces, not just describes** (Zod for Mastra). Use `enum`/`Literal` over free strings, defaults to shrink the surface, `required` to force context-gathering, `additionalProperties: false`. Accept user-shaped values (`"11:00"` not `660`); flat objects over deep nesting.
4. **Declare an output schema** (`outputSchema`). Return **receipts, not prose** — structured `{ assetId, url, status, cost }` so the Director (and downstream tools) consume `structuredContent`, not regexed sentences. Use IDs in the same format the next tool's input expects (composability).
5. **Error contract teaches, doesn't punish.** Return tool-level errors (MCP `isError:true` / Mastra error result), not protocol crashes, and include **the constraint + the violation + recovery context** so the agent can self-correct without a human.
6. **Atomic + focused.** One module = one concern. Keep the Director's visible tool set small (<~15); for large surfaces use Mastra **tool search** (appends schemas, preserves cache).
7. **Annotations for gating:** `destructiveHint` / `idempotentHint` / `readOnlyHint` so the harness can require confirmation or parallelize safely.
8. **Do NOT embed orchestration in descriptions** ("after this, always call X") — agents don't follow procedural scripts reliably. Make each tool independently correct; enforce ordering in the Director's instructions or in the workflow, or remove now-invalid tools from context.

---

## 4. Per-account / multi-tenant agent customization

**Mastra's `runtimeContext` (formerly `RuntimeContext`, now also `RequestContext`) is the canonical answer** — a type-safe dependency-injection channel for per-request config. **One agent definition serves all channels; no N code paths.**

- **Dynamic configuration** — [mastra.ai/docs/server/request-context](https://mastra.ai/docs/server/request-context), [blog: Dynamic Agents](https://mastra.ai/blog/dynamic-agents). `instructions`, `model`, `tools`, `memory`, processors, scorers can each be a `DynamicArgument<T>` — a function resolving from `requestContext.get(...)` at runtime. Set `requestContext.set('channel-id', ...)` (or populate it in server middleware from headers) before `generate()`/`stream()`.
  ```ts
  const director = new Agent({
    instructions: ({ requestContext }) => buildDirectorPrompt(requestContext.get('channel-profile')),
    model: ({ requestContext }) => requestContext.get('tier') === 'pro' ? premiumModel : baseModel,
    tools: ({ requestContext }) => toolsForChannel(requestContext.get('channel-profile')),
  })
  ```
- **`requestContextSchema`** validates context (Zod) at the start of `generate()`/`stream()` — throws `MastraError` *before* any LLM call if a channel profile is malformed. Use this as the hard gate on profile shape.
- **Tools read the same context** — `execute: async ({ context, runtimeContext }) => { const apiKey = runtimeContext.get('apiKey') }`. **This is how per-channel OAuth tokens / API keys / style get into module tools** without baking them in.
- **Config-as-data, not code** — Mastra's **stored agents + prompt blocks** ([PR #12776](https://github.com/mastra-ai/mastra/pull/12776), [PR #12896](https://github.com/mastra-ai/mastra/pull/12896)) let instructions be reusable, versioned, DB-stored blocks with conditional rules and `{{variable}}` interpolation, resolved per request-context. Updating a block propagates immediately to every agent referencing it. **Maps to: store each channel profile in Convex; resolve the Director's instructions from the profile at request time.** The Agent Builder explicitly "supports multi-tenant agent workflows with RBAC."
- **OSS confirmation:** script2vid (`channels/<id>/`), faceless-gen (`personas/<name>/*.md` + `ACTIVE_PERSONA`), mesin-cuan (`--profile`) all independently land on **profile-as-data files keyed by channel** — same principle, less type-safety than runtimeContext.

**Pattern for us:** Channel profile (style/persona/constraints/voice/tokens) lives as a Convex document. On each request, load it → `requestContext.set('channel-profile', profile)` → Director's dynamic `instructions`/`model`/`tools` and every module tool resolve from it. Zero per-channel code.

---

## 5. Durable-execution coexistence (agent decides, durable task executes)

**The canonical 3-layer separation** (consistent across Restate, Temporal, Inngest, Mastra docs):
1. **Durable orchestration** — stable record of session/step/approval/retry/completion (our: Trigger.dev + Convex).
2. **Agent cognition** — model calls, planning, tool *selection* (our: Mastra Director).
3. **Tool execution** — side-effecting ops wrapped with **idempotency keys, result persistence, retry metadata** (our: Trigger.dev tasks).

- **Mastra ↔ Trigger.dev, official** — [trigger.dev/docs/guides/example-projects/mastra-agents-with-memory](https://trigger.dev/docs/guides/example-projects/mastra-agents-with-memory), [github.com/triggerdotdev/examples/mastra-agents](https://github.com/triggerdotdev/examples/tree/main/mastra-agents). Pattern: each Mastra agent call lives **inside** a Trigger.dev `task({ id, retry, run })`; chain with `task.triggerAndWait()`; shared Postgres for memory. **This is our exact wiring** — Director's heavy module tools call `someTask.triggerAndWait()`.
- **durableclaw** ([github.com/ainakwalamonk/durableclaw](https://github.com/ainakwalamonk/durableclaw)) — **best reference repo for our stack.** Mastra (agents + `AGENT.md` per agent) + Trigger.dev (durable tasks, "failed pipelines retry from the failed step, not the beginning") + Postgres + Express. Planner→Reviewer pipeline. Shows the precise file layout: `mastra/` registry, `tools/`, `pipelines/tasks/<task>.ts` per stage, `triggerAndWait` chaining.
- **Mastra native durability** — [Reference: DurableAgent](https://mastra.ai/reference/agents/durable-agent), [examples/durable-agents](https://github.com/mastra-ai/mastra/tree/main/examples/durable-agents). `createDurableAgent` (local resumable streams, Redis-backed), `createEventedAgent` (fire-and-forget on built-in workflow engine), `createInngestAgent` (distributed). Resumable streams via `observe(runId, offset)` replay cached events after disconnect. **Use for the Director itself** if a run must outlive a request; **but heavy media work still belongs in Trigger.dev tasks**, not the agent loop.
- **The idempotency law (universal across all engines)** — [Particula](https://particula.tech/blog/durable-execution-ai-agents-temporal-inngest-restate), [Prompt20](https://blog.prompt20.com/posts/agent-serving-infrastructure/), [Inngest](https://www.inngest.com/blog/ai-agents-inngest-durable-steps): (1) LLM outputs recorded once and replayed, never re-called; (2) workflow code deterministic; (3) **every side-effecting tool call must be idempotent** — durable retries multiply tool calls, so a render/upload/publish tool *must* dedupe on a `request_id`/idempotency key (else duplicate uploads, double charges). Restate narrows this (exactly-once invocation) but you still design write tools to be replay-safe. **For us:** every Trigger.dev task that writes (render output, YouTube upload, Convex mutation) takes a Convex-derived idempotency key.
- **Human-in-the-loop = resumable signals**, not ad-hoc chat state. Inngest `step.waitForEvent`, Mastra `suspend()`/`resumeNetwork()`/tool-approval propagation. **Our approval gates** (review before publish) should be durable suspend/resume, surfaced up the supervisor's delegation chain.

---

## What to copy / what to avoid

**Copy:**
- Mastra **Supervisor Agent** as the Director (NOT deprecated `.network()`); attach modules via `agents`/`workflows`/`tools` → auto-converted to `agent-*`/`workflow-*` tools.
- **runtimeContext + requestContextSchema** for per-channel profiles; profile-as-data in Convex; dynamic `instructions`/`model`/`tools`. Zero per-channel code paths.
- **Module-as-tool contract** (§3 checklist): firing-predicate descriptions, Zod enums/defaults, output schemas returning receipts, teaching error contracts, idempotent/destructive hints.
- **Trigger.dev `task` + `triggerAndWait`** for every heavy module; **idempotency keys on all write tools**; failed-step (not full-pipeline) retry.
- Deterministic intra-module pipelines as **Mastra Workflows exposed as one tool**; dynamic cross-module ordering left to the Director.
- Delegation hooks (`onDelegationStart`/`Complete`, `messageFilter`) for guardrails; durable **suspend/resume** for review-before-publish.

**Avoid:**
- `AgentNetwork`/`.network()` — deprecated; migrate to supervisor.
- Embedding orchestration order in tool descriptions ("then call X") — unreliable; put ordering in Director instructions/workflow.
- Hardcoded sequential orchestrators (MoneyPrinterTurbo `task.start()` style) — defeats dynamic tool selection.
- Non-idempotent write tools under durable retry — causes duplicate uploads/charges.
- Running heavy media work inside the agent loop — push to Trigger.dev tasks; keep the agent for cognition only.
- Per-channel code branches / N agent definitions — use one agent + runtimeContext.

## Three reference repos to read in depth
1. **[ainakwalamonk/durableclaw](https://github.com/ainakwalamonk/durableclaw)** — Mastra + Trigger.dev + Postgres starter; our exact stack and file layout (`pipelines/tasks/*`, `triggerAndWait`, per-agent `AGENT.md`).
2. **[boyaloxer/script2vid](https://github.com/boyaloxer/script2vid)** — autonomous per-channel YouTube agent; profile/persona/OAuth-per-channel model + multi-critic review loop.
3. **[triggerdotdev/examples — mastra-agents](https://github.com/triggerdotdev/examples/tree/main/mastra-agents)** — official Mastra+Trigger.dev wiring: agent-call-inside-task, `triggerAndWait` chaining, shared memory, Zod-validated custom tools.

Supporting deep-reads: [Mastra durable-agents example](https://github.com/mastra-ai/mastra/tree/main/examples/durable-agents) (DurableAgent/EventedAgent/InngestAgent), [Restate durable-agents pattern](https://docs.restate.dev/ai/patterns/durable-agents) (tools-return-receipts), [Anthropic writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents) (tool-contract authority).
