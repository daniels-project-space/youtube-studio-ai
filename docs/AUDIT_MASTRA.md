# Mastra Readiness Audit — youtube-studio-ai

Read-only audit. Determines Mastra-in-repo status, the canonical pattern Daniel already uses, the confirmed
current Mastra API (June 2026, `@mastra/core@^1.37`), and the recommended Mastra ↔ Trigger.dev ↔ Convex
topology for the "Mastra tools-per-module + Director orchestrator agent" migration.

---

## 1. Is Mastra already in the repo? YES — mature hybrid usage.

`package.json` deps (confirmed):
- `@mastra/core` `^1.37.1`
- `@mastra/langfuse` `^1.3.3` (tracing exporter)
- `ai` `^6.0.194` (Vercel AI SDK v6), `@ai-sdk/anthropic` `^3.0.81`, `@ai-sdk/google` `^3.0.80`
- `@trigger.dev/sdk` `4.4.6`, `@trigger.dev/build` `4.4.6`
- `convex` `^1.39.1`

**What exists today:**
- `src/agents/mastra.ts` — the seam. A `ROLE_CONFIG` map (producer/director/showrunner + film-crew roles),
  each becoming a **named `new Agent({ id, name, instructions, model })`**. A lazy `getBundle()` builds the
  `new Mastra({ agents, observability? })` instance ONCE (memoized promise). `agentJson<T>({ role, prompt, schema })`
  is the single entry point: it calls `agent.generate(prompt, { structuredOutput: { schema } })`, validates the
  result with a **zod** schema, and on ANY failure (bundle/runtime/API) **falls back to the existing REST helpers**
  (`geminiJson` / `claudeJson`). Mastra packages are **dynamically `import()`-ed** so a bundling problem is caught
  at the seam, never crashing the Trigger task at import time.
- `src/trigger/verifyMastra.ts` — a cheap `verify-mastra` Trigger task that imports + constructs `Mastra`/`Agent`
  in the cloud image to prove the bundle loads.
- `trigger.config.ts` marks `@mastra/core`, `@mastra/langfuse`, `@mastra/observability` as **`external`** (installed
  in the task image, not esbuild-bundled).
- Consumers: `src/engine/creative/{architect,crew,showBible,styleDNA}.ts`, `src/engine/critiqueLoop.ts`, and the
  block files `src/trigger/blocks/{lofi,intelligence,narrated}Blocks.ts` call `agentJson()`.

**What does NOT exist yet (the migration gap):**
- **No `createTool()` anywhere.** Mastra is used purely for agent *generation* (LLM calls with zod-validated output).
  There are zero deterministic Mastra tools and no tool-calling agent loop.
- **No Director-as-orchestrator.** The "director" role is just a *critic/judge* prompt — it scores candidates; it
  does not call tools or drive the pipeline. Orchestration is done by the **block-engine DAG** (`src/engine/runner.ts`,
  `blocks.ts`) executed inside Trigger tasks (`runPipeline.ts`).
- **No Workflows** (`createWorkflow`/`createStep`) — durable step graphs are currently Trigger tasks, not Mastra workflows.

So: Mastra is wired, proven to bundle, traced, and resilient — but only as a generation layer. The migration adds
the **tools** and the **reasoning Director** on top of an already-solid seam.

---

## 2. Canonical pattern across Daniel's stack

- **Vault** `mastra` service (names only): `MASTRA_DEPLOY_URL` (alias `MASTRA_BASE_URL` → `https://platform-agents.vercel.app`),
  `MASTRA_VERCEL_PROJECT_ID`. So there is a **standalone Mastra "platform-agents" service deployed on Vercel** — Mastra
  can run as its own Node/Vercel HTTP service in this stack, separate from any single app.
- Other `/home/ubuntu` projects (music-house, autostudio, rental-manager-v2, project-hub-app, dropship-ai) have **no
  `@mastra/*` in their `package.json`** — the only `@mastra` paths found were inside `music-house/node_modules`
  (transitive, not first-party usage). `/root` `@mastra` hits are all plugin/skill *templates*, not Daniel's code.
- **Conclusion:** youtube-studio-ai is the most advanced first-party Mastra adopter in the fleet. The canonical pattern
  to follow is the one **already in this repo**: dynamic-import + memoized `Mastra` bundle + zod-validated `agent.generate`
  + REST fallback + `external` in `trigger.config.ts` + Langfuse tracing. The fleet-wide Convex+Trigger conventions
  (below) are the integration substrate.

