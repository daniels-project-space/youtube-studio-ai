import type { ReactNode } from "react";

import {
  describeQualityLearningOpening,
  type QualityLearningInsight,
} from "@/lib/qualityLearningPresentation";

type LoadState = "loading" | "ready" | "unavailable";

export function QualityLearningPanel({
  state,
  insights,
  channelNames,
  selectedChannelId,
}: {
  state: LoadState;
  insights: readonly QualityLearningInsight[];
  channelNames: ReadonlyMap<string, string>;
  selectedChannelId?: string;
}) {
  const visible = (selectedChannelId
    ? insights.filter((insight) => insight.channelId === selectedChannelId)
    : insights
  ).slice(0, 3);

  return (
    <section className="glass" aria-label="Quality learning" style={{ padding: "0.95rem" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: "0.16rem", maxWidth: 680 }}>
          <span style={eyebrow}>QUALITY LEARNING · OWNER-REVIEWED</span>
          <strong style={{ fontSize: "0.92rem", letterSpacing: "-0.015em" }}>What real viewers did at the opening.</strong>
          <span style={description}>
            Settled retention observations can propose a script-playbook change. They never alter a channel automatically.
          </span>
        </div>
        <span className="status-chip" style={{ whiteSpace: "nowrap" }}>HUMAN APPROVAL REQUIRED</span>
      </div>

      {state === "loading" ? (
        <div style={empty}>Loading settled audience evidence…</div>
      ) : state === "unavailable" ? (
        <div style={empty}>Quality learning is unavailable right now. Existing channel production is unchanged.</div>
      ) : visible.length === 0 ? (
        <div style={empty}>No settled retention learning is available for this scope yet.</div>
      ) : (
        <div style={{ display: "grid", gap: "0.55rem", marginTop: "0.8rem" }}>
          {visible.map((insight) => (
            <article key={insight.id} style={item}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "0.76rem" }}>{channelNames.get(insight.channelId) ?? "Channel"}</strong>
                <InsightStatus status={insight.status} />
              </div>
              <div style={{ display: "grid", gap: "0.13rem", marginTop: "0.35rem" }}>
                <span style={{ fontSize: "0.78rem", color: "var(--color-secondary)" }}>{describeQualityLearningOpening(insight.opening)}</span>
                <span style={{ fontSize: "0.66rem", color: "var(--color-muted)" }}>
                  {insight.sampleSize.toLocaleString()} observed views · {insight.sourceVideoCount || 1} source video{insight.sourceVideoCount === 1 ? "" : "s"} · {insight.evidencePassed ? "evidence threshold met" : "below evidence threshold"}
                </span>
                {insight.diagnosis && <span style={{ fontSize: "0.69rem", lineHeight: 1.38, color: "var(--color-muted)" }}>{insight.diagnosis}</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function InsightStatus({ status }: { status: QualityLearningInsight["status"] }): ReactNode {
  const label: Record<QualityLearningInsight["status"], string> = {
    proposed: "PROPOSED",
    approved: "APPROVED",
    activated: "ACTIVATED",
    rejected: "REJECTED",
  };
  const color: Record<QualityLearningInsight["status"], string> = {
    proposed: "var(--color-gold)",
    approved: "var(--color-secondary)",
    activated: "var(--color-ok)",
    rejected: "var(--color-muted)",
  };
  return <span style={{ ...eyebrow, color: color[status] }}>{label[status]}</span>;
}

const eyebrow = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.58rem",
  letterSpacing: "0.09em",
  textTransform: "uppercase" as const,
  color: "var(--color-faint)",
};

const description = {
  fontSize: "0.72rem",
  lineHeight: 1.4,
  color: "var(--color-muted)",
};

const empty = {
  marginTop: "0.75rem",
  padding: "0.72rem",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "var(--color-surface-solid)",
  color: "var(--color-muted)",
  fontSize: "0.72rem",
};

const item = {
  padding: "0.7rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  background: "var(--color-surface-solid)",
};
