# 06 — The Pipeline Architect

> The intelligence that AUTO-COMPOSES a per-channel content pipeline (which modules,
> in what order, with what params) by understanding the market + niche + the available
> module capability catalog, then hands a deterministic profile-driven Director to execute.
>
> Research date: June 2026. Sources cited inline.

---

## NOW

Pipelines are chosen by a **family → archetype → splice/override** chain:

- `src/engine/archetypes.ts` — `ARCHETYPES: Record<string, Archetype>`. Each archetype
  (`lofi-ambient`, `narrated-essay`, `crime-narrative`, `shorts`, `meditation`) carries a
  **hardcoded ordered** `pipeline: PipelineEntry[]` (block list + default params) and a
  `template` letter (A|B|C|D|E). Pure data, no block imports — safe for builder + UI.
- `src/engine/designer.ts::designPipeline(opts)` — deterministic backbone:
  `family → FAMILIES[family].archetypeKey → ARCHETYPES[...]` clone, then **splices** length /
  footage / crosspost / shorts_spinoff entries and emits `{ pipeline, available, warnings }`.
  `available:false` when the family's visual engine isn't built → saved as DRAFT.
- `src/engine/architect.ts::architectPipeline(input)` — an **LLM pass** that proposes ops
  on the current pipeline, applied deterministically per-op with an incremental
  `validatePipeline` gate (a graph-breaking op is rejected alone; the rest still apply),
  plus `enforceInvariants()` — **code-owned** cross-param coupling the LLM never has to
  remember (narration pacing → script word budget; ElevenLabs v3 → `voiceTags`; data-viz
  layer → `dataRich` script; `length_check` band follows script target).
- Modules are **opt-in per channel** (channel carries only the blocks it runs) and are
  becoming **self-describing Mastra tools** with a capability contract.

**Limits:** the *menu* is fixed (5 archetypes); market signal does not drive composition;
the architect edits a pre-seeded list rather than composing from the full module catalog;
"which format wins in this niche" is a human decision, not an input.

---

## AFTER

A **Pipeline Architect** that composes a pipeline *de novo* from market + catalog:

1. **Reads niche + market signals** (demand, competitor format mix, outlier formats, CPM,
   trend direction) via a `marketIntel` tool → a structured `NicheBrief`.
2. **Reads the module CAPABILITY REGISTRY** — every module is a self-describing tool
   (`description` + `inputSchema` + `outputSchema` + tags + `produces`/`consumes` +
   `relationships`). The catalog is the menu; archetypes become *priors/templates*, not
   the only options.
3. **Composes a validated DAG** of modules + params (LLM planner emits structured JSON;
   deterministic validator runs structural checks; `enforceInvariants` owns cross-param
   coupling) → a `ChannelProfile`.
4. **Hands the frozen profile to the deterministic Director** (`designPipeline`/Director
   stays dumb + reproducible; the Architect is the only "smart" step, run once at channel
   build / on explicit re-architect).

Reliability: archetype = a *retrieved prior* seeded by niche-format match; LLM picks/orders
modules but **never** invents block names (enum-constrained to the registry); a static
validator (node existence, edge/type compatibility, acyclicity, orphan detection, required
params) is the rejection boundary; **human-approve** the proposed profile before first run.

---

## HOW LEADERS DO IT

