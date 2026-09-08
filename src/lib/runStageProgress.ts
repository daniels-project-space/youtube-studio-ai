export type RunStageProgressSummary = Readonly<{
  completed: number;
  total: number;
  totalKnown: boolean;
  currentBlock?: string;
  currentStatus?: string;
  currentPosition?: number;
}>;

type PipelineEntry = Readonly<{ block: string }>;
type StageRow = Readonly<{
  block: string;
  status: string;
  startedAt?: number;
}>;

const COMPLETED_STAGE_STATUSES = new Set(["ok", "skipped"]);
const CURRENT_STAGE_PRIORITY = ["running", "failed", "queued"] as const;

/**
 * Reduce an immutable invocation plus persisted stage rows into the small,
 * truthful progress receipt needed by list views. A frozen invocation is the
 * only source allowed to claim a known denominator. Historical rows without
 * one expose observed stage progress but never manufacture a percentage.
 */
export function summarizeRunStageProgress(input: {
  pipeline?: readonly PipelineEntry[];
  stages: readonly StageRow[];
}): RunStageProgressSummary {
  const pipelineOrder = (input.pipeline ?? [])
    .map((entry) => entry.block.trim())
    .filter(Boolean);
  const totalKnown = pipelineOrder.length > 0;
  const observedOrder = [...input.stages]
    .sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0))
    .map((stage) => stage.block.trim())
    .filter(Boolean);
  const order = totalKnown ? pipelineOrder : [...new Set(observedOrder)];
  const byBlock = new Map(input.stages.map((stage) => [stage.block, stage]));
  const completed = order.filter((block) =>
    COMPLETED_STAGE_STATUSES.has(byBlock.get(block)?.status ?? ""),
  ).length;

  let currentBlock: string | undefined;
  for (const status of CURRENT_STAGE_PRIORITY) {
    currentBlock = order.find((block) => byBlock.get(block)?.status === status);
    if (currentBlock) break;
  }
  if (!currentBlock && totalKnown) {
    currentBlock = order.find((block) => !byBlock.has(block));
  }

  const current = currentBlock ? byBlock.get(currentBlock) : undefined;
  const currentPosition = currentBlock ? order.indexOf(currentBlock) + 1 : undefined;
  return {
    completed,
    total: order.length,
    totalKnown,
    ...(currentBlock ? { currentBlock } : {}),
    ...(currentBlock ? { currentStatus: current?.status ?? "queued" } : {}),
    ...(currentPosition ? { currentPosition } : {}),
  };
}
