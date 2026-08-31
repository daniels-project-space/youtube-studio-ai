"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { PageHeader } from "@/components/PageHeader";
import { SkeletonList } from "@/components/Skeleton";
import { ChannelOperatingStatusStrip } from "@/components/ChannelOperatingStatusStrip";
import { useSelectedChannel } from "@/lib/channel-context";
import { useOwnerId } from "@/lib/owner-context";
import type { ChannelRow } from "@/lib/types";
import styles from "./settings.module.css";

type SettingsTab = "account" | "production" | "publishing" | "learning";
type PublishMode = "draft" | "scheduled" | "public";
type ApprovalMode = "manual" | "private_auto";

type ScheduleConfig = {
  frequency?: string;
  days?: number[];
  timezone?: string;
  localTime?: string;
  enabled?: boolean;
  approvalMode?: ApprovalMode;
  dailyQuota?: number;
  maxConcurrent?: number;
  retryMaxAttempts?: number;
  retryBaseMinutes?: number;
  madeForKids?: boolean;
};

type PipelineEntry = {
  block: string;
  params?: Record<string, unknown>;
};

type SettingsChannel = Omit<ChannelRow, "pipeline"> & {
  schedule?: ScheduleConfig;
  pipeline?: PipelineEntry[];
};

type YoutubeConnector = {
  channelId: string;
  ytTitle: string | null;
  ytChannelId: string | null;
  status: "active" | "revoked" | "error";
  scopeHealth: "healthy" | "partial" | "unknown";
  updatedAt: number;
};

interface PublishIntentRow {
  _id: string;
  channelId: string;
  title: string;
  status: string;
  privacyStatus: string;
  publishAt?: number;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: number;
  videoSha256: string;
}

interface LearningRecommendationRow {
  _id: string;
  channelId: string;
  kind: string;
  target: string;
  status: string;
  basePolicyVersion: number;
  proposedPolicyVersion: number;
  sourceVideoIds: string[];
  dataWindowStart: string;
  dataWindowEnd: string;
  proposal: unknown;
  offlineEvaluation: {
    method: string;
    sampleSize: number;
    baselineScore?: number;
    candidateScore?: number;
    passed: boolean;
    notes: string;
  };
  createdAt: number;
}

interface ShowBibleClaimRow {
  claimId: string;
  channelId: string;
  recommendationKey: string;
  basePolicyVersion: number;
  proposedPolicyVersion: number;
  status: string;
  providerStartedAt?: number;
  providerDispatchStartedAt?: number;
  ambiguousAt?: number;
  deferredAt?: number;
  deferredAdmissionDay?: string;
  deferredReason?: string;
  preProviderAttempts: number;
  operatorResolutionAudit: Array<{
    action: string;
    actor: string;
    reason: string;
    evidence: string;
    attestedAt: number;
    resolvedAt: number;
  }>;
  operatorResolutionCount: number;
  lastError?: string;
  recommendationId?: string;
  createdAt: number;
  updatedAt: number;
  rearmAllowed: boolean;
}

type ShowBibleRearmDraft = {
  reason: string;
  evidence: string;
  verifiedNoDispatch: boolean;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDate(value?: number): string {
  return value ? new Date(value).toLocaleString() : "Not scheduled";
}

function proposalSummary(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 420 ? `${text.slice(0, 420)}…` : text;
  } catch {
    return "Proposal details unavailable";
  }
}

function showBibleClaimStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    claimed: "Waiting to generate",
    deferred_owner_budget: "Waiting for daily allowance",
    provider_started: "Needs no-dispatch review",
    provider_dispatch_started: "Generation may be in progress",
    ambiguous: "Needs reconciliation",
    finalized: "Proposal saved",
    pre_provider_exhausted: "Generation did not start",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

function showBibleClaimStatusDescription(status: string): string {
  const descriptions: Record<string, string> = {
    claimed:
      "This proposal is safely queued for a bounded generation attempt.",
    deferred_owner_budget:
      "The daily generation allowance is full. This proposal is retained and will be considered fairly on a later run.",
    provider_started:
      "Preparation stopped before the system recorded a generation as sent. An owner may reopen it only after verifying that no provider request left the system.",
    provider_dispatch_started:
      "A generation was marked as started. It will not be retried automatically because another request could duplicate the work.",
    ambiguous:
      "The outcome is uncertain and remains held for reconciliation. It will not be retried automatically.",
    finalized: "The evaluated proposal was saved for normal policy review.",
    pre_provider_exhausted:
      "The proposal used its bounded preparation attempts without starting a generation.",
  };
  return descriptions[status] ?? "This proposal state is retained for audit.";
}