### Convex + Trigger.dev conventions in this repo (the substrate the migration must respect)
- **Trigger → Convex:** Trigger tasks build a `ConvexHttpClient` from `NEXT_PUBLIC_CONVEX_URL`
  (`src/engine/convexSink.ts` → `convexClientFromEnv()`) and call `client.mutation(api.X, …)` / `client.query(api.X, …)`
  using generated `convex/_generated/api`. Every block transition is persisted via `makeConvexSink()` →
  `api.runStages.upsertRunStage`. Run state lives in `api.runs.*` (`createRun`/`updateRun`/`getRun`).
- **Trigger → Trigger (orchestration today):** tasks fan out with `tasks.trigger("task-id", payload)` (fire-and-forget)
  and `someTask.triggerAndWait({...})` (durable wait for result). Examples: `runPipeline.ts` calls
  `renderBlockTask.triggerAndWait(...)`; `designChannel.ts` / `pipelineDoctor.ts` / `bundleBlocks.ts` use
  `tasks.trigger(...)`. **This is the existing "heavy work runs as a durable Trigger task" mechanism the Director must reuse.**
- **State is canonical in Convex; deploy is `convex dev --once` (NOT `convex deploy`) + Trigger CLI deploy**, Vercel for the UI.

---

## 3. Confirmed current Mastra API (mastra.ai, "Latest Version" = `@mastra/core` 1.x, June 2026)

### Tool — `createTool` (deterministic)
Source: https://mastra.ai/en/reference/tools/create-tool , https://mastra.ai/en/docs/tools-mcp/overview
```ts
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const weatherTool = createTool({
  id: 'weather-tool',
  description: 'Fetches weather for a location',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ weather: z.string() }),
  // current signature: execute receives the validated input data directly
  execute: async (inputData) => {
    const { location } = inputData
    // ...do work...
    return { weather: '...' }
  },
})
```
- Schemas accept any **Standard JSON Schema** lib (zod / valibot / arktype). zod is what this repo already uses.
- `strict: true` asks supported providers to match the schema exactly.
- A tool's `execute` may call APIs, DBs, agents, or **workflows** — i.e. arbitrary async code.

### Agent — `new Agent` with tools (reasoning)
Source: https://mastra.ai/en/docs/agents/overview , https://mastra.ai/en/docs/tools-mcp/overview
```ts
import { Agent } from '@mastra/core/agent'
export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  instructions: 'You are a helpful assistant. Use the tools to fetch data.',
  model: 'openai/gpt-5.5',          // 'provider/model-name' via Mastra model router; this repo uses google/* + anthropic/*
  tools: { weatherTool },            // map of tools the agent may call
  hooks: {                           // optional: run logic around every tool call (audit/guard/log)
    beforeToolCall: ({ toolName, input }) => {/* return {proceed:false,output} to short-circuit */},
    afterToolCall:  ({ toolName, output, error }) => {},
  },
})
```
Register in a `Mastra` instance: `new Mastra({ agents: { weatherAgent }, workflows, observability })`. Prefer
`mastra.getAgentById(id)` so the agent gets shared storage/logging/registry.

### Agent execution — tool-calling loop
Source: https://mastra.ai/en/docs/agents/overview (→ `/reference/agents/generate`)
```ts
const agent = mastra.getAgentById('director-agent')
const res = await agent.generate('Produce the next video for channel X')
// res: { text, toolCalls, toolResults, steps, usage }  — the agent loops tool calls internally until done
// .stream() for token streaming; structuredOutput: { schema } for zod-validated final object (already used here)
```
The agent **decides which tools to call, how many times to loop, and when to stop** — that is the Director "brain".

### Workflow — `createWorkflow` / `createStep` (durable, deterministic step graph)
Source: https://mastra.ai/en/docs/workflows/overview
```ts
import { createStep, createWorkflow } from '@mastra/core/workflows'
const step1 = createStep({ id:'step-1', inputSchema:z.object({message:z.string()}),
  outputSchema:z.object({formatted:z.string()}), execute: async ({ inputData }) => ({ formatted: inputData.message.toUpperCase() }) })
// compose with createWorkflow(...).then(step1)... ; supports suspend/resume/stream; register in Mastra({ workflows })
```

