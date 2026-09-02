"use client";

import Link from "next/link";
import { useState } from "react";
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
import { ChannelFolderWorkspace } from "@/components/ChannelFolderWorkspace";
import { useOperationsAccess } from "@/components/OperationsAccess";
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
import { groupChannelsByCategory } from "./channelCategories";

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
  const [viewStartedAt] = useState(() => Date.now());
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

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Channels"
        subtitle="Create, group, and connect channels."
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
            const count = cardData?.recentRunCount ?? 0;
            const videos = cardData?.recentPublishedCount ?? 0;
            const cost = cardData?.recentSpend ?? 0;
            const connector = linkByChannel.get(c._id);
            const linked = linkedIds.has(c._id);
            const creating = c.youtubeCreated?.status === "creating";
            const needsLink = !linked && !creating;
            const ytId = ytIdByChannel.get(c._id) || c.youtubeCreated?.ytChannelId || null;
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
            const cadence = c.schedule?.frequency || c.identity?.cadence || "Not set";
            const modulePath = (c.pipeline ?? []).map((entry) => blockLabel(entry.block));
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
                  palette={c.identity?.palette}
                  aspectRatio="16 / 6"
                  className="channel-card-banner"
                >
                  {previewLabel ? <span className="channel-card-preview-label">{previewLabel}</span> : null}
                </ChannelBanner>
                <div className="channel-card-identity">
                  <ChannelAvatar
                    imageKey={c.identity?.imageKey}
                    name={c.name}
                    palette={c.identity?.palette}
                    size={44}
                    radius={11}
                  />
                  <div className="channel-card-title">
                    <Link href={`/channels/${c.slug}`}>
                      <h2>{c.name}</h2>
                    </Link>
                    <p>{c.identity?.niche ?? `Template ${c.template}`}</p>
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
                    <small>Next publish</small>
                    <strong>{next?.timestamp ? formatZonedScheduleTimestamp(next.timestamp, next.timeZone) : next ? "Time unavailable" : "No ready item"}</strong>
                    <span>{next ? next.item.title || next.item.topic : cadence}</span>
                  </div>
                  <div>
                    <small>Output</small>
                    <strong>{videos} published</strong>
                    <span>{cardData?.lastRunStatus ? `Last run · ${cardData.lastRunStatus}` : "No run history"}</span>
                  </div>
                </div>

                <details className="channel-card-details">
                  <summary>
                    <span>Manage channel</span>
                    <span className="channel-card-readiness">
                      <progress
                        aria-label={`${c.name} setup readiness`}
                        max={setupChecks.length}
                        value={setupDone}
                      />
                      <small>{setupDone}/{setupChecks.length} ready</small>
                    </span>
                  </summary>
                    <div className="channel-card-details-body">
                    <ChannelRoomSelect channelId={c._id} currentFolder={c.folder} folders={folders} />
                    <div className="channel-module-path" title={modulePath.join(" → ")}>
                      <small>Module path</small>
                      <span>
                        {modulePath.length
                          ? `${modulePath.slice(0, 3).join(" → ")}${modulePath.length > 3 ? ` → +${modulePath.length - 3}` : ""}`
                          : "No pipeline configured"}
                      </span>
                    </div>

                    <div className="channel-card-stats" title="Latest 20 runs for this channel">
                      <CardStat label="Recent runs" value={String(count)} />
                      <CardStat label="Published" value={String(videos)} />
                      <CardStat label="Recent spend" value={fmtUsd(cost)} />
                    </div>
                    <nav className="channel-card-secondary-actions" aria-label={`${c.name} setup actions`}>
                      <Link href={`/channels/${c.slug}?tab=week-ahead`}>Schedule</Link>
                      <Link href={`/channels/${c.slug}?tab=seo`}>SEO</Link>
                      <Link href={`/channels/${c.slug}?tab=settings`}>Settings</Link>
                    </nav>
                    <div className="channel-card-account-actions">
                      <ChannelToggle id={c._id} active={autopilotEnabled} schedule={c.schedule} />
                      {linked && c.identity?.imageKey && ytId && (
                        <SetAvatarButton imageKey={c.identity.imageKey} ytChannelId={ytId} slug={c.slug} />
                      )}
                      <DeleteChannelX id={c._id} name={c.name} />
                    </div>
                  </div>
                </details>

                {creating && (
                  <div className="channel-card-notice channel-card-notice-warning">
                    <span className="studio-pulse">●</span> Setting up YouTube channel…
                  </div>
                )}
                <nav className="channel-card-actions" aria-label={`${c.name} actions`}>
                  {needsLink && !creating ? (
                    <LinkYouTubeButton channelId={c._id} created={Boolean(c.youtubeCreated?.ytChannelId)} />
                  ) : null}
                  <Link href={`/channels/${c.slug}`} className="channel-card-open">Open channel</Link>
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
    </>
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
