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
import { keyStatus, missingForModules } from "./keyRegistry";

/** Which module file backs each format engine — so the preflight can report the
 *  exact keys that engine needs (the orchestrator knows what to get). */
const ENGINE_FILES: Record<string, string> = {
  documotion: "lib/documotion.ts",
  loreshort: "lib/loreshort.ts",
  comic: "lib/motionComic.ts",
  whiteboard: "lib/whiteboardSync.ts",
  lofi: "lib/lofi.ts",
  cinematic: "lib/cinecraft.ts",
};

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

  // PREFLIGHT — consult the key registry so we know what this run needs (and the
  // operator knows what to provide). Hard-stop only on the universal GEMINI key;
  // a missing feature key (music, stock, …) degrades that capability, not the run.
  const gemini = keyStatus().find((k) => k.name === "GEMINI_API_KEY");
  if (gemini && !gemini.present) throw new Error(`orchestrator: GEMINI_API_KEY missing — ${gemini.obtain}. Every engine needs it.`);
  const engineFile = ENGINE_FILES[engine.id];
  if (engineFile) {
    const miss = missingForModules([engineFile]);
    if (miss.length) log(`orchestrator: NOTE — ${engine.id} keys not present: ${miss.map((k) => `${k.name} (${k.purpose})`).join("; ")} — that capability will be skipped`);
  }

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