### Tools vs Agents vs Workflows (the distinction that drives the design)
| Primitive | Nature | Use when | In this migration |
|---|---|---|---|
| **Tool** (`createTool`) | Deterministic function, fixed I/O | Known operation: render, upload, query Convex, trigger a job | One tool **per module** (the building blocks the Director composes) |
| **Agent** (`new Agent`) | LLM reasoning loop over tools | Open-ended; steps unknown upfront; pick/sequence tools | The **Director** orchestrator (the brain) |
| **Workflow** (`createWorkflow`) | Durable explicit step graph | Steps known upfront, need data flow control + suspend/resume | Optional: encode the *fixed* render→upload spine if you want Mastra-native durability instead of the block DAG |

---

## 4. Recommended coexistence topology — Mastra ↔ Trigger.dev ↔ Convex

### The single clearest "who calls whom"
> **A Trigger.dev task is the durable host. Inside it, the Mastra Director agent runs (`agent.generate`) and reasons.
> The Director calls module *tools*. A lightweight module tool does its work inline and returns. A *heavy* module
> tool (render / upload / multi-minute job) does NOT do the work itself — its `execute` calls
> `heavyTask.triggerAndWait(payload)` to run the work as a separate durable Trigger.dev task, then returns that
> task's result (or a handle) to the Director. All state is read/written to Convex via `ConvexHttpClient`, exactly
> as `convexSink.ts` already does.**

So: **Trigger hosts Mastra; Mastra tools call Trigger tasks for heavy work; both touch Convex for state.**

```
Convex (scheduler / cron / mutation)
        │  tasks.trigger("director-run", { runId, channelId })
        ▼
Trigger.dev task  "director-run"   ← DURABLE HOST (long maxDuration, retries, checkpoints)
        │  const mastra = getBundle(); const director = mastra.getAgentById("director")
        │  await director.generate(goalPrompt)        ← THE BRAIN (reasoning loop)
        │        ├── tool: planVideo()      (light) → runs inline, writes api.runs/contentPlan via ConvexHttpClient
        │        ├── tool: writeScript()    (light) → inline LLM, returns object
        │        ├── tool: renderBlock()    (HEAVY) → renderBlockTask.triggerAndWait({...}) ──► Trigger task (ffmpeg/Remotion)
        │        └── tool: uploadYoutube()  (HEAVY) → provisionYoutubeTask.triggerAndWait({...}) ──► Trigger task
        ▼
Convex  (runs, runStages, videos, assets)  ← canonical state, read back by Director's next tool call
```

### Why this topology (vs the alternatives)
- **Director lives inside a Trigger task, NOT in a Convex action.** Convex actions have tight time/CPU budgets and are
  the wrong place for a minutes-long agent loop with heavy renders. Trigger tasks already give durability, retries,
  `triggerAndWait`, large `maxDuration`, and machine sizing — and the repo already runs the pipeline there.
- **Heavy tools delegate to Trigger via `triggerAndWait`, they don't render in-process.** This preserves the existing
  durable render/upload tasks (`renderBlockTask`, `provisionYoutube`, etc.), keeps the Director machine small, and means
  a render crash/retry is isolated from the agent loop. The tool's `execute` is just a thin adapter:
  `triggerAndWait` → map result to `outputSchema`.
- **Convex stays the single source of truth.** Tools read/write through `ConvexHttpClient` (reuse `convexClientFromEnv()`
  + `makeConvexSink`). The Director never holds canonical state in memory; it re-reads Convex between steps, so a
  task retry resumes cleanly.
- **Keep the resilient seam.** Build the Director with the same dynamic-import + memoized-bundle + REST-fallback shape as
  today's `agentJson()`, and add `@mastra/*` `external` entries (already present). Heavy tools should be **gated/idempotent**
  (writes are real — Trigger writes are irreversible like Hygglo), mirroring existing READ_ONLY_MODE discipline.

#### Tradeoffs / cautions
- `triggerAndWait` **cannot be called from inside another `triggerAndWait` sub-task** chain beyond Trigger's nesting
  rules — keep the Director as the top task and heavy tools one level down (matches `runPipeline`→`renderBlock` today).
- Mastra `external` packages must stay installable in the Trigger image (the `verify-mastra` task is the guard — extend it).
- If a portion of the pipeline is genuinely fixed-order (render→encode→upload), consider a **Mastra `createWorkflow`**
  for that spine and let the Director call it as a tool — but the current block-DAG already covers this, so workflows are
  **optional**, not required for v1.

### Minimal code templates

