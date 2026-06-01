"use client";

import { useState } from "react";
import { STATUS_COLOR } from "@/lib/config";
import { blockLabel } from "@/lib/blocks";
import { Elapsed } from "./Elapsed";
import { StageBadge } from "./StageBadge";
import { StageRow } from "./StageRow";
import { IconChevron } from "./icons";

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
 * produced a runStage row yet — it renders as `queued`.
 */
export type PipelineNode = {
  block: string;
  stage?: PipelineStage;
};

function nodeStatus(node: PipelineNode): string {
  return node.stage?.status ?? "queued";
}

/**
 * Vertical numbered stage track. Numbered nodes per block, connected by a
 * progress line that fills as blocks complete. Each node shows the block
 * label, a status pill, and per-block elapsed time; clicking expands the
 * persisted inputs/outputs and any error.
 */
export function LivePipeline({ nodes }: { nodes: PipelineNode[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {nodes.map((node, i) => {
        const status = nodeStatus(node);
        const color = STATUS_COLOR[status] ?? "var(--color-queued)";
        const isLast = i === nodes.length - 1;
        const stage = node.stage;
        const running = status === "running";
        const dim = status === "queued" || status === "skipped";
        const open = expanded === node.block;
        const hasDetail =
          !!stage &&
          (stage.inputs !== undefined ||
            stage.outputs !== undefined ||
            !!stage.error);

        return (
          <div
            key={node.block}
            className="glass"
            style={{
              borderColor: open
                ? "var(--color-border-strong)"
                : "var(--color-border)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() =>
                setExpanded((cur) => (cur === node.block ? null : node.block))
              }
              disabled={!hasDetail}
              style={{
                width: "100%",
                font: "inherit",
                textAlign: "left",
                cursor: hasDetail ? "pointer" : "default",
                background: "transparent",
                border: "none",
                color: "inherit",
                display: "flex",
                alignItems: "center",
                gap: "0.9rem",
                padding: "0.8rem 1.05rem",
                opacity: dim ? 0.6 : 1,
              }}
            >
              {/* Numbered node + connecting progress line */}
              <span
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  alignSelf: "stretch",
                }}
              >
                <span
                  className={running ? "studio-pulse" : undefined}
                  style={{
                    display: "grid",
                    placeItems: "center",
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    flexShrink: 0,
                    zIndex: 1,
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.74rem",
                    fontWeight: 600,
                    color,
                    background: `color-mix(in srgb, ${color} 16%, transparent)`,
                    border: `1.5px solid color-mix(in srgb, ${color} 45%, transparent)`,
                  }}
                >
                  {i + 1}
                </span>
                {!isLast && (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: 28,
                      bottom: -16,
                      width: 2,
                      background:
                        status === "ok"
                          ? "var(--color-ok)"
                          : "var(--color-border-strong)",
                      opacity: status === "ok" ? 0.55 : 1,
                    }}
                  />
                )}
              </span>

              <span style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    fontWeight: 500,
                    fontSize: "0.95rem",
                    display: "block",
                  }}
                >
                  {blockLabel(node.block)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.72rem",
                    color: "var(--color-faint)",
                  }}
                >
                  {node.block}
                </span>
              </span>

              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                  fontSize: "0.78rem",
                  color: "var(--color-faint)",
                  whiteSpace: "nowrap",
                }}
              >
                {stage?.startedAt && (
                  <span style={{ fontFamily: "var(--font-mono)" }}>
                    <Elapsed
                      from={stage.startedAt}
                      to={running ? undefined : stage.finishedAt}
                    />
                  </span>
                )}
                <StageBadge status={status} size="sm" />
                {hasDetail && (
                  <IconChevron
                    width={15}
                    height={15}
                    style={{
                      transition: "transform 0.18s ease",
                      transform: open ? "rotate(180deg)" : "none",
                      color: "var(--color-muted)",
                    }}
                  />
                )}
              </span>
            </button>

            {open && hasDetail && stage && (
              <div style={{ borderTop: "1px solid var(--color-border)" }}>
                <StageRow
                  inputs={stage.inputs}
                  outputs={stage.outputs}
                  error={stage.error}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
