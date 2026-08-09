import {
  normalizePipelineInvocationSnapshot,
  type PipelineInvocationSnapshot,
} from "@/lib/pipelineInvocationSnapshot";
import { pipelineInvocationSha256 } from "@/lib/pipelineInvocationHash";
import { stableJson } from "@/lib/publishingPolicy";

// Only full-resolution master renderers may be delegated to the durable
// high-memory worker. Each invocation is still constrained by its frozen
// per-run allowlist below.
const REMOTE_RENDER_BLOCKS = new Set(["timeline_assemble", "documotion_short"]);

interface DurableRenderRunIdentity {
  _id: string;
  ownerId: string;
  channelId: string;
  status: string;
  pipelineInvocationSnapshot?: unknown;
  pipelineInvocationSha256?: string;
}

export interface FrozenRenderInvocationInput {
  keyPrefix: string;
  budgetUsd: number;
  params: Record<string, unknown>;
  seedStore: Record<string, unknown>;
}

interface DurableRenderChannelIdentity {
  _id: string;
  ownerId: string;
}

/**
 * Fail closed before a large render worker rehydrates data or executes code.
 * The child is intentionally a single-purpose timeline renderer, not a generic
 * remote entry point for every registered (including paid/publishing) block.
 */
export function assertRenderBlockAdmission(args: {
  blockId: string;
  run: DurableRenderRunIdentity | null | undefined;
  channel: DurableRenderChannelIdentity | null | undefined;
  runId: string;
  ownerId: string;
  channelId: string;
}): asserts args is typeof args & {
  run: DurableRenderRunIdentity;
  channel: DurableRenderChannelIdentity;
} {
  if (!REMOTE_RENDER_BLOCKS.has(args.blockId)) {
    throw new Error(`render-block refuses non-render module: ${args.blockId}`);
  }
  if (!args.run || !args.channel) {
    throw new Error("render-block run/channel not found");
  }
  if (
    String(args.run._id) !== args.runId ||
    String(args.channel._id) !== args.channelId ||
    args.run.ownerId !== args.ownerId ||
    args.channel.ownerId !== args.ownerId ||
    String(args.run.channelId) !== args.channelId
  ) {
    throw new Error("render-block run ownership/channel mismatch");
  }
  if (args.run.status !== "running") {
    throw new Error(`render-block requires a running parent run, got: ${args.run.status}`);
  }
}

/**
 * Bind the costly child invocation to the parent's write-once snapshot. Live
 * channel slug, budget, module params, or seed edits can never alter a retry.
 */
export function assertRenderBlockInvocation(args: {
  blockId: string;
  run: DurableRenderRunIdentity;
  runId: string;
  ownerId: string;
  channelId: string;
  input: FrozenRenderInvocationInput;
}): PipelineInvocationSnapshot {
  if (
    args.run.pipelineInvocationSnapshot === undefined ||
    !args.run.pipelineInvocationSha256
  ) {
    throw new Error("render-block requires a durable parent invocation snapshot");
  }
  let snapshot: PipelineInvocationSnapshot;
  try {
    snapshot = normalizePipelineInvocationSnapshot(
      args.run.pipelineInvocationSnapshot as PipelineInvocationSnapshot,
    );
  } catch (error) {
    throw new Error(
      `render-block parent invocation snapshot is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    args.run.pipelineInvocationSha256 !== pipelineInvocationSha256(snapshot)
  ) {
    throw new Error("render-block parent invocation snapshot hash mismatch");
  }
  if (
    snapshot.runId !== args.runId ||
    snapshot.ownerId !== args.ownerId ||
    snapshot.channelId !== args.channelId
  ) {
    throw new Error("render-block parent invocation snapshot identity mismatch");
  }
  if (!snapshot.remoteBlocks.includes(args.blockId)) {
    throw new Error("render-block module is not authorized by the frozen invocation");
  }
  if (
    args.input.keyPrefix !== snapshot.keyPrefix ||
    args.input.budgetUsd !== snapshot.budgetUsd
  ) {
    throw new Error("render-block storage/budget differs from the frozen invocation");
  }
  if (stableJson(args.input.seedStore) !== stableJson(snapshot.seedStore)) {
    throw new Error("render-block seed store differs from the frozen invocation");
  }
  const matchingEntries = snapshot.entries.filter(
    (entry) => entry.block === args.blockId,
  );
  if (matchingEntries.length !== 1) {
    throw new Error("render-block frozen module entry is missing or ambiguous");
  }
  if (
    stableJson(args.input.params) !==
    stableJson(matchingEntries[0].params ?? {})
  ) {
    throw new Error("render-block params differ from the frozen invocation");
  }
  return snapshot;
}
