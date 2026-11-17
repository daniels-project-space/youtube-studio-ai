/** Read-only check of saved channel settings against Automation's Qwen policy. */
import { readFile } from "node:fs/promises";
import { registerAllBlocks } from "@/engine/blocks";
import { assertAutomationNarrationPolicy } from "@/engine/automationNarrationPolicy";
import { ExecutionError } from "@/engine/executionErrors";
import { completePipelineForPolicy, materializeRuntimePipelineParams } from "@/engine/pipelineCompiler";
import { mergeRuntimeModuleConfig } from "@/engine/runtimeModuleConfig";
import type { PipelineEntry } from "@/engine/types";
import { snapshotParamsByBlock } from "@/lib/pipelineInvocationSnapshot";

type BaselineChannel = {
  name: string;
  ownerId: string;
  identity?: { voiceId?: string };
  pipeline: PipelineEntry[];
  moduleConfig?: unknown;
};

async function main() {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw new Error("pass the private channel baseline path");
  const input = JSON.parse(await readFile(path, "utf8")) as { version?: string; ownerId?: string; channels?: BaselineChannel[] };
  if (input.version !== "youtube-automation-channel-baseline/v1" || !input.ownerId || !Array.isArray(input.channels)) throw new Error("invalid channel baseline");
  registerAllBlocks();
  const results = input.channels.map((channel) => {
    if (channel.ownerId !== input.ownerId || !Array.isArray(channel.pipeline)) throw new Error("baseline owner or pipeline mismatch");
    try {
      const completed = completePipelineForPolicy(channel.pipeline);
      const merged = mergeRuntimeModuleConfig({ entries: completed.entries, paramsByBlock: snapshotParamsByBlock(completed.entries), moduleConfig: channel.moduleConfig });
      const effective = materializeRuntimePipelineParams(completed.entries, merged.paramsByBlock);
      assertAutomationNarrationPolicy(effective, { voiceId: channel.identity?.voiceId }, { YOUTUBE_AUTOMATION_PRIVATE: "1" });
      return { name: channel.name, status: effective.some((entry) => entry.block === "narration_tts") ? "qwen_configured" : "no_inspected_narration_block" };
    } catch (error) {
      return { name: channel.name, status: error instanceof ExecutionError ? error.code : "configuration_error" };
    }
  });
  console.log(JSON.stringify({ assessment: "configuration_only", results }, null, 2));
}
void main().catch((error) => {
  console.error(`Channel narration audit failed (${error instanceof Error ? error.name : "unknown error"}).`);
  process.exitCode = 1;
});
