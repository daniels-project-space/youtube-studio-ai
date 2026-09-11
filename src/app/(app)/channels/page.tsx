"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import type { ChannelRow } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { ChannelAvatar, ChannelBanner } from "@/components/ChannelArt";
import { IconChannels } from "@/components/icons";
import { OwnerLockBadge } from "@/components/OwnerLockBadge";
import { ChannelFolderWorkspace } from "@/components/ChannelFolderWorkspace";
import { NicheMotionGlyph } from "@/components/NicheMotionGlyph";
import {
  useOperationsAccess,
  useRequestOperationsAccess,
} from "@/components/OperationsAccess";
import { fmtUsd } from "@/lib/format";
import {
  formatZonedScheduleTimestamp,
  nextProjectedPlanItem,
} from "@/lib/scheduleCalendar";
import {
  CHANNEL_PAGE_SIZE,
  channelsVisibleForFolder,
  isMainFleetChannel,
  pageChannels,
} from "./channelCardVisibility";
import { channelCategoryLabelFor, groupChannelsByCategory } from "./channelCategories";

type ChannelSchedule = {
  frequency?: string;
  days?: number[];
  localTime?: string;
  timezone?: string;
  enabled?: boolean;
  approvalMode?: "manual" | "private_auto";
  dailyQuota?: number;
  maxConcurrent?: number;
  retryMaxAttempts?: number;
  retryBaseMinutes?: number;
  madeForKids?: boolean;
};

type ChannelCardRow = ChannelRow & {
  folder?: string;
  schedule?: ChannelSchedule;
};

type PlanCardRow = {
  _id: string;
  channelSlug: string;
  order: number;
  title?: string;
  topic: string;
  status: string;
  scheduledAt?: number;
  thumbnailKey?: string;
  thumbnailSource?: "planner_artwork" | "rendered_video_frame";
};

type ChannelCardArtwork = {
  channelId: string;
  channelSlug: string;
  latestThumbnailKey: string | null;
  recentRunCount: number;
  recentPublishedCount: number;
  recentSpend: number;
  lastRunStatus: string | null;
};

type YoutubeLinkStatus = {
  channelId: string;
  ytChannelId?: string | null;
  status: "active" | "revoked" | "error";
  scopeHealth: "healthy" | "partial" | "unknown";
};

const blockLabel = (block: string) =>
  block.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());

function youtubeConnectionIssue(
  connector: YoutubeLinkStatus | undefined,
  creating: boolean,
): string {
  if (creating) return "YouTube setup running";
  if (!connector) return "YouTube not linked";
  if (connector.status === "revoked") return "YouTube link revoked";
  if (connector.status === "error") return "YouTube link error";
  if (connector.scopeHealth === "partial") return "OAuth scopes incomplete";
  if (connector.scopeHealth === "unknown") return "OAuth scopes unverified";
  if (!connector.ytChannelId) return "Destination unverified";
  return "YouTube not linked";
}