function showBibleClaimStateClass(status: string): string {
  if (status === "finalized") return styles.stateOk;
  if (status === "ambiguous" || status === "pre_provider_exhausted") {
    return styles.stateBad;
  }
  return "";
}

function canSubmitShowBibleRearm(draft: ShowBibleRearmDraft): boolean {
  return (
    draft.verifiedNoDispatch &&
    draft.reason.trim().length >= 12 &&
    draft.evidence.trim().length >= 20
  );
}

function currentPublishMode(channel: SettingsChannel): PublishMode {
  const value = channel.pipeline?.find(
    (entry) => entry.block === "upload_draft",
  )?.params?.publishMode;
  return value === "public" || value === "scheduled" ? value : "draft";
}

function channelSettingsVersion(channel: SettingsChannel): string {
  return JSON.stringify({
    status: channel.status,
    budget: channel.budget,
    schedule: channel.schedule ?? null,
    pipeline: channel.pipeline ?? [],
  });
}

export default function SettingsPage() {
  const ownerId = useOwnerId();
  const { selectedSlug, setSelectedSlug } = useSelectedChannel();
  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | SettingsChannel[]
    | undefined;
  const connectors = useQuery(api.youtubeAuth.linkStatus, { ownerId }) as
    | YoutubeConnector[]
    | undefined;

  const [tab, setTab] = useState<SettingsTab>("account");
  const [intents, setIntents] = useState<PublishIntentRow[]>([]);
  const [recommendations, setRecommendations] = useState<
    LearningRecommendationRow[]
  >([]);
  const [showBibleClaims, setShowBibleClaims] = useState<ShowBibleClaimRow[]>(
    [],
  );
  const [loadingGovernance, setLoadingGovernance] = useState(false);
  const [governanceLoaded, setGovernanceLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadGovernance = useCallback(async () => {
    setLoadingGovernance(true);
    setError(null);
    try {
      const [publishResponse, learningResponse] = await Promise.all([
        fetch("/api/publish-intents", { cache: "no-store" }),
        fetch("/api/learning-recommendations", { cache: "no-store" }),
      ]);
      const [publishBody, learningBody] = (await Promise.all([
        publishResponse.json(),
        learningResponse.json(),
      ])) as [
        { intents?: PublishIntentRow[]; error?: string },
        {
          recommendations?: LearningRecommendationRow[];
          showBibleClaims?: ShowBibleClaimRow[];
          error?: string;
        },
      ];
      if (!publishResponse.ok) {
        throw new Error(
          publishBody.error ?? "Could not load publishing approvals",
        );
      }
      if (!learningResponse.ok) {
        throw new Error(
          learningBody.error ?? "Could not load learning proposals",
        );
      }
      setIntents(
        [...(publishBody.intents ?? [])].sort(
          (a, b) => b.createdAt - a.createdAt,
        ),
      );
      setRecommendations(
        [...(learningBody.recommendations ?? [])].sort(
          (a, b) => b.createdAt - a.createdAt,
        ),
      );
      setShowBibleClaims(
        [...(learningBody.showBibleClaims ?? [])].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    } finally {
      setLoadingGovernance(false);
      setGovernanceLoaded(true);
    }
  }, []);

  useEffect(() => {
    if ((tab !== "publishing" && tab !== "learning") || governanceLoaded) return;
    const timer = window.setTimeout(() => {
      void loadGovernance();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [governanceLoaded, loadGovernance, tab]);

  const selectedChannel = useMemo(
    () =>
      channels?.find((channel) => channel.slug === selectedSlug) ??
      channels?.[0],
    [channels, selectedSlug],
  );
  const connector = connectors?.find(
    (candidate) => candidate.channelId === selectedChannel?._id,
  );

  const selectedIntents = useMemo(
    () =>
      selectedChannel
        ? intents.filter((intent) => intent.channelId === selectedChannel._id)
        : [],
    [intents, selectedChannel],
  );
  const pendingIntents = useMemo(
    () =>
      selectedIntents.filter((intent) => intent.status === "awaiting_approval"),
    [selectedIntents],
  );
  const pendingRecommendations = useMemo(
    () =>
      selectedChannel
        ? recommendations.filter(
            (recommendation) =>
              recommendation.channelId === selectedChannel._id &&
              recommendation.status === "proposed",
          )
        : [],
    [recommendations, selectedChannel],
  );
  const selectedShowBibleClaims = useMemo(
    () =>
      selectedChannel
        ? showBibleClaims.filter((claim) => claim.channelId === selectedChannel._id)
        : [],
    [selectedChannel, showBibleClaims],
  );
  const learningAttentionCount =
    pendingRecommendations.length +
    selectedShowBibleClaims.filter((claim) => claim.rearmAllowed).length;

  const act = async (
    endpoint: string,
    body: Record<string, unknown>,
    id: string,
  ) => {
    setBusyId(id);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Operator action failed");
      await loadGovernance();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : String(actionError),
      );
    } finally {
      setBusyId(null);
    }
  };

  const tabs: { id: SettingsTab; label: string; count?: number }[] = [
    { id: "account", label: "Account" },
    { id: "production", label: "Production" },
    { id: "publishing", label: "Publishing", count: pendingIntents.length },
    { id: "learning", label: "Learning", count: learningAttentionCount },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        title="Settings"
        subtitle="Control one channel at a time, with every production change saved to the live workspace"
        actions={tab === "publishing" || tab === "learning" ? (
          <button
            type="button"
            className={styles.button}
            onClick={() => void loadGovernance()}
            disabled={loadingGovernance}
          >
            {loadingGovernance ? "Refreshing…" : "Refresh"}
          </button>
        ) : undefined}
      />

      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      <section
        className={`glass ${styles.scopeCard}`}
        aria-label="Settings scope"
      >
        <div>
          <span className={styles.eyebrow}>Editing channel</span>
          <strong>{selectedChannel?.name ?? "Select a channel"}</strong>
        </div>
        <select
          className={styles.select}
          value={selectedChannel?.slug ?? ""}
          onChange={(event) => setSelectedSlug(event.target.value || null)}
          disabled={!channels?.length}
          aria-label="Channel to configure"
        >
          {(channels ?? []).map((channel) => (
            <option key={channel._id} value={channel.slug}>
              {channel.name}
            </option>
          ))}
        </select>
      </section>

      {selectedChannel && (
        <ChannelOperatingStatusStrip
          channel={selectedChannel}
          connector={connector}
          connectorLoading={connectors === undefined}
        />
      )}

      <nav
        className={styles.tabs}
        aria-label="Settings sections"
        role="tablist"
      >
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`${styles.tab} ${tab === item.id ? styles.tabActive : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.count ? <span>{item.count}</span> : null}
          </button>
        ))}
      </nav>

      {channels === undefined ? (
        <SkeletonList rows={4} />
      ) : !selectedChannel ? (
        <div className={`glass ${styles.empty}`}>
          Add a channel before configuring production settings.
        </div>
      ) : (
        <ChannelSettingsPanel
          key={`${selectedChannel._id}:${channelSettingsVersion(selectedChannel)}`}
          tab={tab}
          channel={selectedChannel}
          connector={connector}
          connectorsLoading={connectors === undefined}
          intents={selectedIntents}
          pendingIntents={pendingIntents}
          pendingRecommendations={pendingRecommendations}
          showBibleClaims={selectedShowBibleClaims}
          loadingGovernance={loadingGovernance}
          busyId={busyId}
          act={act}
          onError={setError}
        />
      )}
    </div>
  );
}

function ChannelSettingsPanel({
  tab,
  channel,
  connector,
  connectorsLoading,
  intents,
  pendingIntents,
  pendingRecommendations,
  showBibleClaims,
  loadingGovernance,
  busyId,
  act,
  onError,
}: {
  tab: SettingsTab;
  channel: SettingsChannel;
  connector?: YoutubeConnector;
  connectorsLoading: boolean;
  intents: PublishIntentRow[];
  pendingIntents: PublishIntentRow[];
  pendingRecommendations: LearningRecommendationRow[];
  showBibleClaims: ShowBibleClaimRow[];
  loadingGovernance: boolean;
  busyId: string | null;
  act: (
    endpoint: string,
    body: Record<string, unknown>,
    id: string,
  ) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const schedule = channel.schedule ?? {};
  const [busySetting, setBusySetting] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [budget, setBudget] = useState(String(channel.budget ?? 0));
  const [publishMode, setPublishMode] = useState<PublishMode>(
    currentPublishMode(channel),
  );
  const [frequency, setFrequency] = useState(schedule.frequency ?? "weekly");
  const [days, setDays] = useState<number[]>(
    schedule.days?.length ? schedule.days : [1],
  );
  const [timezone, setTimezone] = useState(schedule.timezone ?? "UTC");
  const [localTime, setLocalTime] = useState(schedule.localTime ?? "09:00");
  const [scheduleEnabled, setScheduleEnabled] = useState(
    schedule.enabled !== false,
  );
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(
    schedule.approvalMode ?? "manual",
  );
  const [dailyQuota, setDailyQuota] = useState(
    String(schedule.dailyQuota ?? 1),
  );
  const [maxConcurrent, setMaxConcurrent] = useState(
    String(schedule.maxConcurrent ?? 1),
  );
  const [retryMaxAttempts, setRetryMaxAttempts] = useState(
    String(schedule.retryMaxAttempts ?? 5),
  );
  const [retryBaseMinutes, setRetryBaseMinutes] = useState(
    String(schedule.retryBaseMinutes ?? 15),
  );
  const [madeForKids, setMadeForKids] = useState(schedule.madeForKids === true);
  const [openRearmClaimId, setOpenRearmClaimId] = useState<string | null>(
    null,
  );
  const [showBibleRearmDrafts, setShowBibleRearmDrafts] = useState<
    Record<string, ShowBibleRearmDraft>
  >({});

  const hasConfiguredCrosspost = channel.pipeline?.some(
    (entry) =>
      entry.block === "crosspost" ||
      (entry.block === "shorts_spinoff" &&
        entry.params?.crosspostShort === true),
  );
  const publishingOperational =
    channel.status === "active" &&
    connector?.status === "active" &&
    connector.scopeHealth !== "partial";

  const updateShowBibleRearmDraft = (
    claimId: string,
    update: Partial<ShowBibleRearmDraft>,
  ) => {
    setShowBibleRearmDrafts((current) => {
      const currentDraft = current[claimId] ?? {
        reason: "",
        evidence: "",
        verifiedNoDispatch: false,
      };
      return {
        ...current,
        [claimId]: { ...currentDraft, ...update },
      };
    });
  };

  const postSetting = async (
    action: string,
    payload: Record<string, unknown>,
    success: string,
  ) => {
    setBusySetting(action);
    setMessage(null);
    onError(null);
    try {
      const response = await fetch("/api/channel-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: channel._id, action, ...payload }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Settings update failed");
      setMessage(success);
      return true;
    } catch (settingError) {
      onError(
        settingError instanceof Error
          ? settingError.message
          : "Settings update failed",
      );
      return false;
    } finally {
      setBusySetting(null);
    }
  };

  const setStatus = async () => {
    const next = channel.status === "active" ? "paused" : "active";
    const publishingUnavailable =
      connector?.status !== "active" || connector.scopeHealth === "partial";
    if (
      next === "active" &&
      !window.confirm(
        `Enable automated channel runs? Active runs may consume the configured render budget.${publishingUnavailable ? " YouTube publishing will remain unavailable until this channel is reconnected with healthy scopes." : ""}`,
      )
    ) {
      return;
    }
    await postSetting("status", { status: next }, `Channel ${next}.`);
  };

  const saveBudget = async () => {
    const value = Number(budget);
    if (!Number.isFinite(value) || value < 0 || value > 10_000) {
      onError("Budget must be between $0 and $10,000 per run.");
      return;
    }
    await postSetting("budget", { budget: value }, "Render budget saved.");
  };

  const savePublishMode = async (mode: PublishMode) => {
    if (
      mode !== "draft" &&
      !window.confirm(
        `Approve automatic ${mode} YouTube publishing for ${channel.name}?`,
      )
    ) {
      return;
    }
    const saved = await postSetting(
      "publish_mode",
      { mode },
      mode === "draft"
        ? "Publishing returned to private drafts."
        : `Automatic ${mode} publishing approved for this configuration.`,
    );
    if (saved) setPublishMode(mode);
  };

  const saveSchedule = async () => {
    await postSetting(
      "schedule",
      {
        schedule: {
          frequency,
          days,
          timezone: timezone.trim(),
          localTime,
          enabled: scheduleEnabled,
          approvalMode,
          dailyQuota: Number(dailyQuota),
          maxConcurrent: Number(maxConcurrent),
          retryMaxAttempts: Number(retryMaxAttempts),
          retryBaseMinutes: Number(retryBaseMinutes),
          madeForKids,
        },
      },
      "Scheduler, quota, and retry policy saved.",
    );
  };

  const setCrosspostApproval = async (approved: boolean) => {
    if (
      approved &&
      !window.confirm(
        "Approve automatic publishing to every platform configured in this channel's cross-post module?",
      )
    ) {
      return;
    }
    await postSetting(
      "crosspost_policy",
      { approved },
      approved ? "Cross-posting approved." : "Cross-posting revoked.",
    );
  };

  const revokeYoutube = async () => {
    if (
      !window.confirm(
        "Revoke this channel's YouTube access? Pending uploads will be blocked and the channel will be paused.",
      )
    ) {
      return;
    }
    setBusySetting("youtube");
    setMessage(null);
    onError(null);
    try {
      const response = await fetch("/api/youtube-revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channelId: channel._id,
          reason: "revoked from operator settings",
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        dataPolicy?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "YouTube revocation failed");
      setMessage(
        result.dataPolicy ?? "YouTube access revoked and channel paused.",
      );
    } catch (revokeError) {
      onError(
        revokeError instanceof Error
          ? revokeError.message
          : "Revocation failed",
      );
    } finally {
      setBusySetting(null);
    }
  };

  const toggleDay = (day: number) => {
    setDays((current) =>
      current.includes(day)
        ? current.length === 1
          ? current
          : current.filter((value) => value !== day)
        : [...current, day].sort((a, b) => a - b),
    );
  };

  return (
    <div className={styles.content}>
      {message && (
        <div className={styles.success} role="status">
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}

      {tab === "account" && (
        <div className={styles.twoColumn}>
          <article className={`glass ${styles.card}`}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.eyebrow}>Channel account</span>
                <h2>{channel.name}</h2>
                <p>
                  Identity and automation eligibility for this workspace
                  channel.
                </p>
              </div>
              <span
                className={`${styles.state} ${channel.status === "active" ? styles.stateOk : ""}`}
              >
                {channel.status}
              </span>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Slug</dt>
                <dd>{channel.slug}</dd>
              </div>
              <div>
                <dt>Template</dt>
                <dd>{channel.template}</dd>
              </div>
              <div>
                <dt>Niche</dt>
                <dd>{channel.identity?.niche ?? "Not set"}</dd>
              </div>
              <div>
                <dt>Pipeline</dt>
                <dd>{channel.pipeline?.length ?? 0} modules</dd>
              </div>
            </dl>
            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.button} ${channel.status === "active" ? styles.dangerButton : styles.primaryButton}`}
                onClick={() => void setStatus()}
                disabled={busySetting === "status"}
              >
                {busySetting === "status"
                  ? "Saving…"
                  : channel.status === "active"
                    ? "Pause automation"
                    : "Activate channel"}
              </button>
              <a
                className={styles.button}
                href={`/channels/${channel.slug}?tab=settings`}
              >
                Advanced channel setup
              </a>
            </div>
          </article>

          <article className={`glass ${styles.card}`}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.eyebrow}>Publishing account</span>
                <h2>YouTube connection</h2>
                <p>
                  The exact destination used for publishing and analytics
                  ingestion.
                </p>
              </div>
              <span
                className={`${styles.state} ${connector?.status === "active" ? styles.stateOk : ""}`}
              >
                {connectorsLoading
                  ? "checking"
                  : (connector?.status ?? "not linked")}
              </span>
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Destination</dt>
                <dd>
                  {connector?.ytTitle ?? connector?.ytChannelId ?? "None"}
                </dd>
              </div>
              <div>
                <dt>Scope health</dt>
                <dd>{connector?.scopeHealth ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>Last verified</dt>
                <dd>{fmtDate(connector?.updatedAt)}</dd>
              </div>
            </dl>
            <div className={styles.actions}>
              <a
                className={`${styles.button} ${styles.primaryButton}`}
                href={`/api/youtube-connect?channelId=${channel._id}`}
              >
                {connector?.status === "active"
                  ? "Reconnect YouTube"
                  : "Connect YouTube"}
              </a>
              {connector?.status === "active" && (
                <button
                  type="button"
                  className={`${styles.button} ${styles.dangerButton}`}
                  onClick={() => void revokeYoutube()}
                  disabled={busySetting === "youtube"}
                >
                  {busySetting === "youtube" ? "Revoking…" : "Revoke access"}
                </button>
              )}
            </div>
          </article>
        </div>
      )}

      {tab === "production" && (
        <div className={styles.stack}>
          <article className={`glass ${styles.card}`}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.eyebrow}>Cost control</span>
                <h2>Render budget</h2>
                <p>Hard per-run budget recorded on the selected channel.</p>
              </div>
            </div>
            <div className={styles.formRow}>
              <label className={styles.field}>
                <span>Maximum USD per run</span>
                <input
                  className={styles.input}
                  type="number"
                  min="0"
                  max="10000"
                  step="0.5"
                  value={budget}
                  onChange={(event) => setBudget(event.target.value)}
                />
              </label>
              <button
                type="button"
                className={`${styles.button} ${styles.primaryButton}`}
                onClick={() => void saveBudget()}
                disabled={busySetting === "budget"}
              >
                {busySetting === "budget" ? "Saving…" : "Save budget"}
              </button>
            </div>
          </article>

          <article className={`glass ${styles.card}`}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.eyebrow}>Automation</span>
                <h2>Scheduler and retry policy</h2>
                <p>
                  Generation cadence, upload concurrency, and recovery limits.
                </p>
              </div>
            </div>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Frequency</span>
                <select
                  className={styles.select}
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value)}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>IANA timezone</span>
                <input
                  className={styles.input}
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>Local run time</span>
                <input
                  className={styles.input}
                  type="time"
                  value={localTime}
                  onChange={(event) => setLocalTime(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>Approval mode</span>
                <select
                  className={styles.select}
                  value={approvalMode}
                  onChange={(event) =>
                    setApprovalMode(event.target.value as ApprovalMode)
                  }
                >
                  <option value="manual">Manual intent approval</option>
                  <option value="private_auto">Automatic private drafts</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Daily upload quota</span>
                <input
                  className={styles.input}
                  type="number"
                  min="1"
                  max="50"
                  value={dailyQuota}
                  onChange={(event) => setDailyQuota(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>Maximum concurrent</span>
                <input
                  className={styles.input}
                  type="number"
                  min="1"
                  max="10"
                  value={maxConcurrent}
                  onChange={(event) => setMaxConcurrent(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>Retry attempts</span>
                <input
                  className={styles.input}
                  type="number"
                  min="1"
                  max="12"
                  value={retryMaxAttempts}
                  onChange={(event) => setRetryMaxAttempts(event.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span>Retry base minutes</span>
                <input
                  className={styles.input}
                  type="number"
                  min="1"
                  max="1440"
                  value={retryBaseMinutes}
                  onChange={(event) => setRetryBaseMinutes(event.target.value)}
                />
              </label>
            </div>
            {(frequency === "weekly" || frequency === "biweekly") && (
              <div className={styles.dayPicker} aria-label="Run days">
                {DAYS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    className={`${styles.day} ${days.includes(day) ? styles.dayActive : ""}`}
                    aria-pressed={days.includes(day)}
                    onClick={() => toggleDay(day)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className={styles.checks}>
              <label>
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(event) => setScheduleEnabled(event.target.checked)}
                />{" "}
                Scheduler enabled
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={madeForKids}
                  onChange={(event) => setMadeForKids(event.target.checked)}
                />{" "}
                Made for kids
              </label>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.button} ${styles.primaryButton}`}
                onClick={() => void saveSchedule()}
                disabled={busySetting === "schedule"}
              >
                {busySetting === "schedule" ? "Saving…" : "Save scheduler"}
              </button>
              <a className={styles.button} href="/schedule">
                Open schedule
              </a>
            </div>
          </article>
        </div>
      )}

      {tab === "publishing" && (
        <div className={styles.stack}>
          <article className={`glass ${styles.card}`}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.eyebrow}>Release policy</span>
                <h2>Main-video publishing</h2>
                <p>
                  Public and scheduled modes require explicit operator approval.
                </p>
              </div>
            </div>
            <div className={styles.formRow}>
              <label className={styles.field}>
                <span>Configured destination mode</span>
                <select
                  className={styles.select}
                  value={publishMode}
                  onChange={(event) =>
                    void savePublishMode(event.target.value as PublishMode)
                  }
                  disabled={busySetting === "publish_mode"}
                >
                  <option value="draft">Private draft</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="public">Public immediately</option>
                </select>
              </label>
              {publishMode !== "draft" && (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void savePublishMode(publishMode)}
                  disabled={busySetting === "publish_mode"}
                >
                  Reapprove current mode
                </button>
              )}
            </div>
            <p className={styles.policyNote} data-operational={publishingOperational ? "true" : undefined}>
              {publishMode === "draft"
                ? "Private-draft mode is configured. Runtime authorization is still checked for every upload."
                : publishingOperational
                  ? `${publishMode === "public" ? "Public" : "Scheduled"} mode is configured; the live policy is revalidated before every publish.`
                  : `${publishMode === "public" ? "Public" : "Scheduled"} mode is configured but inactive until the channel and YouTube connection are healthy.`}
            </p>
            {hasConfiguredCrosspost && (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.primaryButton}`}
                  onClick={() => void setCrosspostApproval(true)}
                  disabled={busySetting === "crosspost_policy"}
                >
                  Approve cross-posting
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.dangerButton}`}
                  onClick={() => void setCrosspostApproval(false)}
                  disabled={busySetting === "crosspost_policy"}
                >
                  Revoke cross-posting
                </button>
              </div>
            )}
          </article>

          <section>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Approval queue</span>
                <h2>Uploads waiting for you</h2>
              </div>
              <span className={styles.count}>{pendingIntents.length}</span>
            </div>
            {loadingGovernance ? (
              <SkeletonList rows={3} />
            ) : pendingIntents.length === 0 ? (
              <div className={`glass ${styles.empty}`}>
                No uploads are waiting for approval.
              </div>
            ) : (
              <div className={styles.list}>
                {pendingIntents.map((intent) => (
                  <article
                    key={intent._id}
                    className={`glass ${styles.queueCard}`}
                  >
                    <div className={styles.queueTitle}>
                      <strong>{intent.title}</strong>
                      <span className={styles.state}>
                        {intent.privacyStatus}
                      </span>
                    </div>
                    <p>
                      {fmtDate(intent.publishAt)} · artifact{" "}
                      {intent.videoSha256.slice(0, 12)}…
                    </p>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.primaryButton}`}
                        disabled={busyId === intent._id}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Approve ${intent.privacyStatus} publishing for “${intent.title}”?`,
                            )
                          )
                            return;
                          void act(
                            "/api/publish-intents",
                            {
                              action: "approve",
                              intentId: intent._id,
                              evidence: "approved in operator settings",
                            },
                            intent._id,
                          );
                        }}
                      >
                        Approve upload
                      </button>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.dangerButton}`}
                        disabled={busyId === intent._id}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Cancel the pending upload for “${intent.title}”?`,
                            )
                          )
                            return;
                          void act(
                            "/api/publish-intents",
                            { action: "cancel", intentId: intent._id },
                            intent._id,
                          );
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <details className={`glass ${styles.history}`}>
            <summary>
              Recent durable publishing history ({intents.length})
            </summary>
            <div className={styles.historyRows}>
              {intents.slice(0, 12).map((intent) => (
                <div key={intent._id}>
                  <span>{intent.title}</span>
                  <small>
                    {intent.status} · {intent.attempts}/{intent.maxAttempts}
                  </small>
                </div>
              ))}
              {intents.length === 0 && <p>No publishing history yet.</p>}
            </div>
          </details>
        </div>
      )}

      {tab === "learning" && (
        <div className={styles.stack}>
          <section aria-labelledby="show-bible-proposal-status">
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Generation safeguard</span>
                <h2 id="show-bible-proposal-status">Show Bible proposal status</h2>
              </div>
              <span className={styles.count}>{showBibleClaims.length}</span>
            </div>
            {loadingGovernance ? (
              <SkeletonList rows={2} />
            ) : showBibleClaims.length === 0 ? (
              <div className={`glass ${styles.empty}`}>
                No Show Bible proposal activity has been recorded for this channel.
              </div>
            ) : (
              <div className={styles.list}>
                {showBibleClaims.slice(0, 20).map((claim) => {
                  const draft = showBibleRearmDrafts[claim.claimId] ?? {
                    reason: "",
                    evidence: "",
                    verifiedNoDispatch: false,
                  };
                  const rearmActionId = `show-bible-rearm:${claim.claimId}`;
                  const rearmReady = canSubmitShowBibleRearm(draft);
                  return (
                    <article
                      key={claim.claimId}
                      className={`glass ${styles.queueCard}`}
                    >
                      <div className={styles.queueTitle}>
                        <strong>
                          Proposal policy v{claim.basePolicyVersion} → v
                          {claim.proposedPolicyVersion}
                        </strong>
                        <span
                          className={`${styles.state} ${showBibleClaimStateClass(claim.status)}`}
                        >
                          {showBibleClaimStatusLabel(claim.status)}
                        </span>
                      </div>
                      <p>{showBibleClaimStatusDescription(claim.status)}</p>
                      <dl className={styles.facts}>
                        <div>
                          <dt>Last recorded</dt>
                          <dd>{fmtDate(claim.updatedAt)}</dd>
                        </div>
                        <div>
                          <dt>Preparation attempts</dt>
                          <dd>{claim.preProviderAttempts}</dd>
                        </div>
                      </dl>
                      {claim.deferredReason ? (
                        <p className={styles.policyNote}>
                          Waiting note: {claim.deferredReason}
                        </p>
                      ) : null}
                      {claim.lastError ? (
                        <p className={styles.policyNote}>
                          Latest recorded note: {claim.lastError}
                        </p>
                      ) : null}
                      {claim.rearmAllowed ? (
                        <div className={styles.showBibleRecovery}>
                          <strong>Confirmed no-dispatch recovery</strong>
                          <p>
                            Use this only when your evidence proves that no
                            provider generation request was sent. It records
                            your review before allowing a controlled retry.
                          </p>
                          {openRearmClaimId === claim.claimId ? (
                            <form
                              className={styles.showBibleRecoveryForm}
                              onSubmit={(event) => {
                                event.preventDefault();
                                if (!rearmReady) return;
                                if (
                                  !window.confirm(
                                    "Reopen this Show Bible proposal only if you have verified that no generation request was sent. Your reason and evidence will be retained for audit.",
                                  )
                                )
                                  return;
                                void act(
                                  "/api/learning-recommendations",
                                  {
                                    action: "rearm_show_bible_no_dispatch",
                                    claimId: claim.claimId,
                                    reason: draft.reason,
                                    evidence: draft.evidence,
                                    verifiedNoDispatch: true,
                                  },
                                  rearmActionId,
                                );
                              }}
                            >
                              <label className={styles.field}>
                                <span>Why are you certain no generation was sent?</span>
                                <textarea
                                  className={`${styles.input} ${styles.showBibleTextarea}`}
                                  value={draft.reason}
                                  minLength={12}
                                  maxLength={1000}
                                  required
                                  onChange={(event) =>
                                    updateShowBibleRearmDraft(claim.claimId, {
                                      reason: event.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label className={styles.field}>
                                <span>What check proves this?</span>
                                <textarea
                                  className={`${styles.input} ${styles.showBibleTextarea}`}
                                  value={draft.evidence}
                                  minLength={20}
                                  maxLength={4000}
                                  required
                                  onChange={(event) =>
                                    updateShowBibleRearmDraft(claim.claimId, {
                                      evidence: event.target.value,
                                    })
                                  }
                                />
                              </label>
                              <label className={styles.checks}>
                                <input
                                  type="checkbox"
                                  checked={draft.verifiedNoDispatch}
                                  onChange={(event) =>
                                    updateShowBibleRearmDraft(claim.claimId, {
                                      verifiedNoDispatch: event.target.checked,
                                    })
                                  }
                                />
                                I verified that no provider generation request was sent.
                              </label>
                              <div className={styles.actions}>
                                <button
                                  type="submit"
                                  className={`${styles.button} ${styles.primaryButton}`}
                                  disabled={
                                    busyId === rearmActionId || !rearmReady
                                  }
                                >
                                  {busyId === rearmActionId
                                    ? "Recording…"
                                    : "Record verification & reopen"}
                                </button>
                                <button
                                  type="button"
                                  className={styles.button}
                                  disabled={busyId === rearmActionId}
                                  onClick={() => setOpenRearmClaimId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <button
                              type="button"
                              className={styles.button}
                              disabled={busyId === rearmActionId}
                              onClick={() => setOpenRearmClaimId(claim.claimId)}
                            >
                              Review no-dispatch recovery
                            </button>
                          )}
                        </div>
                      ) : null}
                      {claim.operatorResolutionCount > 0 ? (
                        <p className={styles.recoveryAudit}>
                          Confirmed recovery reviews retained: {claim.operatorResolutionCount}
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="learning-policy-review">
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>Evidence gate</span>
                <h2 id="learning-policy-review">Policy changes waiting for review</h2>
              </div>
              <span className={styles.count}>
                {pendingRecommendations.length}
              </span>
            </div>
            {loadingGovernance ? (
              <SkeletonList rows={3} />
            ) : pendingRecommendations.length === 0 ? (
              <div className={`glass ${styles.empty}`}>
                No evaluated policy changes are waiting for approval.
              </div>
            ) : (
              <div className={styles.list}>
                {pendingRecommendations.map((recommendation) => (
                  <article
                    key={recommendation._id}
                    className={`glass ${styles.queueCard}`}
                  >
                    <div className={styles.queueTitle}>
                      <strong>
                        {recommendation.kind.replaceAll("_", " ")} →{" "}
                        {recommendation.target.replaceAll("_", " ")}
                      </strong>
                      <span
                        className={`${styles.state} ${recommendation.offlineEvaluation.passed ? styles.stateOk : styles.stateBad}`}
                      >
                        offline{" "}
                        {recommendation.offlineEvaluation.passed
                          ? "passed"
                          : "failed"}
                      </span>
                    </div>
                    <p>
                      Policy v{recommendation.basePolicyVersion} → v
                      {recommendation.proposedPolicyVersion} ·{" "}
                      {recommendation.dataWindowStart} to{" "}
                      {recommendation.dataWindowEnd} · n=
                      {recommendation.offlineEvaluation.sampleSize}
                    </p>
                    <p className={styles.notes}>
                      {recommendation.offlineEvaluation.notes}
                    </p>
                    <code className={styles.code}>
                      {proposalSummary(recommendation.proposal)}
                    </code>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.primaryButton}`}
                        disabled={
                          busyId === recommendation._id ||
                          !recommendation.offlineEvaluation.passed
                        }
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Activate this evaluated policy version? The previous version remains in durable history.",
                            )
                          )
                            return;
                          void act(
                            "/api/learning-recommendations",
                            {
                              action: "approve_and_activate",
                              recommendationId: recommendation._id,
                            },
                            recommendation._id,
                          );
                        }}
                      >
                        Approve & activate
                      </button>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.dangerButton}`}
                        disabled={busyId === recommendation._id}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Reject this recommendation? Its evaluation history will remain available for audit.",
                            )
                          )
                            return;
                          void act(
                            "/api/learning-recommendations",
                            {
                              action: "reject",
                              recommendationId: recommendation._id,
                            },
                            recommendation._id,
                          );
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
