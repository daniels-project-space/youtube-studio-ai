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
  livePipelineOverallState,
  summarizeLivePipelinePhases,
  type LivePipelinePhase,
} from "@/lib/livePipelinePresentation";
import { fmtUsd } from "@/lib/format";
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
export function LivePipeline({
  nodes,
  planSource = "legacy",
}: {
  nodes: PipelineNode[];
  planSource?: "frozen" | "legacy";
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<LivePipelinePhase | null>(null);
  const [inspectionDismissed, setInspectionDismissed] = useState(false);
  const complete = nodes.filter((node) => ["ok", "skipped"].includes(nodeStatus(node))).length;
  const failed = nodes.filter((node) => nodeStatus(node) === "failed").length;
  const active = nodes.find((node) => nodeStatus(node) === "running");
  const activeStartedAt = active?.stage?.startedAt;
  const phaseSummaries = summarizeLivePipelinePhases(nodes);
  const overallState = livePipelineOverallState(nodes);
  const hasPlan = nodes.length > 0;
  const recordedCost = nodes.reduce((sum, node) => sum + (node.stage?.cost ?? 0), 0);
  const blockedNode = nodes.find((node) => nodeStatus(node) === "failed");
  // A current stage is already visible in the live strip. Opening its whole
  // phase by default made every active run a long wall of receipts. Failures
  // remain opened automatically because their recorded evidence is actionable.
  const inspectionPhase = selectedPhase ?? (!inspectionDismissed && blockedNode
    ? livePipelinePhaseForBlock(blockedNode.block)
    : null);
  const inspectionNodes = inspectionPhase
    ? nodes.filter((node) => livePipelinePhaseForBlock(node.block) === inspectionPhase)
    : [];

  return (
    <div className={styles.root} data-state={overallState}>
      <header className={styles.summary}>
        <div className={styles.summaryLead}>
          <span className={styles.summarySignal} aria-hidden="true" />
          <div className={styles.summaryCopy} aria-live="polite" aria-atomic="true">
            <strong>Pipeline</strong>
            <small>
              {active
                ? `${blockLabel(active.block)} · ${LIVE_PIPELINE_PHASE_LABEL[livePipelinePhaseForBlock(active.block)]} active`
                : !hasPlan
                  ? "No frozen pipeline receipt is available for this run"
                : failed
                  ? "A recorded stage needs attention before release can continue"
                  : complete === nodes.length
                    ? "All stage receipts are recorded"
                    : planSource === "frozen"
                      ? "Waiting for the next stage"
                      : "Using the saved legacy plan"}
            </small>
          </div>
          {activeStartedAt ? (
            <span className={styles.summaryElapsed} title="Elapsed time for the active persisted stage">
              <Elapsed from={activeStartedAt} />
            </span>
          ) : null}
        </div>
        <div className={styles.summaryMetrics} aria-label="Production progress">
          <span>
            <strong>{hasPlan ? `${complete}/${nodes.length}` : "—"}</strong>
            <small>{hasPlan ? "complete" : "plan unavailable"}</small>
          </span>
          <span>
            <strong>{hasPlan ? `${phaseSummaries.filter((phase) => phase.state === "complete").length}/${phaseSummaries.length}` : "—"}</strong>
            <small>{hasPlan ? "phases" : "no phase receipts"}</small>
          </span>
          <span>
            <strong>{fmtUsd(recordedCost)}</strong>
            <small>stage cost</small>
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
        {phaseSummaries.map((summary) => (
          <button
            type="button"
            className={styles.phase}
            data-state={summary.state}
            data-selected={inspectionPhase === summary.phase || undefined}
            key={summary.phase}
            title={describeLivePipelinePhase(summary)}
            aria-pressed={inspectionPhase === summary.phase}
            onClick={() => {
              if (inspectionPhase === summary.phase) {
                setSelectedPhase(null);
                setInspectionDismissed(true);
                return;
              }
              setSelectedPhase(summary.phase);
              setInspectionDismissed(false);
            }}
          >
            <div className={styles.phaseTopline}>
              <span className={styles.phaseDot} aria-hidden="true" />
              <span className={styles.phaseName}>{summary.label}</span>
            </div>
            <div className={styles.phaseProgress}>
              <strong>{summary.verified}/{summary.total}</strong>
              <span>receipts</span>
            </div>
          </button>
        ))}
      </div>

      {inspectionPhase ? (
        <section className={styles.inspectionShelf} aria-label={`${LIVE_PIPELINE_PHASE_LABEL[inspectionPhase]} stage receipts`}>
          <header className={styles.inspectionHeader}>
            <span>Phase receipts</span>
            <strong>{LIVE_PIPELINE_PHASE_LABEL[inspectionPhase]}</strong>
            <small>{inspectionNodes.length} stages</small>
          </header>
          <div className={styles.stageList}>
        {inspectionNodes.map((node) => {
          const status = nodeStatus(node);
          const phase: LivePipelinePhase = livePipelinePhaseForBlock(node.block);
          const index = nodes.indexOf(node);
          const stage = node.stage;
          const running = status === "running";
          const open = expanded === node.block;
          const hasDetail = Boolean(stage && (stage.inputs !== undefined || stage.outputs !== undefined || stage.error));

          return (
            <div data-phase={phase} key={node.block}>
              <div className={`${styles.stageCard} glass`} data-status={status} data-open={open ? "true" : undefined}>
                <button
                  type="button"
                  className={styles.stageToggle}
                  onClick={() => setExpanded((current) => current === node.block ? null : node.block)}
                  disabled={!hasDetail}
                  title={hasDetail ? `Inspect ${blockLabel(node.block)} receipt` : "No receipt details recorded for this stage yet"}
                  aria-expanded={hasDetail ? open : undefined}
                >
                  <span className={styles.stageTrack} aria-hidden="true">
                    <span className={`${styles.stageIndex} ${running ? "studio-pulse" : ""}`}>{index + 1}</span>
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
        </section>
      ) : (
        <p className={styles.inspectionHint}>Select a phase to inspect its recorded stage receipts.</p>
      )}
    </div>
  );
}
