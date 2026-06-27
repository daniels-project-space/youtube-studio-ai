/**
 * The coordinating orchestrator (docs/MODULES_TO_MASTRA.md P4). Given a channel
 * concept it: (1) SELECTS the format engine from the unified catalog by capability,
 * (2) runs the autonomous topic step, (3) invokes the engine THROUGH its Mastra
 * tool, and returns the coordinated plan + the produced video. This is the single
 * entry that "picks the modules a video needs and coordinates the whole video."
 *
 * The standalone format engines self-contain script + narration + visual, so for
 * them the coordination is: topic_select → <engine> → ship (thumbnail/metadata).
 * (Block-only pipelines coordinate via composePipeline + runPipelineWorkflow.)
 */
import { selectModule, getModule, moduleTool, type FormatInput, type ModuleResult } from "./formatTools";

export interface VideoPlan {
  concept: string;
  formatEngine: string;
  contentSteps: string[];
  shipSteps: string[];
  rationale: string;
}

/** Decide which modules this video needs (the orchestrator's plan). */
export function planVideo(concept: string): VideoPlan {
  const engine = selectModule(concept);
  if (!engine) throw new Error(`orchestrator: no format engine fits "${concept}"`);
  return {
    concept,
    formatEngine: engine.id,
    contentSteps: ["topic_select"], // the engines self-script from the topic
    shipSteps: ["thumbnail_gen", "metadata", "upload_draft"],
    rationale: `${engine.title}: ${engine.bestFor}. Coordination: topic_select → ${engine.id} → thumbnail/metadata/ship.`,
  };
}

export interface OrchestrateArgs {
  concept: string;
  topic?: string;
  runDir: string;
  outPath: string;
  style?: string;
  durationSec?: number;
  log?: (m: string) => void;
}

export interface OrchestrateResult extends ModuleResult {
  plan: VideoPlan;
  topic: string;
}

/**
 * Run a video end-to-end through Mastra: select the engine, pick the topic, and
 * invoke the engine via its Mastra tool. Returns the plan + the produced video.
 */
export async function orchestrateVideo(args: OrchestrateArgs): Promise<OrchestrateResult> {
  const log = args.log ?? (() => {});
  const plan = planVideo(args.concept);
  const engine = getModule(plan.formatEngine);
  if (!engine) throw new Error(`orchestrator: engine "${plan.formatEngine}" not found`);
  log(`orchestrator: selected "${engine.id}" for concept "${args.concept}"`);

  // 1) CONTENT — the autonomous topic step
  let topic = args.topic;
  if (!topic) {
    const { geminiJson } = await import("@/lib/gemini");
    const r = await geminiJson<{ topic: string }>({
      prompt: `For a "${args.concept}" video, pick ONE specific, compelling episode topic. Return STRICT JSON {"topic":string}.`,
      maxTokens: 120,
      temperature: 0.8,
    });
    topic = r.topic;
    log(`orchestrator: topic_select → "${topic}"`);
  }

  // 2) FORMAT engine — invoked THROUGH the Mastra tool
  const tool = (await moduleTool(engine)) as unknown as {
    execute: (input: FormatInput) => Promise<ModuleResult>;
  };
  const input: FormatInput = {
    topic,
    runDir: args.runDir,
    outPath: args.outPath,
    style: args.style,
    durationSec: args.durationSec,
    log,
  };
  log(`orchestrator: invoking ${engine.id} via its Mastra tool`);
  const res = await tool.execute(input);
  log(`orchestrator: done → ${res.videoPath}`);

  return { plan, topic, ...res };
}