export default function ChannelsPage() {
  const ownerId = useOwnerId();
  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | ChannelCardRow[]
    | undefined;
  const folders = useQuery(api.folders.list, { ownerId }) as
    | { _id: string; name: string }[]
    | undefined;
  const plan = useQuery(api.contentPlan.listPlanByOwner, { ownerId }) as
    | PlanCardRow[]
    | undefined;
  const channelArtwork = useQuery(api.channels.listChannelCards, { ownerId }) as
    | ChannelCardArtwork[]
    | undefined;
  const links = useQuery(api.youtubeAuth.linkStatus, { ownerId }) as
    | YoutubeLinkStatus[]
    | undefined;
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(CHANNEL_PAGE_SIZE);
  const [managedChannelId, setManagedChannelId] = useState<string | null>(null);
  const inspectorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [viewStartedAt] = useState(() => Date.now());
  const closeInspector = useCallback(() => setManagedChannelId(null), []);
  const loading =
    channels === undefined ||
    folders === undefined ||
    plan === undefined ||
    channelArtwork === undefined ||
    links === undefined;
  const linkByChannel = new Map((links ?? []).map((link) => [link.channelId, link]));
  const publishReadyLinks = (links ?? []).filter(
    (link) =>
      link.status === "active" &&
      link.scopeHealth === "healthy" &&
      Boolean(link.ytChannelId),
  );
  const linkedIds = new Set(publishReadyLinks.map((link) => link.channelId));
  const ytIdByChannel = new Map(
    publishReadyLinks.map((link) => [link.channelId, link.ytChannelId ?? null]),
  );

  const mainFleetCount = (channels ?? []).filter(isMainFleetChannel).length;
  const visible = channelsVisibleForFolder(channels ?? [], openFolder);
  const fleetPage = pageChannels(visible, visibleLimit);
  const fleetGroups = openFolder === null
    ? groupChannelsByCategory(fleetPage.visible)
    : [{ key: "room", label: `${openFolder} room`, channels: fleetPage.visible }];
  const readyPlanBySlug = new Map<string, PlanCardRow[]>();
  for (const item of plan ?? []) {
    if (item.status !== "ready") continue;
    const items = readyPlanBySlug.get(item.channelSlug) ?? [];
    items.push(item);
    readyPlanBySlug.set(item.channelSlug, items);
  }
  const managedChannel = (channels ?? []).find((channel) => channel._id === managedChannelId);
  const managedArtwork = managedChannel
    ? channelArtwork?.find(
        (art) => art.channelId === managedChannel._id || art.channelSlug === managedChannel.slug,
      )
    : undefined;
  const managedConnector = managedChannel ? linkByChannel.get(managedChannel._id) : undefined;
  const managedLinked = managedChannel ? linkedIds.has(managedChannel._id) : false;
  const managedYtId = managedChannel
    ? ytIdByChannel.get(managedChannel._id) || managedChannel.youtubeCreated?.ytChannelId || null
    : null;

  return (
    <>
      <PageHeader
        title="Channels"
        actions={
          <div className="channel-page-actions">
            <Link
              href="/channels/new"
              className="studio-action"
            >
              + New channel
            </Link>
          </div>
        }
      />

      {!loading ? (
        <ChannelFolderWorkspace
          channels={channels}
          folders={folders}
          selectedFolder={openFolder}
          standaloneCount={mainFleetCount}
          onSelect={(folder) => {
            setOpenFolder(folder);
            setVisibleLimit(CHANNEL_PAGE_SIZE);
            setManagedChannelId(null);
          }}
        />
      ) : null}

      {loading ? (
        <SkeletonList rows={4} />
      ) : channels.length === 0 ? (
        <EmptyState
          title="No channels yet"
          description="Create your first channel."
          icon={<IconChannels width={24} height={24} />}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={openFolder ? "No channels in this room" : "No standalone channels"}
          description={openFolder ? "Move a channel into this room to operate it here." : "Multi-language channel families are available from their room."}
          icon={<IconChannels width={24} height={24} />}
        />
      ) : (
        <>
          <div className="channel-category-list" aria-label={openFolder ? `${openFolder} channels` : "Channel categories"}>
          {fleetGroups.map((group) => (
            <section
              className="channel-category"
              key={group.key}
              aria-labelledby={openFolder === null ? `channel-category-${group.key}` : undefined}
              aria-label={openFolder ? group.label : undefined}
            >
              {openFolder === null ? (
                <header className="channel-category-heading">
                  <h2 id={`channel-category-${group.key}`}>{group.label}</h2>
                  <span>{group.channels.length}</span>
                </header>
              ) : null}
              <div className="channel-card-grid" aria-label={group.label}>
          {group.channels.map((c) => {
            const cardData = channelArtwork.find(
              (art) => art.channelId === c._id || art.channelSlug === c.slug,
            );
            const videos = cardData?.recentPublishedCount ?? 0;
            const connector = linkByChannel.get(c._id);
            const linked = linkedIds.has(c._id);
            const creating = c.youtubeCreated?.status === "creating";
            const needsLink = !linked && !creating;
            const readyPlan = readyPlanBySlug.get(c.slug) ?? [];
            const next = nextProjectedPlanItem({
              items: readyPlan,
              schedule: c.schedule,
              cadence: c.identity?.cadence,
              fromTimestamp: viewStartedAt,
            });
            const planArtwork = (next?.item.thumbnailSource !== "rendered_video_frame"
              ? next?.item.thumbnailKey
              : undefined) ?? readyPlan.find(
              (item) => item.thumbnailKey && item.thumbnailSource !== "rendered_video_frame",
            )?.thumbnailKey;
            const latestArtwork = cardData?.latestThumbnailKey;
            // The fleet view is primarily an identity map, not a grid of video
            // packaging. Lead with the channel's own art and retain real
            // render/plan artwork as a truthful fallback when legacy identity
            // art is missing.
            const identityArtwork = c.identity?.bannerKey;
            const previewArtwork = identityArtwork ?? latestArtwork ?? planArtwork;
            // Identity artwork already explains itself through the card name
            // and avatar. Only label an image when it is a fallback so the
            // fleet scan stays quiet while still being honest about artwork
            // provenance.
            const previewLabel = identityArtwork
              ? null
              : latestArtwork
                ? "Latest render"
                : planArtwork
                  ? "Planned thumbnail"
                  : "Channel artwork";
            const setupChecks = [
              linked,
              Boolean(c.identity?.imageKey && c.identity?.niche),
              Boolean(c.identity?.voiceId),
              Boolean(c.identity?.thumbnailTemplate),
              Boolean(c.pipeline?.length),
            ];
            const setupDone = setupChecks.filter(Boolean).length;
            const autopilotEnabled = c.status === "active" && c.schedule?.enabled !== false;
            const inactive = !autopilotEnabled || !linked;
            const operatingState = inactive
              ? {
                  tone: "inactive",
                  label: "Inactive",
                  detail: !linked
                    ? `${autopilotEnabled ? "Generation on · " : ""}${youtubeConnectionIssue(connector, creating)}`
                    : "Autopilot paused",
                }
              : readyPlan.length > 0
                ? { tone: "queued", label: "Queued", detail: `${readyPlan.length} ready` }
                : { tone: "online", label: "Online", detail: "Awaiting next plan" };
            return (
              <article
                key={c._id}
                className={`channel-card glass glass-shine${needsLink ? " channel-card-attention" : ""}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/channel-id", c._id)}
              >
                <ChannelBanner
                  bannerKey={previewArtwork}
                  fallbackKeys={[latestArtwork, planArtwork]}
                  name={c.name}
                  niche={c.identity?.niche}
                  palette={c.identity?.palette}
                  aspectRatio="16 / 5"
                  className="channel-card-banner"
                >
                  <div className="channel-card-banner-tools">
                    {previewLabel ? <span className="channel-card-preview-label">{previewLabel}</span> : <span />}
                    <OwnerLockBadge
                      kind="channel"
                      channelId={c._id}
                      channelName={c.name}
                      locked={c.locked === true}
                      size="sm"
                    />
                  </div>
                </ChannelBanner>
                <div className="channel-card-identity">
                  <ChannelAvatar
                    imageKey={c.identity?.imageKey}
                    name={c.name}
                    niche={c.identity?.niche}
                    palette={c.identity?.palette}
                    size={48}
                    radius={12}
                  />
                  <span
                    className="channel-card-motif"
                    aria-hidden="true"
                    title={`${c.name} identity symbol`}
                  >
                    <NicheMotionGlyph niche={c.identity?.niche} channelName={c.name} />
                  </span>
                  <div className="channel-card-title">
                    <Link href={`/channels/${c.slug}`}>
                      <h2>{c.name}</h2>
                    </Link>
                    <p>{c.identity?.niche ?? channelCategoryLabelFor(c)}</p>
                  </div>
                  <div
                    className={`channel-live-state channel-live-state-${operatingState.tone}`}
                    aria-label={`${operatingState.label}: ${operatingState.detail}`}
                    title={operatingState.detail}
                  >
                    <span aria-hidden="true" />
                    <strong>{operatingState.label}</strong>
                    <small>{operatingState.detail}</small>
                  </div>
                </div>

                <div className="channel-card-operating-row">
                  <div>
                    <small>Next</small>
                    <strong>{next?.timestamp ? formatZonedScheduleTimestamp(next.timestamp, next.timeZone) : next ? "Time unavailable" : "Queue empty"}</strong>
                  </div>
                  <div>
                    <small>Published</small>
                    <strong>{videos} video{videos === 1 ? "" : "s"}</strong>
                  </div>
                </div>

                {creating && (
                  <div className="channel-card-notice channel-card-notice-warning">
                    <span className="studio-pulse">●</span> Setting up YouTube channel…
                  </div>
                )}
                <nav className="channel-card-actions" aria-label={`${c.name} actions`}>
                  <button
                    type="button"
                    className="channel-card-manage"
                    aria-haspopup="dialog"
                    aria-expanded={managedChannelId === c._id}
                    aria-controls="channel-fleet-inspector"
                    onClick={(event) => {
                      inspectorTriggerRef.current = event.currentTarget;
                      setManagedChannelId(c._id);
                    }}
                  >
                    <span>Controls</span>
                    <span className="channel-card-readiness">
                      <progress
                        aria-label={`${c.name} setup readiness`}
                        max={setupChecks.length}
                        value={setupDone}
                      />
                      <small>{setupDone}/{setupChecks.length}</small>
                    </span>
                  </button>
                  <Link href={`/channels/${c.slug}`} className="channel-card-open">Open</Link>
                </nav>
              </article>
            );
          })}
              </div>
            </section>
          ))}
          </div>
          {fleetPage.total > CHANNEL_PAGE_SIZE ? (
            <div className="channel-page-pagination">
              <p aria-live="polite">
                Showing <strong>{fleetPage.visible.length}</strong> of {fleetPage.total}
                {openFolder ? ` in ${openFolder}` : " channels"}
              </p>
              <div>
                {fleetPage.visible.length > CHANNEL_PAGE_SIZE ? (
                  <button
                    type="button"
                    className="studio-action studio-action-secondary"
                    onClick={() => setVisibleLimit(CHANNEL_PAGE_SIZE)}
                  >
                    Show first {CHANNEL_PAGE_SIZE}
                  </button>
                ) : null}
                {fleetPage.remaining > 0 ? (
                  <button
                    type="button"
                    className="studio-action"
                    onClick={() =>
                      setVisibleLimit(fleetPage.visible.length + fleetPage.nextBatchSize)
                    }
                  >
                    Show next {fleetPage.nextBatchSize}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}

      {managedChannel && folders ? (
        <ChannelFleetInspector
          channel={managedChannel}
          artwork={managedArtwork}
          connector={managedConnector}
          folders={folders}
          linked={managedLinked}
          ytChannelId={managedYtId}
          readyPlan={readyPlanBySlug.get(managedChannel.slug) ?? []}
          returnFocusRef={inspectorTriggerRef}
          viewStartedAt={viewStartedAt}
          onClose={closeInspector}
        />
      ) : null}
    </>
  );
}

function ChannelFleetInspector({
  channel,
  artwork,
  connector,
  folders,
  linked,
  ytChannelId,
  readyPlan,
  returnFocusRef,
  viewStartedAt,
  onClose,
}: {
  channel: ChannelCardRow;
  artwork?: ChannelCardArtwork;
  connector?: YoutubeLinkStatus;
  folders: { _id: string; name: string }[];
  linked: boolean;
  ytChannelId: string | null;
  readyPlan: PlanCardRow[];
  returnFocusRef: { current: HTMLButtonElement | null };
  viewStartedAt: number;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const operationsAccess = useOperationsAccess();
  const requestOperationsAccess = useRequestOperationsAccess();
  const creating = channel.youtubeCreated?.status === "creating";
  const needsLink = !linked && !creating;
  const autopilotEnabled = channel.status === "active" && channel.schedule?.enabled !== false;
  const next = nextProjectedPlanItem({
    items: readyPlan,
    schedule: channel.schedule,
    cadence: channel.identity?.cadence,
    fromTimestamp: viewStartedAt,
  });
  const latestArtwork = artwork?.latestThumbnailKey;
  const planArtwork = (next?.item.thumbnailSource !== "rendered_video_frame"
    ? next?.item.thumbnailKey
    : undefined) ?? readyPlan.find(
    (item) => item.thumbnailKey && item.thumbnailSource !== "rendered_video_frame",
  )?.thumbnailKey;
  const setupChecks = [
    { label: "YouTube", ready: linked },
    { label: "Identity", ready: Boolean(channel.identity?.imageKey && channel.identity?.niche) },
    { label: "Voice", ready: Boolean(channel.identity?.voiceId) },
    { label: "Thumbnail", ready: Boolean(channel.identity?.thumbnailTemplate) },
    { label: "Pipeline", ready: Boolean(channel.pipeline?.length) },
  ];
  const setupDone = setupChecks.filter((check) => check.ready).length;
  const modulePath = (channel.pipeline ?? []).map((entry) => blockLabel(entry.block));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const returnFocus = returnFocusRef.current;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      returnFocus?.focus();
    };
  }, [onClose, returnFocusRef]);

  const containFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="channel-fleet-inspector-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        id="channel-fleet-inspector"
        className="channel-fleet-inspector glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-fleet-inspector-title"
        onKeyDown={containFocus}
      >
        <header className="channel-fleet-inspector-head">
          <div>
            <small>Fleet control</small>
            <h2 id="channel-fleet-inspector-title">{channel.name}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close channel controls">×</button>
        </header>

        <ChannelBanner
          bannerKey={channel.identity?.bannerKey}
          fallbackKeys={[latestArtwork, planArtwork]}
          name={channel.name}
          niche={channel.identity?.niche}
          palette={channel.identity?.palette}
          aspectRatio="16 / 5"
          className="channel-fleet-inspector-banner"
        />

        <div className="channel-fleet-inspector-identity">
          <ChannelAvatar
            imageKey={channel.identity?.imageKey}
            name={channel.name}
            niche={channel.identity?.niche}
            palette={channel.identity?.palette}
            size={54}
            radius={13}
          />
          <span className="channel-fleet-inspector-motif" aria-hidden="true">
            <NicheMotionGlyph niche={channel.identity?.niche} channelName={channel.name} />
          </span>
          <div>
            <strong>{channel.identity?.niche ?? channelCategoryLabelFor(channel)}</strong>
            <span>{creating ? "YouTube setup running" : linked ? "YouTube destination ready" : youtubeConnectionIssue(connector, false)}</span>
          </div>
          <OwnerLockBadge
            kind="channel"
            channelId={channel._id}
            channelName={channel.name}
            locked={channel.locked === true}
            size="sm"
          />
        </div>

        <section className="channel-fleet-inspector-readiness" aria-labelledby="channel-fleet-readiness-title">
          <div className="channel-fleet-inspector-section-head">
            <div>
              <small id="channel-fleet-readiness-title">Readiness</small>
              <strong>{setupDone}/{setupChecks.length} ready</strong>
            </div>
            <progress aria-label={`${channel.name} setup readiness`} max={setupChecks.length} value={setupDone} />
          </div>
          <ul>
            {setupChecks.map((check) => (
              <li key={check.label} data-ready={check.ready ? "true" : "false"}>
                <span aria-hidden="true">{check.ready ? "✓" : "·"}</span>{check.label}
              </li>
            ))}
          </ul>
        </section>

        <div className="channel-fleet-inspector-metrics">
          <CardStat
            label="Next publish"
            value={next?.timestamp ? formatZonedScheduleTimestamp(next.timestamp, next.timeZone) : "No ready item"}
          />
          <CardStat label="Recent runs" value={String(artwork?.recentRunCount ?? 0)} />
          <CardStat label="Published" value={String(artwork?.recentPublishedCount ?? 0)} />
          <CardStat label="Recent spend" value={fmtUsd(artwork?.recentSpend ?? 0)} />
        </div>

        <ChannelRoomSelect channelId={channel._id} currentFolder={channel.folder} folders={folders} />

        <section className="channel-fleet-inspector-pipeline" aria-labelledby="channel-fleet-pipeline-title">
          <small id="channel-fleet-pipeline-title">Module path</small>
          <div>
            {modulePath.length
              ? modulePath.map((module, index) => <span key={`${index}-${module}`}>{module}</span>)
              : <span>No pipeline configured</span>}
          </div>
        </section>

        <nav className="channel-fleet-inspector-nav" aria-label={`${channel.name} workspaces`}>
          <Link href={`/channels/${channel.slug}`}>Overview</Link>
          <Link href={`/channels/${channel.slug}?tab=week-ahead`}>Schedule</Link>
          <Link href={`/channels/${channel.slug}?tab=seo`}>Packaging</Link>
          <Link href={`/channels/${channel.slug}?tab=settings`}>Settings</Link>
        </nav>

        <div className="channel-fleet-inspector-actions">
          {operationsAccess === "owner" ? (
            <>
              {needsLink ? (
                <LinkYouTubeButton channelId={channel._id} created={Boolean(channel.youtubeCreated?.ytChannelId)} />
              ) : null}
              <ChannelToggle id={channel._id} active={autopilotEnabled} schedule={channel.schedule} />
              {linked && channel.identity?.imageKey && ytChannelId ? (
                <SetAvatarButton imageKey={channel.identity.imageKey} ytChannelId={ytChannelId} slug={channel.slug} />
              ) : null}
              <DeleteChannelX id={channel._id} name={channel.name} />
            </>
          ) : (
            <button
              type="button"
              className="channel-account-action channel-account-action-attention"
              disabled={operationsAccess === "checking"}
              onClick={requestOperationsAccess}
            >
              {operationsAccess === "checking" ? "Checking owner access…" : "Verify owner to edit"}
            </button>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Two-step delete control inside the card's management panel: first click arms, second
 * click within 4s deletes. Stops the parent Link navigation.
 */
function DeleteChannelX({ id, name }: { id: string; name: string }) {
  const del = useMutation(api.channels.deleteChannel);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setBusy(true);
    try {
      await del({ channelId: id as Id<"channels"> });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="channel-account-action channel-account-action-danger"
      title={armed ? `Click again to permanently delete "${name}"` : `Delete "${name}"…`}
      data-armed={armed ? "true" : undefined}
    >
      {busy ? "Deleting…" : armed ? "Confirm delete" : "Delete channel"}
    </button>
  );
}

/** Inline on/off toggle on a channel card. Stops the parent Link navigation. */
function ChannelToggle({ id, active, schedule }: { id: string; active: boolean; schedule?: ChannelSchedule }) {
  const update = useMutation(api.channels.updateChannel);
  const [busy, setBusy] = useState(false);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const shouldEnableSchedule = !active && schedule?.enabled === false;
      await update({
        channelId: id as Id<"channels">,
        status: active ? "paused" : "active",
        ...(shouldEnableSchedule
          ? {
              schedule: {
                ...schedule,
                frequency: schedule.frequency || "weekly",
                enabled: true,
              },
            }
          : {}),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="channel-account-action"
      title={active
        ? "Autopilot ON — builds + uploads (private) on the channel's cadence. Click to pause."
        : "Paused — no auto-builds. Click to enable autopilot."}
    >
      {busy ? "Updating…" : active ? "Pause autopilot" : "Resume autopilot"}
    </button>
  );
}

/** Red "Link to YouTube" CTA on unwired cards → kicks off the OAuth connect. */
function LinkYouTubeButton({ channelId, created }: { channelId: string; created: boolean }) {
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.location.assign(
      new URL(`/api/youtube-connect?channelId=${channelId}`, window.location.origin),
    );
  };
  return (
    <button
      onClick={onClick}
      className="channel-account-action channel-account-action-attention"
      title={created ? "A YouTube channel was created for this — click to link it" : "Link this channel to YouTube"}
    >
      Link YouTube
    </button>
  );
}

/**
 * One-click avatar helper. YouTube has no avatar API and its photo-picker is a
 * cross-origin Google iframe we can't drive, so this makes the one manual step a
 * guided two-tap: downloads the generated avatar from R2 (via /api/asset-url) and
 * opens that channel's Studio profile editor in a new tab.
 */
function SetAvatarButton({ imageKey, ytChannelId, slug }: { imageKey: string; ytChannelId: string; slug: string }) {
  const [busy, setBusy] = useState(false);
  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      // Open the Studio profile editor first (a user gesture, so it isn't blocked).
      window.open(`https://studio.youtube.com/channel/${ytChannelId}/editing/profile`, "_blank", "noopener");
      // Fetch a presigned URL + trigger the download of the avatar file.
      const res = await fetch(`/api/asset-url?key=${encodeURIComponent(imageKey)}`);
      const { url } = (await res.json()) as { url?: string };
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slug}-avatar.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="channel-account-action"
      title="Download the generated avatar + open YouTube Studio to set it (one manual step)"
    >
      {busy ? "Opening…" : "Set profile picture"}
    </button>
  );
}

function CardStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="channel-card-stat">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function ChannelRoomSelect({
  channelId,
  currentFolder,
  folders,
}: {
  channelId: string;
  currentFolder?: string;
  folders: { _id: string; name: string }[];
}) {
  const update = useMutation(api.channels.updateChannel);
  const access = useOperationsAccess();
  const [busy, setBusy] = useState(false);
  const canEdit = access === "owner";
  return (
    <label className="channel-room-select">
      <span>Channel room</span>
      <select
        value={currentFolder ?? ""}
        disabled={busy || !canEdit}
        title={canEdit ? "Move this channel to another room" : "Enable owner editing to move channels"}
        onChange={async (event) => {
          setBusy(true);
          try {
            await update({ channelId: channelId as Id<"channels">, folder: event.target.value });
          } finally {
            setBusy(false);
          }
        }}
      >
        <option value="">All channels</option>
        {folders.map((folder) => <option key={folder._id} value={folder.name}>{folder.name}</option>)}
      </select>
    </label>
  );
}
