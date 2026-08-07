import { registerAllBlocks } from "./blocks";
import {
  completePipelineForPolicy,
  compilePipeline,
} from "./pipelineCompiler";
import type { PipelineEntry } from "./types";
import type {
  CatalogExecutionStep,
  NovitaVideoRenderAssessment,
} from "./goldenExecution";
import { validatePipeline } from "./validate";

export interface ChannelFlowSource {
  id: string;
  name: string;
  slug: string;
  status?: string;
  family?: string | null;
  pipeline: readonly PipelineEntry[];
}

export interface ChannelFlowStep extends CatalogExecutionStep {
  params?: Record<string, unknown>;
}

export interface ChannelFlowStage {
  stage: string;
  steps: readonly ChannelFlowStep[];
}

export interface ChannelFlowExport {
  schemaVersion: "1.1.0";
  channel: Omit<ChannelFlowSource, "pipeline">;
  policy: { id: string; version: string };
  fingerprint: string;
  reservedMaxCostUsd: number;
  sourceBlocks: readonly string[];
  effectiveBlocks: readonly string[];
  insertedPolicyBlocks: readonly string[];
  retiredLegacyBlocks: readonly string[];
  videoRenderBinding: NovitaVideoRenderAssessment;
  steps: readonly ChannelFlowStep[];
  executionStages: readonly ChannelFlowStage[];
}

function contiguousStages(steps: readonly ChannelFlowStep[]): ChannelFlowStage[] {
  const stages: ChannelFlowStage[] = [];
  for (const step of steps) {
    const prior = stages.at(-1);
    if (prior?.stage === step.stage) {
      (prior.steps as ChannelFlowStep[]).push(step);
    } else {
      stages.push({ stage: step.stage, steps: [step] });
    }
  }
  return stages;
}

/**
 * Build the exact compile-time route for one channel. Policy completion may
 * insert uniquely required safety/crew capabilities or retire a proven legacy
 * no-op, but catalog mapping itself is one-to-one and never expands selection.
 */
export function buildChannelFlowExport(source: ChannelFlowSource): ChannelFlowExport {
  registerAllBlocks();
  const completed = completePipelineForPolicy(source.pipeline);
  const resolved = validatePipeline(completed.entries);
  const compilation = compilePipeline(resolved);
  if (compilation.catalogFlow.length !== completed.entries.length) {
    throw new Error("catalog execution flow changed the selected module count");
  }

  const steps = compilation.catalogFlow.map((step, sequence): ChannelFlowStep => {
    const entry = completed.entries[sequence];
    if (!entry || entry.block !== step.executableId) {
      throw new Error(`catalog execution flow lost order at step ${sequence}`);
    }
    return {
      ...step,
      ...(entry.params ? { params: { ...entry.params } } : {}),
    };
  });

  return {
    schemaVersion: "1.1.0",
    channel: {
      id: source.id,
      name: source.name,
      slug: source.slug,
      ...(source.status ? { status: source.status } : {}),
      ...(source.family !== undefined ? { family: source.family } : {}),
    },
    policy: { id: compilation.policyId, version: compilation.policyVersion },
    fingerprint: compilation.fingerprint,
    reservedMaxCostUsd: compilation.reservedMaxCostUsd,
    sourceBlocks: source.pipeline.map((entry) => entry.block),
    effectiveBlocks: completed.entries.map((entry) => entry.block),
    insertedPolicyBlocks: completed.inserted,
    retiredLegacyBlocks: completed.retired,
    videoRenderBinding: compilation.videoRenderBinding,
    steps,
    executionStages: contiguousStages(steps),
  };
}

function cell(value: unknown): string {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderChannelFlowMarkdown(exports: readonly ChannelFlowExport[]): string {
  const lines = ["# Per-channel executable catalog flows", ""];
  for (const flow of exports) {
    const goldenQualified = flow.steps.filter((step) => step.goldenQualified).length;
    lines.push(`## ${flow.channel.name}`, "");
    lines.push(
      `- Channel: \`${flow.channel.slug}\` (${flow.channel.status ?? "unknown"})`,
      `- Policy: \`${flow.policy.id}@${flow.policy.version}\``,
      `- Fingerprint: \`${flow.fingerprint}\``,
      `- Selected executable steps: ${flow.steps.length}`,
      `- Equivalence-proven (Golden-qualified) steps: ${goldenQualified}/${flow.steps.length}`,
      `- Reserved maximum: $${flow.reservedMaxCostUsd.toFixed(4)}`,
      `- Provider AI-video route: \`${flow.videoRenderBinding.bindingId}\` (${flow.videoRenderBinding.required ? (flow.videoRenderBinding.compliant ? "compliant" : "migration required") : "not selected"})`,
    );
    if (flow.insertedPolicyBlocks.length) {
      lines.push(`- Compiler-added requirements: ${flow.insertedPolicyBlocks.map((id) => `\`${id}\``).join(", ")}`);
    }
    if (flow.retiredLegacyBlocks.length) {
      lines.push(`- Retired legacy entries: ${flow.retiredLegacyBlocks.map((id) => `\`${id}\``).join(", ")}`);
    }
    for (const violation of flow.videoRenderBinding.violations) {
      lines.push(`- AI-video route violation: ${violation}`);
    }
    lines.push(
      "",
      "| # | Stage | Catalog module | Executable ABI | Qualification | Evidence / blocker | ABI certification | Parameters |",
      "|---:|---|---|---|---|---|---|---|",
    );
    for (const step of flow.steps) {
      const params = step.params ? JSON.stringify(step.params) : "—";
      const qualificationEvidence = step.sourceProvenance
        ? `${step.sourceProvenance.callerSymbol} → ${step.sourceProvenance.referenceSymbol}`
        : step.qualificationBlockers.join("; ") || "approved immutable proof";
      lines.push(
        `| ${step.sequence + 1} | ${cell(step.stage)} | ${cell(step.catalogTitle)} (\`${cell(step.catalogKey)}\`, ${cell(step.catalogStatus)}) | \`${cell(step.executableId)}@${cell(step.executableVersion)}\` | ${cell(step.qualification)} | ${cell(qualificationEvidence)} | ${cell(step.certification)} | ${cell(params)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
