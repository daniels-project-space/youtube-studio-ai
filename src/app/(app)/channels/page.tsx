"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import type { ChannelRow, RunRow } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { StageBadge } from "@/components/StageBadge";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { ChannelAvatar } from "@/components/ChannelArt";
import { IconChannels } from "@/components/icons";
import { fmtUsd } from "@/lib/format";

export default function ChannelsPage() {
  const ownerId = useOwnerId();
  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | (ChannelRow & { folder?: string })[]
    | undefined;
  const folders = useQuery(api.folders.list, { ownerId }) as
    | { _id: string; name: string }[]
    | undefined;
  const recent = useQuery(api.runs.listRecent, { ownerId, limit: 200 }) as
    | RunRow[]
    | undefined;
  const links = useQuery(api.youtubeAuth.linkStatus, { ownerId }) as
    | { channelId: string; ytChannelId?: string | null }[]
    | undefined;
  const createFolder = useMutation(api.folders.create);
  const removeFolder = useMutation(api.folders.remove);
  const update = useMutation(api.channels.updateChannel);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const linkedIds = new Set((links ?? []).map((l) => l.channelId));
  const ytIdByChannel = new Map((links ?? []).map((l) => [l.channelId, l.ytChannelId ?? null]));

  const folderNames = new Set((folders ?? []).map((f) => f.name));
  const inFolder = (name: string) => (channels ?? []).filter((c) => c.folder === name);
  const unfiled = (channels ?? []).filter((c) => !c.folder || !folderNames.has(c.folder));
  const visible = openFolder ? inFolder(openFolder) : unfiled;

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
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={async () => {
                const name = window.prompt("Folder name:");
                if (name?.trim()) await createFolder({ ownerId, name: name.trim() });
              }}
              className="lift"
              style={{
                padding: "0.55rem 1rem",
                borderRadius: 9,
                background: "transparent",
                border: "1px solid var(--color-border)",
                color: "var(--color-muted)",
                fontWeight: 600,
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              + Folder
            </button>
            <Link
              href="/channels/new"
              className="lift"
              style={{
                padding: "0.55rem 1rem",
                borderRadius: 9,
                background: "var(--color-accent)",
                color: "#0a0a0b",
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            >
              + New channel
            </Link>
          </div>
        }
      />

      {/* Folder row: drop targets with mini avatar previews. */}
      {(folders?.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1.1rem" }}>
          {openFolder && (
            <button
              onClick={() => setOpenFolder(null)}
              onDragOver={(e) => { e.preventDefault(); setDragOver("__all"); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => onDropToFolder(e, null)}
              className="glass lift"
              title="Back to all channels (drop a channel here to unfile it)"
              style={{
                padding: "0.6rem 0.9rem", borderRadius: 10, cursor: "pointer", fontSize: "0.85rem",
                fontWeight: 600, color: "var(--color-muted)",
                border: dragOver === "__all" ? "1px dashed var(--color-accent)" : "1px solid var(--color-border)",
              }}
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
                onClick={() => setOpenFolder(isOpen ? null : f.name)}
                onDragOver={(e) => { e.preventDefault(); setDragOver(f.name); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={(e) => onDropToFolder(e, f.name)}
                className="glass glass-shine lift"
                title={`${members.length} channel(s) — click to ${isOpen ? "close" : "open"}; drag a channel card here to file it`}
                style={{
                  padding: "0.6rem 0.9rem", borderRadius: 10, cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "0.6rem",
                  border: dragOver === f.name
                    ? "1px dashed var(--color-accent)"
                    : isOpen ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                }}
              >
                <span style={{ fontSize: "1rem" }}>📁</span>
                <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{f.name}</span>
                <span style={{ display: "flex", marginLeft: "0.15rem" }}>
                  {members.slice(0, 4).map((m, i) => (
                    <span key={m._id} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: 7, overflow: "hidden", border: "1px solid var(--color-border)", lineHeight: 0 }}>
                      <ChannelAvatar imageKey={m.identity?.imageKey} name={m.name} palette={m.identity?.palette} size={22} radius={6} />
                    </span>
                  ))}
                </span>
                <span style={{ fontSize: "0.72rem", color: "var(--color-faint)", fontFamily: "var(--font-mono)" }}>
                  {members.length}
                </span>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete folder "${f.name}"? Channels inside are kept (unfiled).`)) {
                      if (openFolder === f.name) setOpenFolder(null);
                      await removeFolder({ ownerId, folderId: f._id as Id<"channelFolders"> });
                    }
                  }}
                  title="Delete folder (channels are kept)"
                  style={{ background: "none", border: "none", color: "var(--color-faint)", cursor: "pointer", fontSize: "0.85rem", padding: "0 0.1rem" }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {channels === undefined ? (
        <SkeletonList rows={4} />
      ) : channels.length === 0 ? (
        <EmptyState
          title="No channels yet"
          description="Channels created by the pipeline (or the seed script) will appear here."
          icon={<IconChannels width={24} height={24} />}
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "1rem",
          }}
        >
          {visible.map((c) => {
            const chRuns = recent?.filter((r) => r.channelSlug === c.slug) ?? [];
            const count = chRuns.length;
            const videos = chRuns.filter((r) => r.youtubeVideoId).length;
            const cost = chRuns.reduce((s, r) => s + (r.costTotal ?? 0), 0);
            const linked = linkedIds.has(c._id);
            const creating = c.youtubeCreated?.status === "creating";
            const needsLink = !linked && !creating;
            const ytId = ytIdByChannel.get(c._id) || c.youtubeCreated?.ytChannelId || null;
            return (
              <Link
                key={c._id}
                href={`/channels/${c.slug}`}
                className="glass glass-shine lift"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/channel-id", c._id)}
                style={{
                  padding: "1.25rem",
                  display: "grid",
                  gap: "0.85rem",
                  ...(creating
                    ? { border: "1px solid rgba(245,158,11,0.7)", animation: "pulseAmber 1.6s ease-in-out infinite" }
                    : needsLink
                      ? { border: "1px solid rgba(248,113,113,0.7)", animation: "pulseRed 1.6s ease-in-out infinite" }
                      : {}),
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.8rem" }}>
                  <ChannelAvatar
                    imageKey={c.identity?.imageKey}
                    name={c.name}
                    palette={c.identity?.palette}
                    size={48}
                    radius={12}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
                      <h3 style={{ fontSize: "1.05rem", lineHeight: 1.2 }}>{c.name}</h3>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <ChannelToggle id={c._id} active={c.status === "active"} />
                        <StageBadge status={c.status === "active" ? "ok" : "queued"} size="sm" />
                        <DeleteChannelX id={c._id} name={c.name} />
                      </div>
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--color-muted)", marginTop: "0.2rem" }}>
                      {c.identity?.niche ?? `Template ${c.template}`}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "0.5rem",
                    borderTop: "1px solid var(--color-border)",
                    paddingTop: "0.7rem",
                  }}
                >
                  <CardStat label="Runs" value={String(count)} />
                  <CardStat label="Videos" value={String(videos)} />
                  <CardStat label="Spend" value={fmtUsd(cost)} />
                </div>
                {creating && (
                  <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#fbbf24", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span className="studio-pulse">●</span> Setting up YouTube channel…
                  </div>
                )}
                {needsLink && <LinkYouTubeButton channelId={c._id} created={Boolean(c.youtubeCreated?.ytChannelId)} />}
                {linked && c.identity?.imageKey && ytId && (
                  <SetAvatarButton imageKey={c.identity.imageKey} ytChannelId={ytId} slug={c.slug} />
                )}
                <div style={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "var(--color-faint)" }}>
                  {c.slug}
                </div>
              </Link>
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
        minWidth: armed ? 52 : 22,
        height: 22,
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
        width: 50,
        height: 24,
        borderRadius: 999,
        cursor: busy ? "default" : "pointer",
        border: "1px solid var(--color-border)",
        background: active ? "rgba(52,211,153,0.20)" : "rgba(148,148,148,0.15)",
        color: active ? "var(--color-ok)" : "var(--color-muted)",
        fontWeight: 700,
        fontSize: "0.6rem",
        letterSpacing: "0.05em",
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
    window.location.href = `/api/youtube-connect?channelId=${channelId}`;
  };
  return (
    <button
      onClick={onClick}
      title={created ? "A YouTube channel was created for this — click to link it" : "Link this channel to YouTube"}
      style={{
        background: "rgba(248,113,113,0.15)",
        color: "#fca5a5",
        border: "1px solid rgba(248,113,113,0.6)",
        borderRadius: 9,
        padding: "0.5rem",
        fontSize: "0.8rem",
        fontWeight: 700,
        cursor: "pointer",
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
        borderRadius: 9,
        padding: "0.5rem",
        fontSize: "0.8rem",
        fontWeight: 700,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      🖼️ {busy ? "Opening…" : "Set profile picture"}
    </button>
  );
}

function CardStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.62rem",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--color-faint)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "0.92rem", fontWeight: 600, marginTop: "0.15rem" }}>
        {value}
      </div>
    </div>
  );
}
