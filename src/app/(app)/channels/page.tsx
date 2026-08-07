"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import type { ChannelRow } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { StageBadge } from "@/components/StageBadge";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { ChannelAvatar, ChannelBanner } from "@/components/ChannelArt";
import { IconChannels } from "@/components/icons";
import { fmtUsd } from "@/lib/format";
import {
  formatZonedScheduleTimestamp,
  nextProjectedPlanItem,
} from "@/lib/scheduleCalendar";
import { channelsVisibleForFolder } from "./channelCardVisibility";

type ChannelCardRow = ChannelRow & {
  folder?: string;
  schedule?: { frequency?: string; days?: number[]; localTime?: string; timezone?: string; enabled?: boolean };
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

const blockLabel = (block: string) =>
  block.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());

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
    | { channelId: string; ytChannelId?: string | null }[]
    | undefined;
  const createFolder = useMutation(api.folders.create);
  const removeFolder = useMutation(api.folders.remove);
  const update = useMutation(api.channels.updateChannel);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [viewStartedAt] = useState(() => Date.now());
  const loading =
    channels === undefined ||
    folders === undefined ||
    plan === undefined ||
    channelArtwork === undefined ||
    links === undefined;
  const linkedIds = new Set((links ?? []).map((l) => l.channelId));
  const ytIdByChannel = new Map((links ?? []).map((l) => [l.channelId, l.ytChannelId ?? null]));

  const inFolder = (name: string) => (channels ?? []).filter((c) => c.folder === name);
  const visible = channelsVisibleForFolder(channels ?? [], openFolder);
  const readyPlanBySlug = new Map<string, PlanCardRow[]>();
  for (const item of plan ?? []) {
    if (item.status !== "ready") continue;
    const items = readyPlanBySlug.get(item.channelSlug) ?? [];
    items.push(item);
    readyPlanBySlug.set(item.channelSlug, items);
  }

  const onDropToFolder = async (e: React.DragEvent, folderName: string | null) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/channel-id");
    if (!id) return;
    await update({ channelId: id as Id<"channels">, folder: folderName ?? "" });
  };

  return (
    <>
      {/* Pulse cues: red = needs linking, amber = agent is creating it now. */}
      <style>{`@keyframes pulseRed{0%,100%{box-shadow:0 0 0 0 rgba(248,113,113,0);border-color:rgba(248,113,113,0.55)}50%{box-shadow:0 0 0 4px rgba(248,113,113,0.22);border-color:rgba(248,113,113,1)}}@keyframes pulseAmber{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,0);border-color:rgba(245,158,11,0.5)}50%{box-shadow:0 0 0 4px rgba(245,158,11,0.22);border-color:rgba(245,158,11,1)}}`}</style>
      <PageHeader
        title="Channels"
        subtitle="Every channel and its pipeline status"
        actions={
          <div className="channel-page-actions">
            <button
              onClick={async () => {
                const name = window.prompt("Folder name:");
                if (name?.trim()) await createFolder({ ownerId, name: name.trim() });
              }}
              className="studio-action studio-action-secondary"
            >
              + Folder
            </button>
            <Link
              href="/channels/new"
              className="studio-action"
            >
              + New channel
            </Link>
          </div>
        }
      />

      {/* Folder row: drop targets with mini avatar previews. */}
      {(folders?.length ?? 0) > 0 && (
        <div className="channel-folder-strip" aria-label="Channel folders">
          {openFolder && (
            <button
              onClick={() => setOpenFolder(null)}
              onDragOver={(e) => { e.preventDefault(); setDragOver("__all"); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDropToFolder(e, null)}
              className="channel-folder-back"
              title="Back to all channels (drop a channel here to unfile it)"
              data-drag-over={dragOver === "__all" ? "true" : undefined}
            >
              ← All channels
            </button>
          )}
          {(folders ?? []).map((f) => {
            const members = inFolder(f.name);
            const isOpen = openFolder === f.name;
            return (
              <div
                key={f._id}
                onDragOver={(e) => { e.preventDefault(); setDragOver(f.name); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => onDropToFolder(e, f.name)}
                className="channel-folder-chip"
                data-open={isOpen ? "true" : undefined}
                data-drag-over={dragOver === f.name ? "true" : undefined}
              >
                <button
                  type="button"
                  className="channel-folder-chip-main"
                  onClick={() => setOpenFolder(isOpen ? null : f.name)}
                  aria-pressed={isOpen}
                  title={`${members.length} channel(s) — click to ${isOpen ? "close" : "open"}; drag a channel card here to file it`}
                >
                  <span aria-hidden="true">📁</span>
                  <strong>{f.name}</strong>
                  <span className="channel-folder-avatars" aria-hidden="true">
                    {members.slice(0, 4).map((m, i) => (
                      <span key={m._id} style={{ marginLeft: i === 0 ? 0 : -7 }}>
                        <ChannelAvatar imageKey={m.identity?.imageKey} name={m.name} palette={m.identity?.palette} size={20} radius={5} />
                      </span>
                    ))}
                  </span>
                  <small>{members.length}</small>
                </button>
                <button
                  type="button"
                  className="channel-folder-delete"
                  onClick={async () => {
                    if (window.confirm(`Delete folder "${f.name}"? Channels inside are kept (unfiled).`)) {
                      if (openFolder === f.name) setOpenFolder(null);
                      await removeFolder({ ownerId, folderId: f._id as Id<"channelFolders"> });
                    }
                  }}
                  aria-label={`Delete ${f.name} folder; channels are kept`}
                  title="Delete folder (channels are kept)"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <SkeletonList rows={4} />
      ) : channels.length === 0 ? (
        <EmptyState
          title="No channels yet"
          description="Channels created by the pipeline (or the seed script) will appear here."
          icon={<IconChannels width={24} height={24} />}
        />
      ) : (
        <div className="channel-card-grid">
          {visible.map((c) => {
            const cardData = channelArtwork.find(
              (art) => art.channelId === c._id || art.channelSlug === c.slug,
            );
            const count = cardData?.recentRunCount ?? 0;
            const videos = cardData?.recentPublishedCount ?? 0;
            const cost = cardData?.recentSpend ?? 0;
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
            const planArtwork = next?.item.thumbnailKey ?? readyPlan.find(
              (item) => item.thumbnailKey,
            )?.thumbnailKey;
            const latestArtwork = cardData?.latestThumbnailKey;
            const previewArtwork = latestArtwork ?? planArtwork ?? c.identity?.bannerKey;
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
            return (
              <article
                key={c._id}
                className={`channel-card glass glass-shine${needsLink ? " channel-card-attention" : ""}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/channel-id", c._id)}
              >
                <ChannelBanner
                  bannerKey={previewArtwork}
                  fallbackKeys={[planArtwork, c.identity?.bannerKey]}
                  name={c.name}
                  palette={c.identity?.palette}
                  aspectRatio="16 / 7"
                >
                  <span className="channel-card-preview-label">
                    {latestArtwork ? "Latest render" : planArtwork ? "Planned thumbnail" : "Channel artwork"}
                  </span>
                </ChannelBanner>
                <div className="channel-card-identity">
                  <ChannelAvatar
                    imageKey={c.identity?.imageKey}
                    name={c.name}
                    palette={c.identity?.palette}
                    size={52}
                    radius={12}
                  />
                  <div className="channel-card-title">
                    <Link href={`/channels/${c.slug}`}>
                      <h2>{c.name}</h2>
                    </Link>
                    <p>{c.identity?.niche ?? `Template ${c.template}`}</p>
                    <div className="channel-card-state">
                      <StageBadge status={c.status === "active" ? "ok" : "queued"} size="sm" />
                      <span>{cadence}</span>
                    </div>
                  </div>
                  <div className="channel-card-controls">
                    <ChannelToggle id={c._id} active={c.status === "active"} />
                    <DeleteChannelX id={c._id} name={c.name} />
                  </div>
                </div>

                <div className="channel-card-operating-row">
                  <div>
                    <small>Next item</small>
                    <strong>{next?.timestamp ? formatZonedScheduleTimestamp(next.timestamp, next.timeZone) : next ? "Time unavailable" : "No ready item"}</strong>
                    <span>{next ? `${next.pinned ? "Pinned" : "Projected"} · ${next.item.title || next.item.topic}` : "Open schedule to plan"}</span>
                  </div>
                  <div>
                    <small>Setup</small>
                    <strong className={setupDone === setupChecks.length ? "channel-ready" : "channel-incomplete"}>
                      {setupDone}/{setupChecks.length} complete
                    </strong>
                    <span>{cardData?.lastRunStatus ? `Last run ${cardData.lastRunStatus}` : "No run history"}</span>
                  </div>
                </div>

                <details className="channel-card-details">
                  <summary>
                    <span>Pipeline &amp; recent activity</span>
                    <small>{modulePath.length} modules · {count} runs</small>
                  </summary>
                  <div className="channel-card-details-body">
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
                      <Link href={`/channels/${c.slug}?tab=settings`}>Settings</Link>
                      <Link href={`/channels/${c.slug}?tab=week-ahead`}>Schedule</Link>
                      <Link href={`/channels/${c.slug}?tab=pipeline`}>Pipeline</Link>
                    </nav>
                  </div>
                </details>

                {creating && (
                  <div className="channel-card-notice channel-card-notice-warning">
                    <span className="studio-pulse">●</span> Setting up YouTube channel…
                  </div>
                )}
                {needsLink && <LinkYouTubeButton channelId={c._id} created={Boolean(c.youtubeCreated?.ytChannelId)} />}
                {linked && c.identity?.imageKey && ytId && (
                  <SetAvatarButton imageKey={c.identity.imageKey} ytChannelId={ytId} slug={c.slug} />
                )}

                <nav className="channel-card-actions" aria-label={`${c.name} actions`}>
                  <Link href={`/channels/${c.slug}`} className="channel-card-open">Open →</Link>
                </nav>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * Two-step delete X on a channel card: first click arms ("Sure?"), second
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
      title={armed ? `Click again to permanently delete "${name}"` : `Delete "${name}"…`}
      style={{
        minWidth: armed ? 44 : 20,
        height: 20,
        padding: armed ? "0 0.45rem" : 0,
        borderRadius: 6,
        cursor: busy ? "default" : "pointer",
        border: armed ? "1px solid rgba(248,113,113,0.8)" : "1px solid var(--color-border)",
        background: armed ? "rgba(248,113,113,0.22)" : "transparent",
        color: armed ? "#fca5a5" : "var(--color-faint)",
        fontWeight: 700,
        fontSize: armed ? "0.62rem" : "0.8rem",
        lineHeight: 1,
        opacity: busy ? 0.5 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {busy ? "…" : armed ? "Sure?" : "×"}
    </button>
  );
}

/** Inline on/off toggle on a channel card. Stops the parent Link navigation. */
function ChannelToggle({ id, active }: { id: string; active: boolean }) {
  const update = useMutation(api.channels.updateChannel);
  const [busy, setBusy] = useState(false);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await update({ channelId: id as Id<"channels">, status: active ? "paused" : "active" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={active
        ? "Autopilot ON — builds + uploads (private) on the channel's cadence. Click to pause."
        : "Paused — no auto-builds. Click to enable autopilot."}
      style={{
        width: 38,
        height: 20,
        borderRadius: 999,
        flexShrink: 0,
        cursor: busy ? "default" : "pointer",
        border: "1px solid var(--color-border)",
        background: active ? "rgba(52,211,153,0.20)" : "rgba(148,148,148,0.15)",
        color: active ? "var(--color-ok)" : "var(--color-muted)",
        fontWeight: 700,
        fontSize: "0.55rem",
        letterSpacing: "0.04em",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {active ? "ON" : "OFF"}
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
      title={created ? "A YouTube channel was created for this — click to link it" : "Link this channel to YouTube"}
      style={{
        background: "rgba(248,113,113,0.15)",
        color: "#fca5a5",
        border: "1px solid rgba(248,113,113,0.6)",
        borderRadius: 7,
        padding: "0.35rem 0.5rem",
        fontSize: "0.72rem",
        fontWeight: 700,
        cursor: "pointer",
        maxWidth: "100%",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      🔗 Link to YouTube
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
      title="Download the generated avatar + open YouTube Studio to set it (one manual step)"
      style={{
        background: "rgba(125,211,252,0.12)",
        color: "#7dd3fc",
        border: "1px solid rgba(125,211,252,0.5)",
        borderRadius: 7,
        padding: "0.35rem 0.5rem",
        fontSize: "0.72rem",
        fontWeight: 700,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
        maxWidth: "100%",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      🖼️ {busy ? "Opening…" : "Set profile picture"}
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
