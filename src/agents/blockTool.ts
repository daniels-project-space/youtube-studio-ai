/**
 * Mastra adapter — turns the engine's Block contract into Mastra primitives.
 *
 * This is the P2 bridge of the Mastra migration (docs/MODULES_TO_MASTRA.md): a
 * Block (id + consumes + produces + run) maps DIRECTLY to a Mastra `createTool`
 * AND to a `createStep` that threads the shared store — both proven at PARITY
 * with the bespoke runner (a Block→Step chain produces the identical store).
 * That proves the existing engine is already tool/workflow-shaped, so the
 * migration is a translation, not a rewrite. A Block[] also assembles into a
 * RUNNABLE createWorkflow (buildPipelineWorkflow / runPipelineWorkflow) whose
 * final store is at PARITY with the bespoke sequential runner.
 *
 * Resilient like agentJson(): @mastra packages are dynamically imported so a
 * bundle problem surfaces here, not at module-load time on the Trigger worker.
 */
import { z } from "zod";
import type { Block, StageContext } from "@/engine/types";

type Store = Record<string, unknown>;

/** A minimal StageContext for a tool/step run — store-driven; the rest is run identity. */
export function toolCtx(
  store: Store,
  params: Record<string, unknown> = {},
  log: StageContext["log"] = () => {},
): StageContext {
  return {
    ownerId: "mastra",
    runId: "mastra",
    channelId: "mastra",
    keyPrefix: "mastra/",
    params,
    store,
    budgetUsd: Number.POSITIVE_INFINITY,
    log,
  };
}

/** zod schemas derived from the block's declared contract (permissive: unknown per key). */
export function blockSchemas(block: Block) {
  const shape = (keys: string[]) =>
    z.object(Object.fromEntries(keys.map((k) => [k, z.unknown()])) as Record<string, z.ZodTypeAny>);
  return { inputSchema: shape(block.consumes), outputSchema: shape(block.produces) };
}

/** Keep only the keys the block declared it produces (drop cost-patch + extras). */
export function pickProduced(patch: Record<string, unknown>, produces: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of produces) out[k] = patch[k];
  return out;
}

const STORE_SCHEMA = z.object({ store: z.record(z.string(), z.unknown()) });

/** Block → Mastra createTool. The tool's input IS the block's consumed store slice. */
export async function blockTool(block: Block) {
  const { createTool } = await import("@mastra/core/tools");
  const { inputSchema, outputSchema } = blockSchemas(block);
  return createTool({
    id: block.id,
    description: `Pipeline block "${block.id}" — consumes [${block.consumes.join(", ")}], produces [${block.produces.join(", ")}].`,
    inputSchema,
    outputSchema,
    // Mastra tools receive the validated input positionally (workflow steps use
    // { inputData } — see blockStep). The input IS the block's consumed store slice.
    execute: async (inputData: Store) => {
      const patch = await block.run(toolCtx({ ...inputData }));
      return pickProduced(patch, block.produces);
    },
  });
}

/** Block → Mastra createStep that threads the accumulating store ({store} → {store}). */
export async function blockStep(block: Block) {
  const { createStep } = await import("@mastra/core/workflows");
  return createStep({
    id: block.id,
    inputSchema: STORE_SCHEMA,
    outputSchema: STORE_SCHEMA,
    execute: async ({ inputData }: { inputData: { store: Store } }) => {
      const store = inputData.store;
      const patch = await block.run(toolCtx(store));
      return { store: { ...store, ...pickProduced(patch, block.produces) } };
    },
  });
}

/** Block[] (pipeline order) → Mastra steps. */
export async function blockSteps(blocks: Block[]) {
  return Promise.all(blocks.map(blockStep));
}

interface MastraWorkflow {
  createRun: () => Promise<{
    start: (a: { inputData: { store: Store } }) => Promise<{ status: string; result?: { store: Store }; error?: unknown }>;
  }>;
}

/**
 * Block[] → a committed Mastra workflow that threads the store through each step.
 * Returns it WRAPPED ({ workflow }) on purpose: a Mastra workflow is *thenable*
 * (it has a `.then()` builder method), so returning it bare from an async fn
 * makes the await machinery try to resolve it as a promise and deadlocks. The
 * wrapper keeps the thenable off the resolution path.
 */
export async function buildPipelineWorkflow(id: string, blocks: Block[]): Promise<{ workflow: MastraWorkflow }> {
  const { createWorkflow } = await import("@mastra/core/workflows");
  const steps = await blockSteps(blocks);
  // The builder is heavily generic; `any` lets us chain .then() over a dynamic list.
  let wf: { then: (s: unknown) => typeof wf; commit: () => MastraWorkflow } =
    createWorkflow({ id, inputSchema: STORE_SCHEMA, outputSchema: STORE_SCHEMA }) as never;
  for (const s of steps) wf = wf.then(s) as typeof wf;
  return { workflow: wf.commit() };
}

/**
 * Run a pipeline as a Mastra workflow end-to-end and return the final store —
 * at PARITY with the bespoke sequential runner. (Sequential .then() chain; the
 * runner's verified parallel groups map to .parallel() as a later refinement.)
 */
export async function runPipelineWorkflow(blocks: Block[], seedStore: Store = {}, id = "pipeline"): Promise<Store> {
  const { workflow } = await buildPipelineWorkflow(id, blocks);
  const run = await workflow.createRun();
  const res = await run.start({ inputData: { store: seedStore } });
  if (res.status !== "success") throw new Error(`workflow "${id}" failed: ${res.status} ${JSON.stringify(res.error ?? "")}`);
  return res.result!.store;
}
