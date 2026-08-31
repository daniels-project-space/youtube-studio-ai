import { fmtUsd } from "@/lib/format";
import styles from "./ChannelOperatingStatusStrip.module.css";

type OperatingChannel = {
  name: string;
  status: string;
  budget: number;
  pipeline?: Array<{ block: string; params?: unknown }>;
  schedule?: {
    frequency?: string;
    days?: number[];
    timezone?: string;
    localTime?: string;
    enabled?: boolean;
  };
};

type OperatingConnector = {
  ytTitle: string | null;
  ytChannelId: string | null;
  status: "active" | "revoked" | "error";
  scopeHealth: "healthy" | "partial" | "unknown";
  updatedAt: number;
};

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A small read-only operational truth layer for Settings. Every field comes
 * from the persisted channel or linked YouTube connector; it intentionally
 * does not infer readiness, output quality, or a future publishing result.
 */
export function ChannelOperatingStatusStrip({
  channel,
  connector,
  connectorLoading,
}: {
  channel: OperatingChannel;
  connector?: OperatingConnector;
  connectorLoading: boolean;
}) {
  const schedule = scheduleText(channel.schedule);
  const connection = connectionText(connector, connectorLoading);
  const publishMode = publishModeText(channel.pipeline);

  return (
    <section className={styles.section} aria-label={`${channel.name} operating state`}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>Operating reality</span>
        <span className={styles.caption}>Persisted channel policy and latest linked-account state</span>
      </div>
      <div className={styles.grid}>
        <Fact label="Automation" value={channel.status} tone={channel.status === "active" ? "ok" : "warn"} detail="Persisted channel status" />
        <Fact label="Cadence" value={schedule.value} tone={schedule.tone} detail={schedule.detail} />
        <Fact label="YouTube" value={connection.value} tone={connection.tone} detail={connection.detail} />
        <Fact label="Pipeline" value={`${channel.pipeline?.length ?? 0} modules`} detail={publishMode} />
        <Fact label="Run budget" value={fmtUsd(channel.budget ?? 0)} detail="Persisted per-run ceiling" />
      </div>
    </section>
  );
}

function Fact({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "ok" | "warn" | "bad";
}) {
  return (
    <div className={styles.item}>
      <span className={styles.label}>{label}</span>
      <strong className={styles.value} data-tone={tone}>{value}</strong>
      <span className={styles.detail}>{detail}</span>
    </div>
  );
}

function scheduleText(schedule: OperatingChannel["schedule"]) {
  if (schedule?.enabled === false) {
    return { value: "Scheduler off", detail: "Pinned releases stay visible", tone: "warn" as const };
  }
  const frequency = schedule?.frequency ?? "weekly";
  const days = (schedule?.days ?? []).map((day) => DAY[day]).filter(Boolean);
  const time = schedule?.localTime ?? "09:00";
  const zone = schedule?.timezone ?? "UTC";
  return {
    value: frequency === "biweekly" ? "Every 2 weeks" : frequency[0].toUpperCase() + frequency.slice(1),
    detail: `${days.length ? days.join(" · ") : "Channel default"} · ${time} ${zone}`,
    tone: "ok" as const,
  };
}

function connectionText(connector: OperatingConnector | undefined, loading: boolean) {
  if (loading) return { value: "Checking", detail: "Loading linked account state", tone: undefined };
  if (!connector) return { value: "Not linked", detail: "Publishing and ingestion unavailable", tone: "warn" as const };
  if (connector.status !== "active") {
    return { value: connector.status === "revoked" ? "Revoked" : "Needs reconnect", detail: "Publishing and ingestion unavailable", tone: "bad" as const };
  }
  if (connector.scopeHealth !== "healthy") {
    return { value: "Partial scopes", detail: connector.ytTitle ?? connector.ytChannelId ?? "Destination linked", tone: "warn" as const };
  }
  return { value: "Linked", detail: connector.ytTitle ?? connector.ytChannelId ?? "Latest linked destination", tone: "ok" as const };
}

function publishModeText(pipeline: OperatingChannel["pipeline"]) {
  const entry = pipeline?.find((candidate) => candidate.block === "upload_draft");
  if (!entry) return "No upload module recorded";
  const params = entry?.params;
  const mode = params && typeof params === "object" && "publishMode" in params
    ? (params as { publishMode?: unknown }).publishMode
    : undefined;
  if (mode === "public" || mode === "scheduled") return `${mode[0].toUpperCase()}${mode.slice(1)} release policy`;
  return "Private draft policy default";
}