**(a) Module tool — light (inline), writes Convex:**
```ts
// src/mastra/tools/planVideo.ts
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { convexClientFromEnv } from '@/engine/convexSink'
import { api } from '../../convex/_generated/api'

export const planVideoTool = createTool({
  id: 'plan-video',
  description: 'Pick the next topic for a channel and persist a content-plan row. Use before scripting.',
  inputSchema: z.object({ ownerId: z.string(), channelId: z.string(), runId: z.string() }),
  outputSchema: z.object({ topic: z.string(), planId: z.string() }),
  execute: async ({ ownerId, channelId, runId }) => {
    const convex = convexClientFromEnv()
    const topic = await /* existing topicOptimizer logic */ pickTopic({ convex, ownerId, channelId })
    const planId = await convex.mutation(api.contentPlan.addPlan, { ownerId, channelId, topic })
    return { topic, planId }
  },
})
```

**(b) Trigger-task-as-tool adapter — HEAVY (durable render via `triggerAndWait`):**
```ts
// src/mastra/tools/renderBlock.ts
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { renderBlockTask } from '@/trigger/render-block'   // existing durable Trigger task

export const renderBlockTool = createTool({
  id: 'render-block',
  description: 'Render one video block. Long-running; runs as a durable Trigger.dev task. Returns the asset ref.',
  inputSchema: z.object({ runId: z.string(), blockId: z.string(), spec: z.unknown() }),
  outputSchema: z.object({ ok: z.boolean(), assetId: z.string().optional(), error: z.string().optional() }),
  execute: async ({ runId, blockId, spec }) => {
    const res = await renderBlockTask.triggerAndWait({ runId, blockId, spec })   // ← durable handoff
    if (!res.ok) return { ok: false, error: String(res.error ?? 'render failed') }
    return { ok: true, assetId: res.output?.assetId }
  },
})
```

**(c) Director orchestrator agent (the brain), hosted in a Trigger task:**
```ts
// src/mastra/agents/director.ts
import { Agent } from '@mastra/core/agent'
import { planVideoTool } from '../tools/planVideo'
import { renderBlockTool } from '../tools/renderBlock'
import { uploadYoutubeTool } from '../tools/uploadYoutube'

export const directorAgent = new Agent({
  id: 'director',
  name: 'Director',
  instructions:
    'You are the Director of an autonomous YouTube studio. Given a channel + run, produce the next video by ' +
    'calling tools: plan the topic, write the script, render each block, then upload. Read state back from ' +
    'Convex between steps. Heavy steps run as durable tasks — call the tool and wait. Stop when the video is published.',
  model: 'google/gemini-2.5-pro',          // match repo DIRECTOR_MODEL; Claude for high-value reasoning if needed
  tools: { planVideoTool, renderBlockTool, uploadYoutubeTool },
  hooks: { afterToolCall: ({ toolName, error }) => { if (error) console.error('[director]', toolName, error) } },
})

// src/trigger/director-run.ts  — DURABLE HOST
import { task } from '@trigger.dev/sdk'
export const directorRunTask = task({
  id: 'director-run',
  machine: 'small-1x',
  maxDuration: 3600,
  run: async ({ runId, channelId, ownerId }: { runId: string; channelId: string; ownerId: string }) => {
    const { Mastra } = await import('@mastra/core')                 // dynamic import = existing resilient seam
    const { directorAgent } = await import('@/mastra/agents/director')
    const mastra = new Mastra({ agents: { director: directorAgent } } as any)
    const director = mastra.getAgentById('director')
    const res = await director.generate(
      `Produce the next video. ownerId=${ownerId} channelId=${channelId} runId=${runId}.`,
    )
    return { text: res.text, steps: res.steps?.length ?? 0 }
  },
})
```

---

## Sources
- Mastra Tools overview: https://mastra.ai/en/docs/tools-mcp/overview
- Mastra `createTool` reference: https://mastra.ai/en/reference/tools/create-tool
- Mastra Agents overview: https://mastra.ai/en/docs/agents/overview
- Mastra Workflows overview: https://mastra.ai/en/docs/workflows/overview
- Mastra Background tasks (long-running tools, non-blocking): https://mastra.ai/en/docs/agents/background-tasks
- In-repo: `src/agents/mastra.ts`, `src/trigger/verifyMastra.ts`, `src/engine/convexSink.ts`,
  `src/trigger/runPipeline.ts`, `src/trigger/designChannel.ts`, `trigger.config.ts`, `package.json`
- Vault `mastra` service: `MASTRA_DEPLOY_URL` (= MASTRA_BASE_URL, platform-agents.vercel.app), `MASTRA_VERCEL_PROJECT_ID`