**Planner–executor split (the dominant pattern).** Separate a powerful "planner" LLM that
emits a multi-step plan from a cheap deterministic "executor" runtime. LangChain's
plan-and-execute / LLMCompiler streams a **DAG of tasks** (tool + args + deps), a Task
Fetching Unit schedules by dependency, a Joiner re-plans or finishes — avoids calling the
big LLM per tool, enables parallelism (~3.6x). This maps 1:1 to *Architect plans the DAG once*
→ *Director executes deterministically.*
(https://www.langchain.com/blog/planning-agents)

**Typed DAG composition at planning time.** ToolWeave represents each tool as a typed graph
node; the LLM emits the composition graph as structured JSON; the runtime validates
(acyclicity, type compatibility, no unresolved refs), topo-sorts, runs parallel groups, and
**re-plans a repair sub-graph on failure** — +24pt over single-tool, +12pt over ReAct.
(https://clawrxiv.org/papers/2026.00002)

**Deterministic compile + structural validator.** PlanCompiler: planner gets the *typed node
registry* + task, emits a JSON plan (node selections, param bindings, edges); a validator runs
**seven structural checks** (node existence, edge validity, type compatibility, acyclicity,
orphan detection, input arity, required-param presence) **before any execution**; only
validated plans compile to runnable code. Key insight: static analysis catches *structural*
errors by construction; *semantic* errors need human review / tests / repair loops.
(https://arxiv.org/pdf/2604.13092)

**Tool RAG / capability retrieval (scales the catalog).** Don't dump every tool into context —
semantically retrieve the relevant subset first. RAG-MCP: cut prompt tokens >50% and **3x'd**
tool-selection accuracy (43% vs 14%) by retrieving top-k tools before prompting.
(https://next.redhat.com/2025/11/26/tool-rag-the-next-breakthrough-in-scalable-ai-agents/ ·
https://www.emergentmind.com/papers/2505.03275). Capability cards/metadata + a `relationships`
graph re-rank co-used modules (Wunderland Capability Discovery, Agistry capability-matching).

**Supervisor/router over self-describing primitives (our stack's idiom).** Mastra routing /
supervisor agents pick which primitive to call, in what order, with what data, **purely from
each primitive's `description` + `inputSchema`/`outputSchema`**; delegation hooks
(`onDelegationStart/Complete`) let you modify/reject; `requireApproval` / `suspend()` give
human-in-the-loop. (https://mastra.ai/docs/agents/supervisor-agents) — but for *content
production* the path is mostly known, so **plan-once → deterministic execute** beats a
free-running router (Mastra's own guidance: "Workflows when the path is known in advance").

**Reliability frontier.** Constrained decoding/JSON-schema gives *structural* validity only;
semantic param errors hit **16–27%** and are structurally invisible (confident hallucination
in required fields). Surround the LLM with a control layer: validator → typed retry → fallback
router → audit log → human queue; restrict actions to an **enum allowlist** so a hallucinated
block name throws before a human ever sees it.
(https://tianpan.co/blog/2026-04-15-semantic-validation-llm-outputs ·
https://www.kuzmanko.com/insights/stop-treating-llm-output-as-a-promise ·
https://agentengineering.org/articles/structured-outputs-are-doing-more-work-than-most-teams-realize/)

---

## TOOLS / PATTERNS

| Pattern / Tool | What it gives the Architect | Brittleness | Source |
|---|---|---|---|
| Planner–executor (LLMCompiler) | Plan DAG once, execute cheap+deterministic, re-plan via Joiner | Serial if no DAG; planner cost | langchain.com/blog/planning-agents |
| Typed DAG composition (ToolWeave) | LLM emits typed graph; validate→toposort→parallel; repair sub-graph | LLM must know type signatures | clawrxiv.org/papers/2026.00002 |
| Deterministic compile + validator (PlanCompiler) | 7 structural checks as the rejection boundary; only valid plans run | Semantic (param-choice) errors slip through | arxiv.org/pdf/2604.13092 |
| Tool RAG / RAG-MCP | Retrieve top-k modules by niche intent; 3x selection acc, -50% tokens | Retriever recall; stale embeddings | redhat / emergentmind 2505.03275 |
| Capability cards + relationship graph | Self-describing modules, co-use re-ranking | Card quality = selection quality | Wunderland / Agistry docs |
| Mastra supervisor/router + createTool schemas | Routing from `description`+in/outSchema; hooks + `requireApproval` | Free-running router less reproducible | mastra.ai/docs/agents/supervisor-agents |
| GNN/LLM plan verifier | Independent accept/reject + node/edge risk localization | Verifier itself can be fooled by plausible plans | arxiv.org/pdf/2603.14730 |
| Enum-allowlist + Pydantic/Zod plan model | Hallucinated block/action throws pre-human | Doesn't catch valid-but-wrong values | dev.to objective-validation-protocol |
| **vidIQ MCP** | Outliers, niche keyword vol + competition, trending-now, fast-risers — in-MCP, no scraping | Credits; per-call cost (5+/call) | vidiq.com/mcp |
| **OutlierKit API/MCP** | Niche-wide outlier scan from 1 seed (1k–5k outliers), channel format/length read, similarity, keyword vol+RPM, `scan_niche` content-gap | Paid (Pro/Max); v1 rate limits tuning | outlierkit.com/resources/api · /mcp-server |
| **YouTube Data API + Apify Niche Intelligence** | Raw views/velocity/duration-type + Gemini relevance/trend/opportunity scoring, emerging-trend flag | Quota; Apify is search-result-scoped | apify.com/trend_wizard/youtube-niche-intelligence |

---

## IMPLEMENTATION (our stack)

**Stack:** Mastra (Director/supervisor + modules as `createTool` catalog) → `ChannelProfile`
output → Convex storage. Trigger.dev runs the Director. Builds/restarts in background.

### 1. Module capability registry (the menu)
Every module already a Mastra tool — extend each `createTool` contract so it is the
authoritative capability card:
- `description` (LLM-readable: what it does + when to use), `inputSchema`/`outputSchema` (Zod;
  these are the *typed edges* — `outputSchema` of A must satisfy `inputSchema` of B).
- Add metadata the Architect needs: `produces: string[]` / `consumes: string[]` (artifact
  kinds → DAG edges), `tags`, `relationships: string[]` (co-use boost), `cost`/`latency`
  hints, `requiresFamily?`, `formatFit: ('long'|'short'|'loop'|'meditation')[]`.
- Build a **`buildCapabilityRegistry()`** that reflects over the registered tools → a pure
  data catalog (same posture as `archetypes.ts`: importable by builder + UI, no block imports).
  This is the single source the Architect and `validatePipeline` both read; archetype block
  enums derive from it (no drift).

### 2. `marketIntel` tool → NicheBrief
A Mastra tool wrapping **vidIQ MCP and/or OutlierKit** (both expose MCP — drop straight into
the Mastra catalog) + YouTube Data API fallback. Output schema =
`NicheBrief { demand, competitionDensity, cpmBand, trendDirection, dominantFormat:
'long'|'short'|'loop', outlierFormats[], avgWinningLengthSec, hookPatterns[] }`. Cache in
Convex (paid credits). This is the new input `designPipeline`/Architect never had.

### 3. The Architect (plan-once, smart step)
`architectChannel(niche, family?, operatorOpts) -> ChannelProfile`:
1. `marketIntel(niche)` → NicheBrief.
2. **Tool-RAG retrieve** candidate modules from the registry by NicheBrief intent +
   `formatFit` (keeps prompt small, +accuracy). Seed an archetype as a *prior* by matching
   `NicheBrief.dominantFormat` → nearest archetype template (reuse `ARCHETYPES`).
3. LLM planner (structured output, **block name = enum over the registry**) emits a
   `ProposedProfile { entries: {block, params, dependsOn[]}[] }`. Reuse-first prompt: prefer
   existing modules over proposing gaps.
4. **Deterministic validation gate** (extend `validatePipeline` into a PlanCompiler-style
   checker): node existence (in registry enum), edge/type compatibility (`produces`⊇
   `consumes`), acyclicity, orphan detection, required-param presence. Reject invalid op →
   typed-retry with the error, max N, then fall back to the archetype prior.
5. `enforceInvariants()` (already code-owned) runs last — cross-param coupling stays in code,
   not the LLM.
6. Emit `ChannelProfile` (frozen pipeline + params + provenance: NicheBrief snapshot +
   model + validator report).

### 4. Human-approve + Director handoff
Surface the `ProposedProfile` for one-click **approve** before first run (Mastra
`requireApproval`/`suspend()` on the architect tool, or a Convex `status:'proposed'` →
`'approved'` flip in the UI). On approve, write the frozen `ChannelProfile` to Convex; the
**Director consumes the profile verbatim** — no LLM at run time, fully reproducible. Add a
`reArchitect` action (re-runs steps 1–4) so refreshed market signal can re-compose, gated by
the same approval.

### 5. Reliability invariants (don't hallucinate the pipeline)
- Block names enum-constrained to the registry (PlanCompiler/allowlist) — unknown block can't
  exist in the plan.
- Validator is the only gate to "runnable"; everything else stays DRAFT (matches today's
  `available:false`).
- Provenance + audit on every profile (NicheBrief hash, validator report, op-by-op log).
- Optional independent **plan verifier** pass (cheap model) scoring the DAG before human review.
- Keep `enforceInvariants` in code (proven pattern) — LLM proposes *structure*, code owns
  *coupling*.

---

## TOP 3 MOVES

1. **Make the catalog the menu, not the archetypes.** Ship `buildCapabilityRegistry()` that
   reflects over the `createTool` modules into a pure-data capability catalog
   (`produces`/`consumes`/`tags`/`formatFit`/`relationships`); derive block enums + the
   validator's node set from it so there is one source of truth. Archetypes downgrade to
   *retrieved priors*.

2. **Add the missing input: a `marketIntel` tool → `NicheBrief`** wrapping vidIQ/OutlierKit MCP
   (+ YouTube Data API), cached in Convex. This is what lets the Architect "understand the
   market" and pick format (long vs short vs loop) and winning length from data instead of a
   hardcoded family map.

3. **Turn `architect.ts` into a plan-once PlanCompiler.** Tool-RAG-retrieve candidates →
   enum-constrained structured-output planner emits a typed DAG → deterministic 7-check
   validator (existence/edge-type/acyclicity/orphan/required-param) with typed-retry +
   archetype fallback → `enforceInvariants` → frozen `ChannelProfile` → **human-approve** →
   deterministic Director executes verbatim.
