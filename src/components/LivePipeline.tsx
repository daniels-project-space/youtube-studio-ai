"use client";

import { useState } from "react";
import { blockLabel } from "@/lib/blocks";
import { Elapsed } from "./Elapsed";
import { StageBadge } from "./StageBadge";
import { StageRow } from "./StageRow";
import { IconChevron } from "./icons";
import {
  describeLivePipelinePhase,
  LIVE_PIPELINE_PHASE_LABEL,
  livePipelinePhaseForBlock,
  summarizeLivePipelinePhases,
  type LivePipelinePhase,
} from "@/lib/livePipelinePresentation";
import styles from "./LivePipeline.module.css";

/** A live stage row, as persisted on the `runStages` table. */
export type PipelineStage = {
  _id: string;
  block: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
  cost?: number;
  inputs?: unknown;
  outputs?: unknown;
  error?: string;
};

/**
 * One node in the planned pipeline. `stage` is undefined when the block hasn't
 * produced a runStage row — it renders as `queued`.
 */
export type PipelineNode = {
  block: string;
  stage?: PipelineStage;
};

function nodeStatus(node: PipelineNode): string {
  return node.stage?.status ?? "queued";
}

/**
 * A compact production workbench backed only by persisted stage receipts.
 * It never implies a media stream or progress signal that the runner has not
 * recorded; grouping makes the actual plan understandable without hiding any
 * individual stage or its inspection detail.
 */
export function LivePipeline({ nodes }: { nodes: PipelineNode[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const complete = nodes.filter((node) => ["ok", "skipped"].includes(nodeStatus(node))).length;
  const failed = nodes.filter((node) => nodeStatus(node) === "failed").length;
  const active = nodes.find((node) => nodeStatus(node) === "running");
  const phaseSummaries = summarizeLivePipelinePhases(nodes);
  const overallState = failed > 0 ? "blocked" : active ? "active" : complete === nodes.length ? "complete" : "queued";

  return (
    <div className={styles.root} data-state={overallState}>
      <header className={`${styles.summary} glass`}>
        <div className={styles.summaryLead}>
          <span className={styles.summarySignal} aria-hidden="true" />
          <span>
            <strong>Production workbench</strong>
            <small>
              {active
                ? `Working in ${LIVE_PIPELINE_PHASE_LABEL[livePipelinePhaseForBlock(active.block)].toLowerCase()} · ${blockLabel(active.block)}`
                : failed
                  ? "A recorded stage needs attention before release can continue"
                  : complete === nodes.length
                    ? "Every planned stage has reported a receipt"
                    : "Waiting for the next verified stage receipt"}
            </small>
          </span>
        </div>
        <div className={styles.summaryMetrics} aria-label="Production progress">
          <span>
            <strong>{complete}/{nodes.length}</strong>
            <small>verified</small>
          </span>
          <span>
            <strong>{phaseSummaries.filter((phase) => phase.state === "complete").length}/{phaseSummaries.length}</strong>
            <small>phases</small>
          </span>
          {failed > 0 && (
            <span className={styles.blockedMetric}>
              <strong>{failed}</strong>
              <small>blocked</small>
            </span>
          )}
        </div>
      </header>

      <div className={styles.phaseStrip} aria-label="Production phase progress">
        {phaseSummaries.map((summary, index) => (
          <div className={styles.phase} data-state={summary.state} key={summary.phase} title={describeLivePipelinePhase(summary)}>
            <span className={styles.phaseOrder}>{String(index + 1).padStart(2, "0")}</span>
            <div className={styles.phaseTopline}>
              <span className={styles.phaseDot} aria-hidden="true" />
              <span className={styles.phaseName}>{summary.label}</span>
            </div>
            <div className={styles.phaseProgress}>
              <strong>{summary.verified}/{summary.total}</strong>
              <span>receipts</span>
            </div>
            <span className={styles.phaseCaption}>{describeLivePipelinePhase(summary)}</span>
          </div>
        ))}
      </div>

      <div className={styles.stageList}>
        {nodes.map((node, index) => {
          const status = nodeStatus(node);
          const phase: LivePipelinePhase = livePipelinePhaseForBlock(node.block);
          const isPhaseStart = index === 0 || livePipelinePhaseForBlock(nodes[index - 1]!.block) !== phase;
          const isPhaseEnd = index === nodes.length - 1 || livePipelinePhaseForBlock(nodes[index + 1]!.block) !== phase;
          const stage = node.stage;
          const running = status === "running";
          const open = expanded === node.block;
          const hasDetail = Boolean(stage && (stage.inputs !== undefined || stage.outputs !== undefined || stage.error));

          return (
            <div className={styles.stageGroup} data-phase={phase} key={node.block}>
              {isPhaseStart && (
                <div className={styles.phaseDivider}>
                  <span>{LIVE_PIPELINE_PHASE_LABEL[phase]}</span>
                  <i aria-hidden="true" />
                </div>
              )}
              <div className={`${styles.stageCard} glass`} data-status={status} data-open={open ? "true" : undefined}>
                <button
                  type="button"
                  className={styles.stageToggle}
                  onClick={() => setExpanded((current) => current === node.block ? null : node.block)}
                  disabled={!hasDetail}
                  aria-expanded={hasDetail ? open : undefined}
                >
                  <span className={styles.stageTrack} aria-hidden="true">
                    <span className={`${styles.stageIndex} ${running ? "studio-pulse" : ""}`}>{index + 1}</span>
                    {!isPhaseEnd && <span className={styles.stageLine} />}
                  </span>
                  <span className={styles.stageIdentity}>
                    <strong>{blockLabel(node.block)}</strong>
                    <small>{node.block}</small>
                  </span>
                  <span className={styles.stageMeta}>
                    {stage?.startedAt && <Elapsed from={stage.startedAt} to={running ? undefined : stage.finishedAt} />}
                    <StageBadge status={status} size="sm" />
                    {hasDetail && <IconChevron className={styles.chevron} data-open={open ? "true" : undefined} width={15} height={15} />}
                  </span>
                </button>
                {open && stage && hasDetail && (
                  <div className={styles.stageDetail}>
                    <StageRow inputs={stage.inputs} outputs={stage.outputs} error={stage.error} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
