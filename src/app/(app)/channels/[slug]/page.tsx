"use client";

import { use, useMemo, useState, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useOwnerId } from "@/lib/owner-context";
import type { ChannelIdentity, RunRow, VideoRow } from "@/lib/types";
import { PageHeader, SectionTitle } from "@/components/PageHeader";
import { RunCard } from "@/components/RunCard";
import { StageBadge } from "@/components/StageBadge";
import { StatCard } from "@/components/StatCard";
import { Chart, compact, type ChartSeries } from "@/components/Chart";
import { VideoGrid } from "@/components/VideoGrid";
import { Lightbox } from "@/components/Lightbox";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { ChannelAvatar, ChannelBanner } from "@/components/ChannelArt";
import { LatestVideoWidget } from "@/components/LatestVideoWidget";
import { StatsCharts } from "@/components/StatsCharts";
import { fmtUsd } from "@/lib/format";
import { VOICES } from "@/lib/voices";
import { NICHES, subcategoryTags } from "@/lib/nicheCatalog";

type ChannelDoc = {
  _id: string;
  ownerId: string;
  name: string;
  slug: string;
  status: string;
  template: string;
  budget: number;
  identity?: ChannelIdentity;
  pipeline?: { block: string; params?: unknown }[];
  schedule?: { frequency: string; days?: number[] };
  groupId?: string;
  language?: string;
  groupRole?: string;
  youtubeCreated?: { ytChannelId?: string; handle?: string; url?: string; createdAt: number; status?: string };
};

type RawRun = {
  _id: string;
  status: string;
  startedAt?: number;
  finishedAt?: number;
  costTotal: number;
  youtubeVideoId?: string;
  error?: string;
};

type TrendRow = {
  date: string;
  subscriberCount: number;
  totalViews: number;
  videoCount: number;
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TABS = [
  "Overview",
  "Week ahead",
  "Analytics",
  "Library",
  "SEO",
  "Pipeline",
  "Identity",
  "Settings",
] as const;
type Tab = (typeof TABS)[number];

export default function ChannelHubPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const ownerId = useOwnerId();
  const [tab, setTab] = useState<Tab>("Overview");
  const [ytStatus, setYtStatus] = useState<string | null>(null);
  const [ytGot, setYtGot] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setYtStatus(q.get("yt"));
    setYtGot(q.get("got"));
  }, []);

  const channel = useQuery(api.channels.getChannelBySlug, {
    ownerId,
    slug,
  }) as ChannelDoc | null | undefined;

  const channelId = channel?._id as Id<"channels"> | undefined;
  const runs = useQuery(
    api.runs.listRunsByChannel,
    channelId ? { channelId } : "skip",
  ) as RawRun[] | undefined;

  if (channel === undefined) {
    return (
      <>
        <PageHeader title="Channel" />
        <SkeletonList rows={3} />
      </>
    );
  }
  if (channel === null) {
    return (
      <>
        <PageHeader title="Channel" />
        <EmptyState
          title="Channel not found"
          description={
            <>
              No channel with slug <code>{slug}</code>.{" "}
              <Link href="/channels" style={{ color: "var(--color-accent)" }}>
                Back to channels
              </Link>
            </>
          }
        />
      </>
    );
  }

  const id = channel.identity ?? {};
  const allRuns = runs ?? [];
  const videoRuns = allRuns.filter((r) => r.youtubeVideoId);
  const okRuns = allRuns.filter((r) => r.status === "ok");
  const failedRuns = allRuns.filter((r) => r.status === "failed");
  const totalCost = allRuns.reduce((s, r) => s + (r.costTotal ?? 0), 0);
  const costPerVideo = videoRuns.length > 0 ? totalCost / videoRuns.length : null;

  return (
    <>
      {ytStatus && (
        <div
          className="glass"
          style={{
            padding: "0.7rem 1rem",
            marginBottom: "1rem",
            fontSize: "0.85rem",
            border: `1px solid ${ytStatus === "connected" ? "rgba(52,211,153,0.5)" : "rgba(248,113,113,0.5)"}`,
            color: ytStatus === "connected" ? "var(--color-ok)" : "#fca5a5",
          }}
        >
          {ytStatus === "connected"
            ? "✓ YouTube connected — this channel is linked and active."
            : ytStatus === "wrongchannel"
              ? `⚠ You linked "${ytGot ?? "another channel"}", but this app channel was created as a different YouTube channel. Switch to the correct channel on youtube.com and click Link again — the wrong one was rejected.`
              : `⚠ YouTube connect failed${ytGot ? ` (${ytGot})` : ""}. Try Link to YouTube again.`}
        </div>
      )}

      {/* Banner + identity header */}
      <ChannelBanner
        bannerKey={id.bannerKey}
        name={channel.name}
        palette={id.palette}
        height={170}
      >
        <div
          style={{
            position: "absolute",
            left: "1.4rem",
            right: "1.4rem",
            bottom: "1.1rem",
            display: "flex",
            alignItems: "flex-end",
            gap: "1rem",
          }}
        >
          <ChannelAvatar
            imageKey={id.imageKey}
            name={channel.name}
            palette={id.palette}
            size={76}
            radius={18}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "1.9rem",
                fontWeight: 600,
                lineHeight: 1.1,
                margin: 0,
              }}
            >
              {channel.name}
            </h1>
            <div
              style={{
                marginTop: "0.3rem",
                fontSize: "0.82rem",
                color: "var(--color-muted)",
                display: "flex",
                gap: "0.7rem",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <span>{videoRuns.length} video{videoRuns.length === 1 ? "" : "s"} published</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{channel.status === "active" ? "Active" : "Paused"}</span>
            </div>
          </div>
          <StageBadge status={channel.status === "active" ? "ok" : "queued"} />
        </div>
      </ChannelBanner>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "0.3rem",
          margin: "1.2rem 0 1.5rem",
          borderBottom: "1px solid var(--color-border)",
          flexWrap: "wrap",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              font: "inherit",
              fontSize: "0.88rem",
              fontWeight: tab === t ? 600 : 500,
              color: tab === t ? "var(--color-fg)" : "var(--color-muted)",
              padding: "0.55rem 0.85rem",
              borderBottom:
                tab === t
                  ? "2px solid var(--color-accent)"
                  : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <OverviewTab
          channel={channel}
          runs={runs}
          kpis={{
            runs: allRuns.length,
            videos: videoRuns.length,
            completed: okRuns.length,
            failed: failedRuns.length,
            totalCost,
            costPerVideo,
          }}
        />
      )}
      {tab === "Analytics" && (
        <AnalyticsTab
          ownerId={ownerId}
          channelId={channelId}
          totalCost={totalCost}
          costPerVideo={costPerVideo}
          runs={allRuns}
        />
      )}
      {tab === "Week ahead" && channelId && (
        <WeekAheadTab ownerId={ownerId} channelId={channelId} />
      )}
      {tab === "Library" && (
        <LibraryTab ownerId={ownerId} channelId={channelId} />
      )}
      {tab === "SEO" && <SeoTab ownerId={ownerId} niche={id.niche} />}
      {tab === "Pipeline" && <PipelineTab pipeline={channel.pipeline ?? []} />}
      {tab === "Identity" && <IdentityTab id={id} budget={channel.budget} />}
      {tab === "Settings" && <SettingsTab channel={channel} />}
    </>
  );
}

/* ------------------------------- Overview ------------------------------- */

function OverviewTab({
  channel,
  runs,
  kpis,
}: {
  channel: ChannelDoc;
  runs: RawRun[] | undefined;
  kpis: {
    runs: number;
    videos: number;
    completed: number;
    failed: number;
    totalCost: number;
    costPerVideo: number | null;
  };
}) {
  const recent: RunRow[] = (runs ?? [])
    .map((r) => ({ ...r, channelName: channel.name, channelSlug: channel.slug }))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, 8);
  const overBudget =
    kpis.costPerVideo !== null && kpis.costPerVideo > channel.budget;

  // Surface the key configured SETTINGS (read from the pipeline params).
  const pipe = (channel.pipeline ?? []) as Array<{ block: string; params?: Record<string, unknown> }>;
  const param = (b: string, k: string): unknown => pipe.find((p) => p.block === b)?.params?.[k];
  const mins = (s: unknown): string => (typeof s === "number" ? `${Math.round((s / 60) * 10) / 10} min` : "—");
  const targetLen = param("script_gen", "maxSeconds");
  const minLen = param("length_check", "minSeconds");
  const maxLen = param("length_check", "maxSeconds");
  const tailSec = param("timeline_assemble", "tailSec");
  const maxQuotes = param("quote_overlays", "maxQuotes");
  const settings: { label: string; value: string }[] = [
    { label: "Target length", value: mins(targetLen) },
    { label: "Length range", value: minLen != null && maxLen != null ? `${mins(minLen)} – ${mins(maxLen)}` : "—" },
    { label: "Philosopher quotes", value: maxQuotes != null ? `up to ${maxQuotes}, ≥5s apart` : "≥2 attributed" },
    { label: "Outro", value: tailSec != null ? `${tailSec}s defined outro card` : "defined card" },
    { label: "Music", value: "gradual duck, fades out" },
    { label: "Thumbnail", value: "Flux Pro · statue-right / text-left" },
  ];

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "0.9rem",
          marginBottom: "1.8rem",
        }}
      >
        <StatCard label="Runs" value={kpis.runs} />
        <StatCard label="Videos" value={kpis.videos} accent="var(--color-secondary)" />
        <StatCard label="Completed" value={kpis.completed} accent="var(--color-ok)" />
        <StatCard
          label="Total spend"
          value={fmtUsd(kpis.totalCost)}
          accent="var(--color-accent)"
        />
        <StatCard
          label="Cost / video"
          value={kpis.costPerVideo === null ? "—" : fmtUsd(kpis.costPerVideo)}
          accent={overBudget ? "var(--color-failed)" : "var(--color-accent)"}
          hint={
            kpis.costPerVideo === null
              ? "no measured runs yet"
              : overBudget
                ? `over ${fmtUsd(channel.budget)} budget`
                : `within ${fmtUsd(channel.budget)} budget`
          }
        />
        <StatCard label="Budget / run" value={fmtUsd(channel.budget)} />
      </div>

      <LatestVideoWidget ownerId={channel.ownerId} channelId={channel._id as Id<"channels">} />

      <StatsCharts runs={(runs ?? []) as { status: string; startedAt?: number; finishedAt?: number; costTotal?: number }[]} />

      {channel.identity?.persona && (
        <section style={{ marginBottom: "1.6rem" }}>
          <SectionTitle>Persona</SectionTitle>
          <p
            className="glass"
            style={{
              padding: "1rem 1.2rem",
              fontSize: "0.92rem",
              color: "var(--color-muted)",
              lineHeight: 1.6,
            }}
          >
            {channel.identity.persona}
          </p>
        </section>
      )}

      <section style={{ marginBottom: "1.6rem" }}>
        <SectionTitle>Pipeline configuration</SectionTitle>
        <div
          className="glass"
          style={{
            padding: "1rem 1.2rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "0.8rem 1.4rem",
          }}
        >
          {settings.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
              <span style={{ fontSize: "0.72rem", color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {s.label}
              </span>
              <span style={{ fontSize: "0.92rem", color: "var(--color-fg)", fontWeight: 500 }}>{s.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Recent runs</SectionTitle>
        {runs === undefined ? (
          <SkeletonList rows={3} />
        ) : recent.length > 0 ? (
          <div style={{ display: "grid", gap: "0.6rem" }}>
            {recent.map((r) => (
              <RunCard key={r._id} run={r} />
            ))}
          </div>
        ) : (
          <EmptyState title="No runs for this channel yet" />
        )}
      </section>
    </>
  );
}

/* ------------------------------- Settings ------------------------------- */

function ChannelSettingsCard({ channel }: { channel: ChannelDoc }) {
  const update = useMutation(api.channels.updateChannel);
  const cid = channel._id as Id<"channels">;
  const active = channel.status === "active";
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState(String(channel.budget ?? 0));

  const pipe = (channel.pipeline ?? []) as Array<{ block: string; params?: Record<string, unknown> }>;
  const publishMode = (pipe.find((p) => p.block === "upload_draft")?.params?.["publishMode"] as string) ?? "draft";

  const setStatus = async (next: string) => {
    setBusy(true);
    try { await update({ channelId: cid, status: next }); } finally { setBusy(false); }
  };
  const setPublishMode = async (mode: string) => {
    setBusy(true);
    try {
      const next = pipe.map((p) =>
        p.block === "upload_draft" ? { ...p, params: { ...(p.params ?? {}), publishMode: mode } } : p,
      );
      await update({ channelId: cid, pipeline: next });
    } finally { setBusy(false); }
  };
  const saveBudget = async () => {
    const n = Number(budget);
    if (!Number.isFinite(n) || n < 0) return;
    setBusy(true);
    try { await update({ channelId: cid, budget: n }); } finally { setBusy(false); }
  };

  const labelStyle: CSSProperties = { fontSize: "0.86rem", fontWeight: 600, color: "var(--color-fg)" };
  const hintStyle: CSSProperties = { fontSize: "0.74rem", color: "var(--color-muted)", marginTop: 2 };
  const ctlSelect: CSSProperties = {
    background: "var(--color-bg-elev, #16161a)", color: "var(--color-fg)",
    border: "1px solid var(--color-border)", borderRadius: 8, padding: "0.45rem 0.6rem", fontSize: "0.85rem",
  };
  const ctlInput: CSSProperties = { ...ctlSelect, width: 96 };
  const ctlBtn: CSSProperties = {
    background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 8,
    padding: "0.45rem 0.85rem", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
  };

  const Row = ({ label, hint, children }: { label: string; hint: string; children: ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <div style={labelStyle}>{label}</div>
        <div style={hintStyle}>{hint}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );

  return (
    <section style={{ marginBottom: "1.6rem" }}>
      <SectionTitle>Settings</SectionTitle>
      <div className="glass" style={{ padding: "1.2rem", display: "grid", gap: "1.1rem" }}>
        <Row label="Channel" hint={active ? "Active — eligible for scheduled + manual runs" : "Paused — auto-scheduling skips it"}>
          <button
            onClick={() => setStatus(active ? "paused" : "active")}
            disabled={busy}
            style={{
              width: 86, height: 32, borderRadius: 999, cursor: busy ? "default" : "pointer",
              border: "1px solid var(--color-border)", position: "relative",
              background: active ? "rgba(52,211,153,0.20)" : "rgba(148,148,148,0.15)",
              color: active ? "var(--color-ok)" : "var(--color-muted)",
              fontWeight: 700, fontSize: "0.74rem", letterSpacing: "0.05em",
            }}
          >
            {active ? "ENABLED" : "DISABLED"}
          </button>
        </Row>
        <Row label="Auto-publish" hint="How finished videos go live on YouTube">
          <select value={publishMode} disabled={busy} onChange={(e) => setPublishMode(e.target.value)} style={ctlSelect}>
            <option value="draft">Private draft (you approve)</option>
            <option value="scheduled">Scheduled (drip)</option>
            <option value="public">Public immediately</option>
          </select>
        </Row>
        <Row label="Budget / run (USD)" hint="Cost cap per render; over-budget is flagged">
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input type="number" min="0" step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} style={ctlInput} />
            <button onClick={saveBudget} disabled={busy || budget === String(channel.budget)} style={ctlBtn}>Save</button>
          </div>
        </Row>
      </div>
    </section>
  );
}

/* -------------------------------- Settings ------------------------------ */

function SettingsTab({ channel }: { channel: ChannelDoc }) {
  return (
    <div style={{ display: "grid", gap: "1.6rem" }}>
      <ChannelSettingsCard channel={channel} />
      <YouTubeConnectCard channel={channel} />
      <AdvancedControls channel={channel} />
      <MultiLanguageCard channel={channel} />
    </div>
  );
}

/** Link this channel to a YouTube channel (OAuth) + best-effort Browserbase create. */
function YouTubeConnectCard({ channel }: { channel: ChannelDoc }) {
  const ownerId = useOwnerId();
  const links = useQuery(api.youtubeAuth.linkStatus, { ownerId }) as
    | { channelId: string; ytTitle: string | null; ytChannelId: string | null; updatedAt: number }[]
    | undefined;
  const link = links?.find((l) => l.channelId === channel._id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const connect = () => {
    window.location.href = `/api/youtube-connect?channelId=${channel._id}`;
  };
  const autoCreate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/youtube-create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: channel.name, channelId: channel._id }),
      });
      const d = await r.json();
      setMsg(
        r.ok
          ? "Creating the YouTube channel via the cloud agent (~1-2 min). When it's done, switch to it on youtube.com and click Connect to link it."
          : d.error || "Failed to start.",
      );
    } catch {
      setMsg("Network error.");
    } finally {
      setBusy(false);
    }
  };

  const btn: CSSProperties = {
    background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 10,
    padding: "0.6rem 1.2rem", fontSize: "0.88rem", fontWeight: 600, cursor: "pointer",
  };
  const ghost: CSSProperties = {
    background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-border)",
    borderRadius: 10, padding: "0.6rem 1.2rem", fontSize: "0.88rem", fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
  };

  return (
    <section>
      <SectionTitle>YouTube connection</SectionTitle>
      <div className="glass" style={{ padding: "1.2rem", display: "grid", gap: "1rem" }}>
        {link ? (
          <div style={{ fontSize: "0.86rem", color: "var(--color-ok)" }}>
            ✓ Linked to <strong>{link.ytTitle || link.ytChannelId || "a YouTube channel"}</strong> — uploads go here.
          </div>
        ) : (
          <div style={{ fontSize: "0.84rem", color: "var(--color-muted)" }}>
            Not linked yet. Connect a YouTube channel so this channel can publish. (A channel must exist on YouTube
            first — create one manually, or try Browserbase auto-create below.)
          </div>
        )}
        {!link && channel.youtubeCreated?.status === "creating" && (
          <div style={{ fontSize: "0.82rem", color: "#fbbf24", lineHeight: 1.5 }}>
            <span className="studio-pulse">●</span> Setting up the YouTube channel… (runs in the background — this
            updates by itself, no need to watch anything).
          </div>
        )}
        {!link && channel.youtubeCreated?.status !== "creating" && channel.youtubeCreated?.ytChannelId && (
          <div style={{ fontSize: "0.82rem", color: "var(--color-accent)", lineHeight: 1.5 }}>
            ● The agent created a YouTube channel for this:{" "}
            <a href={channel.youtubeCreated.url} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent)", textDecoration: "underline" }}>
              {channel.youtubeCreated.handle || channel.youtubeCreated.ytChannelId}
            </a>
            . Switch to it on youtube.com, then click <strong>Connect</strong> to finish linking.
          </div>
        )}
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={connect} style={btn}>{link ? "Reconnect YouTube" : "Connect YouTube"}</button>
          {!link && (
            <button onClick={autoCreate} disabled={busy} style={ghost}>
              {busy ? "Starting…" : "Auto-create channel (Browserbase)"}
            </button>
          )}
        </div>
        {!link && (
          <p style={{ fontSize: "0.74rem", color: "var(--color-faint)", margin: 0 }}>
            <strong>Connect</strong> links a channel via Google (instant, in your browser — switch to the target
            channel on youtube.com first). <strong>Auto-create</strong> uses the cloud agent to create a brand-new
            YouTube channel; once it exists, switch to it and Connect.
          </p>
        )}
        {msg && <p style={{ fontSize: "0.8rem", color: "var(--color-muted)", margin: 0 }}>{msg}</p>}
      </div>
    </section>
  );
}

const FLAGS: Record<string, string> = { en: "🇬🇧", de: "🇩🇪", es: "🇪🇸", fr: "🇫🇷", pt: "🇵🇹", it: "🇮🇹", nl: "🇳🇱" };

/** Multi-language group: clone this channel into DE + ES flag-branded siblings. */
function MultiLanguageCard({ channel }: { channel: ChannelDoc }) {
  const groupId = channel.groupId ?? channel._id;
  const group = useQuery(api.channels.listGroup, { groupId }) as ChannelDoc[] | undefined;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const siblings = (group ?? []).filter((c) => c._id !== channel._id);
  const haveLangs = new Set([channel.language ?? "en", ...siblings.map((c) => c.language ?? "")]);
  const targets = ["de", "es"].filter((l) => !haveLangs.has(l));

  const make = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/make-multilingual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId: channel._id, languages: targets }),
      });
      const d = await r.json();
      setMsg(r.ok ? "Creating siblings — they appear here in ~1 min (refresh)." : d.error || "Failed to start.");
    } catch {
      setMsg("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <SectionTitle>Multi-language group</SectionTitle>
      <div className="glass" style={{ padding: "1.2rem", display: "grid", gap: "1rem" }}>
        <div style={{ fontSize: "0.84rem", color: "var(--color-muted)", lineHeight: 1.5 }}>
          Clone this channel into language siblings — identical pipeline, shared profile image, a flag
          banner per country. Each renders in its own language; the expensive visuals are reused (the
          render-group engine finishes only narration, captions, text + metadata per language).
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>
            {FLAGS[channel.language ?? "en"] ?? "🌐"} {channel.groupRole === "sibling" ? "Sibling" : "Base"} · {(channel.language ?? "en").toUpperCase()}
          </span>
          {siblings.map((s) => (
            <Link key={s._id} href={`/channels/${s.slug}`} className="glass lift"
              style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", borderRadius: 8, display: "flex", gap: "0.35rem", alignItems: "center" }}>
              {FLAGS[s.language ?? ""] ?? "🌐"} {(s.language ?? "?").toUpperCase()}
              <span style={{ color: s.status === "active" ? "var(--color-ok)" : "var(--color-muted)", fontSize: "0.66rem" }}>
                {s.status === "active" ? "live" : s.status}
              </span>
            </Link>
          ))}
        </div>
        {targets.length > 0 ? (
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={make} disabled={busy} style={{
              background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 10,
              padding: "0.6rem 1.2rem", fontSize: "0.88rem", fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}>
              {busy ? "Creating…" : `+ Make multi-language (${targets.map((l) => FLAGS[l]).join(" ")})`}
            </button>
            {msg && <span style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>{msg}</span>}
          </div>
        ) : (
          <div style={{ fontSize: "0.82rem", color: "var(--color-ok)" }}>✓ DE + ES siblings exist for this group.{msg ? ` ${msg}` : ""}</div>
        )}
      </div>
    </section>
  );
}

/**
 * Voice + cadence + niche-narrowing controls, plus a button to regenerate fresh
 * competitor + SEO intelligence for the (possibly newly-narrowed) niche.
 */
function AdvancedControls({ channel }: { channel: ChannelDoc }) {
  const update = useMutation(api.channels.updateChannel);
  const cid = channel._id as Id<"channels">;
  const id = channel.identity ?? ({} as ChannelIdentity);

  const [voice, setVoice] = useState(id.voiceId ?? "sleepless_historian");
  const [cadence, setCadence] = useState(channel.schedule?.frequency ?? id.cadence ?? "weekly");
  const [days, setDays] = useState<number[]>(channel.schedule?.days ?? [1]);
  const [niche, setNiche] = useState(id.niche ?? "");
  const [nicheKey, setNicheKey] = useState("");
  const [subcat, setSubcat] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [research, setResearch] = useState<string | null>(null);

  const dirty =
    voice !== (id.voiceId ?? "sleepless_historian") ||
    cadence !== (channel.schedule?.frequency ?? id.cadence ?? "weekly") ||
    JSON.stringify(days) !== JSON.stringify(channel.schedule?.days ?? [1]) ||
    niche.trim() !== (id.niche ?? "") ||
    Boolean(nicheKey && subcat);

  const catalogNiche = NICHES.find((n) => n.key === nicheKey);

  const applyCatalog = (subName: string) => {
    setSubcat(subName);
    if (catalogNiche) setNiche(`${catalogNiche.label} — ${subName}`);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const nextId = { ...id, voiceId: voice, cadence, niche: niche.trim() };
      // If a catalog subcategory was picked, seed its SEO tags into the metadata
      // block so the pipeline automates from them (v1 catalog defaults).
      const seed = nicheKey && subcat ? subcategoryTags(nicheKey, subcat) : [];
      const pipelinePatch =
        seed.length && channel.pipeline
          ? channel.pipeline.map((p) =>
              p.block === "metadata"
                ? { ...p, params: { ...((p.params as Record<string, unknown>) ?? {}), baseTags: seed } }
                : p,
            )
          : undefined;
      await update({
        channelId: cid,
        identity: nextId,
        schedule: { frequency: cadence, days },
        ...(pipelinePatch ? { pipeline: pipelinePatch } : {}),
      } as Parameters<typeof update>[0]);
      setMsg(seed.length ? `Saved · seeded ${seed.length} SEO tags.` : "Saved.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    const n = niche.trim();
    if (!n) { setResearch("Set a niche first."); return; }
    setBusy(true);
    setResearch(null);
    try {
      // Persist the niche first so the research keys off the latest value.
      if (n !== (id.niche ?? "")) {
        await update({ channelId: cid, identity: { ...id, voiceId: voice, cadence, niche: n } } as Parameters<typeof update>[0]);
      }
      const r = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ niche: n, channelId: cid }),
      });
      const d = await r.json();
      setResearch(
        r.ok
          ? `Researching "${n}" — fresh competitor + SEO intel will populate the SEO tab shortly.`
          : d.error || "Could not start research.",
      );
    } catch {
      setResearch("Network error starting research.");
    } finally {
      setBusy(false);
    }
  };

  const sel: CSSProperties = {
    background: "var(--color-bg-elev, #16161a)", color: "var(--color-fg)",
    border: "1px solid var(--color-border)", borderRadius: 8, padding: "0.45rem 0.6rem", fontSize: "0.85rem",
  };
  const labelStyle: CSSProperties = { fontSize: "0.86rem", fontWeight: 600, color: "var(--color-fg)" };
  const hintStyle: CSSProperties = { fontSize: "0.74rem", color: "var(--color-muted)", marginTop: 2 };
  const btn: CSSProperties = {
    background: "var(--color-accent)", color: "#0a0a0b", border: "none", borderRadius: 8,
    padding: "0.5rem 1rem", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
  };
  const Row = ({ label, hint, children }: { label: string; hint: string; children: ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <div style={labelStyle}>{label}</div>
        <div style={hintStyle}>{hint}</div>
      </div>
      <div style={{ flexShrink: 0, display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>{children}</div>
    </div>
  );

  return (
    <section>
      <SectionTitle>Production controls</SectionTitle>
      <div className="glass" style={{ padding: "1.2rem", display: "grid", gap: "1.1rem" }}>
        <Row label="Narration voice" hint="Fish Audio reference voice used for the voiceover">
          <select value={voice} disabled={busy} onChange={(e) => setVoice(e.target.value)} style={sel}>
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>{v.label}{v.note ? ` — ${v.note}` : ""}</option>
            ))}
          </select>
        </Row>

        <Row label="Upload cadence" hint="How often this channel publishes">
          <select value={cadence} disabled={busy} onChange={(e) => setCadence(e.target.value)} style={sel}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
          </select>
        </Row>
        {(cadence === "weekly" || cadence === "biweekly") && (
          <Row label="Upload days" hint="Which weekdays the scheduler may run">
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {DOW.map((d, i) => {
                const on = days.includes(i);
                return (
                  <button key={i} disabled={busy}
                    onClick={() => setDays((p) => on ? p.filter((x) => x !== i) : [...p, i].sort())}
                    style={{
                      width: 34, height: 30, borderRadius: 7, cursor: "pointer", fontSize: "0.72rem", fontWeight: 600,
                      border: `1px solid ${on ? "var(--color-accent)" : "var(--color-border)"}`,
                      background: on ? "var(--color-accent)" : "var(--color-surface)",
                      color: on ? "#0a0a0b" : "var(--color-muted)",
                    }}>{d[0]}</button>
                );
              })}
            </div>
          </Row>
        )}

        <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "1.1rem", display: "grid", gap: "0.7rem" }}>
          <div>
            <div style={labelStyle}>Niche</div>
            <div style={hintStyle}>Narrow it down for sharper topics + competitor research</div>
          </div>
          <input
            value={niche}
            disabled={busy}
            onChange={(e) => setNiche(e.target.value)}
            placeholder="e.g. stoic philosophy — daily discipline"
            style={{ ...sel, width: "100%" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <select value={nicheKey} disabled={busy} onChange={(e) => { setNicheKey(e.target.value); setSubcat(""); }} style={sel}>
              <option value="">From catalog…</option>
              {NICHES.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
            </select>
            {catalogNiche && (
              <select value={subcat} disabled={busy} onChange={(e) => applyCatalog(e.target.value)} style={sel}>
                <option value="">Sub-category…</option>
                {catalogNiche.subcategories.map((s) => (
                  <option key={s.id} value={s.name}>{s.name} — ~{s.searchVolume}K · ${(s.rpm ?? catalogNiche.rpm).toFixed(1)} RPM</option>
                ))}
              </select>
            )}
          </div>
          {nicheKey && subcat && subcategoryTags(nicheKey, subcat).length > 0 && (
            <div style={{ fontSize: "0.72rem", color: "var(--color-muted)" }}>
              Seeds {subcategoryTags(nicheKey, subcat).length} SEO tags the pipeline expands with AI:{" "}
              <span style={{ color: "var(--color-faint)" }}>{subcategoryTags(nicheKey, subcat).slice(0, 6).join(", ")}…</span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={save} disabled={busy || !dirty} style={{ ...btn, opacity: busy || !dirty ? 0.5 : 1 }}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <button onClick={regenerate} disabled={busy || !niche.trim()} style={{
            ...btn, background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-border)",
            opacity: busy || !niche.trim() ? 0.5 : 1,
          }}>
            ↻ Regenerate competitor + SEO intel
          </button>
          {msg && <span style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>{msg}</span>}
        </div>
        {research && <p style={{ fontSize: "0.8rem", color: "var(--color-muted)", margin: 0 }}>{research}</p>}
      </div>
    </section>
  );
}

/* ------------------------------- Analytics ------------------------------ */

function AnalyticsTab({
  ownerId,
  channelId,
  totalCost,
  costPerVideo,
  runs,
}: {
  ownerId: string;
  channelId?: Id<"channels">;
  totalCost: number;
  costPerVideo: number | null;
  runs: RawRun[];
}) {
  const trend = useQuery(
    api.analytics.channelTrend,
    channelId ? { ownerId, channelId, days: 90 } : "skip",
  ) as TrendRow[] | undefined;

  const growth: ChartSeries[] = [
    {
      name: "Subscribers",
      color: "var(--color-accent)",
      points: (trend ?? []).map((r) => ({
        label: r.date.slice(5),
        value: r.subscriberCount,
      })),
    },
    {
      name: "Views",
      color: "var(--color-secondary)",
      points: (trend ?? []).map((r) => ({
        label: r.date.slice(5),
        value: r.totalViews,
      })),
    },
  ];

  // Cost per run over time (real, from runStages.cost rollup).
  const costSeries: ChartSeries[] = [
    {
      name: "Cost / run",
      color: "var(--color-accent)",
      points: runs
        .filter((r) => r.startedAt)
        .sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
        .map((r) => ({
          label: new Date(r.startedAt ?? 0).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
          value: r.costTotal ?? 0,
        })),
    },
  ];

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "0.9rem",
          marginBottom: "1.6rem",
        }}
      >
        <StatCard label="Total spend" value={fmtUsd(totalCost)} accent="var(--color-accent)" />
        <StatCard
          label="Cost / video"
          value={costPerVideo === null ? "—" : fmtUsd(costPerVideo)}
          accent="var(--color-accent)"
        />
      </div>

      <div style={{ display: "grid", gap: "1.2rem" }}>
        <Chart title="Audience growth (90d)" series={growth} formatValue={(n) => compact(n)} />
        <Chart title="Cost per run" series={costSeries} formatValue={(n) => `$${n.toFixed(2)}`} />
      </div>

      {trend !== undefined && trend.length === 0 && (
        <p style={{ marginTop: "1rem", fontSize: "0.82rem", color: "var(--color-faint)" }}>
          Audience metrics populate once the stats-refresh task runs (needs the
          YouTube Data API enabled). Cost is live from your runs.
        </p>
      )}
    </>
  );
}

/* ------------------------------- Library -------------------------------- */

function LibraryTab({
  ownerId,
  channelId,
}: {
  ownerId: string;
  channelId?: Id<"channels">;
}) {
  const videos = useQuery(
    api.videos.listVideos,
    channelId ? { ownerId, channelId, limit: 500 } : "skip",
  ) as VideoRow[] | undefined;
  const [index, setIndex] = useState<number | null>(null);

  if (videos === undefined) return <SkeletonList rows={3} />;
  if (videos.length === 0)
    return (
      <EmptyState
        title="No videos yet"
        description="Finished and published videos for this channel will appear here."
      />
    );

  return (
    <>
      <VideoGrid
        videos={videos}
        onOpen={(v) => setIndex(videos.findIndex((x) => x._id === v._id))}
      />
      {index !== null && index >= 0 && (
        <Lightbox
          videos={videos}
          index={index}
          onIndex={setIndex}
          onClose={() => setIndex(null)}
        />
      )}
    </>
  );
}

/* --------------------------------- SEO ---------------------------------- */

function SeoTab({ ownerId, niche }: { ownerId: string; niche?: string }) {
  const intel = useQuery(
    api.seo.getNiche,
    niche ? { ownerId, niche } : "skip",
  ) as
    | {
        powerWords?: { word: string; count: number }[];
        optimalTitleLen?: number;
        avgViewsTop50?: number;
        medianViewsTop50?: number;
        thumbnailStyleGuide?: { notes?: string };
      }
    | null
    | undefined;
  const databank = useQuery(
    api.seo.getDatabank,
    niche ? { ownerId, niche } : "skip",
  ) as
    | {
        titleTemplates?: string[];
        hookPatterns?: string[];
        competitorGaps?: string[];
      }
    | null
    | undefined;
  const competitors = useQuery(
    api.competitors.listCompetitors,
    niche ? { ownerId, niche } : "skip",
  ) as Array<{ topVideos?: { title: string; views: number }[] }> | undefined;
  const topVids = (competitors ?? [])
    .flatMap((c) => c.topVideos ?? [])
    .sort((a, b) => b.views - a.views)
    .slice(0, 12);

  if (!niche)
    return (
      <EmptyState
        title="No niche set"
        description="Set this channel's niche (Identity tab) to unlock competitor research and SEO intelligence."
      />
    );
  if (intel === undefined) return <SkeletonList rows={3} />;
  if (!intel)
    return (
      <EmptyState
        title="No research yet"
        description={`Niche "${niche}" hasn't been researched. Run the research task (needs the YouTube Data API enabled) to populate competitor intelligence.`}
      />
    );

  return (
    <div style={{ display: "grid", gap: "1.4rem" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "0.9rem",
        }}
      >
        <StatCard label="Optimal title length" value={intel.optimalTitleLen ?? "—"} />
        <StatCard
          label="Avg views (top 50)"
          value={intel.avgViewsTop50 ? compact(intel.avgViewsTop50) : "—"}
          accent="var(--color-secondary)"
        />
        <StatCard
          label="Median views (top 50)"
          value={intel.medianViewsTop50 ? compact(intel.medianViewsTop50) : "—"}
          accent="var(--color-secondary)"
        />
      </div>

      {topVids.length > 0 && (
        <section>
          <SectionTitle>Top competitor videos</SectionTitle>
          <div style={{ display: "grid", gap: "0.4rem" }}>
            {topVids.map((v, i) => (
              <div
                key={i}
                className="glass"
                style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.6rem 0.9rem", fontSize: "0.84rem" }}
              >
                <span style={{ color: "var(--color-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.title}</span>
                <span style={{ color: "var(--color-secondary)", whiteSpace: "nowrap" }}>{compact(v.views)} views</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {intel.powerWords && intel.powerWords.length > 0 && (
        <section>
          <SectionTitle>Power words</SectionTitle>
          <ChipRow
            items={intel.powerWords.slice(0, 24).map((p) => `${p.word} ·${p.count}`)}
            tone="accent"
          />
        </section>
      )}
      {databank?.titleTemplates && databank.titleTemplates.length > 0 && (
        <section>
          <SectionTitle>Title templates</SectionTitle>
          <List items={databank.titleTemplates} />
        </section>
      )}
      {databank?.hookPatterns && databank.hookPatterns.length > 0 && (
        <section>
          <SectionTitle>Hook patterns</SectionTitle>
          <List items={databank.hookPatterns} />
        </section>
      )}
      {databank?.competitorGaps && databank.competitorGaps.length > 0 && (
        <section>
          <SectionTitle>Competitor gaps</SectionTitle>
          <List items={databank.competitorGaps} />
        </section>
      )}
    </div>
  );
}

/* ------------------------------- Pipeline ------------------------------- */

function PipelineTab({
  pipeline,
}: {
  pipeline: { block: string; params?: unknown }[];
}) {
  if (pipeline.length === 0)
    return <EmptyState title="No pipeline configured" />;
  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      {pipeline.map((p, i) => {
        const params = p.params as Record<string, unknown> | undefined;
        const hasParams = params && Object.keys(params).length > 0;
        return (
          <div
            key={`${p.block}-${i}`}
            className="glass"
            style={{
              padding: "0.8rem 1rem",
              display: "flex",
              alignItems: "center",
              gap: "0.8rem",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.78rem",
                color: "var(--color-faint)",
                width: 24,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.9rem" }}>
              {p.block}
            </span>
            {hasParams && (
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.72rem",
                  color: "var(--color-muted)",
                }}
              >
                {Object.entries(params!)
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join("  ")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- Identity ------------------------------- */

function IdentityTab({
  id,
  budget,
}: {
  id: ChannelIdentity;
  budget: number;
}) {
  const bible = id.creativeBrief;
  return (
    <div style={{ display: "grid", gap: "1.4rem" }}>
      {bible && (
        <section>
          <SectionTitle>Show Bible · film crew</SectionTitle>
          <div className="glass glass-shine" style={{ padding: "1.25rem 1.4rem", display: "grid", gap: "1rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1.1rem" }}>
              <Field label="Positioning" value={bible.positioning} />
              <Field label="Vibe" value={bible.vibe} />
              <Field label="Iconic motif" value={bible.iconicMotif} />
            </div>
            {bible.activeCrew?.length > 0 && (
              <div>
                <div style={{ fontSize: "0.7rem", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-faint)", marginBottom: "0.4rem" }}>Active crew</div>
                <ChipRow items={bible.activeCrew} tone="accent" />
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.1rem" }}>
              {bible.worksInSpace?.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--color-ok)", marginBottom: "0.4rem" }}>✓ Works in this space</div>
                  <List items={bible.worksInSpace} />
                </div>
              )}
              {bible.avoidInSpace?.length > 0 && (
                <div>
                  <div style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--color-failed)", marginBottom: "0.4rem" }}>✕ Avoid (fails here)</div>
                  <List items={bible.avoidInSpace} />
                </div>
              )}
            </div>
          </div>
        </section>
      )}
      <div
        className="glass glass-shine"
        style={{
          padding: "1.25rem 1.4rem",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "1.1rem",
        }}
      >
        <Field label="Niche" value={id.niche ?? "—"} />
        <Field label="Cadence" value={id.cadence ?? "—"} />
        <Field label="Voice" value={id.voiceId ?? "—"} mono />
        <Field label="Thumbnail" value={id.thumbnailTemplate ?? "—"} />
        <Field label="Per-run budget" value={fmtUsd(budget)} mono />
      </div>

      {id.palette && id.palette.length > 0 && (
        <section>
          <SectionTitle>Palette</SectionTitle>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {id.palette.map((c) => (
              <div key={c} style={{ textAlign: "center" }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 10,
                    background: c,
                    border: "1px solid var(--color-border)",
                  }}
                />
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "0.65rem",
                    color: "var(--color-faint)",
                    marginTop: "0.25rem",
                  }}
                >
                  {c}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {id.styleGrammar && (
        <section>
          <SectionTitle>Style grammar</SectionTitle>
          <p
            className="glass"
            style={{ padding: "1rem 1.2rem", fontSize: "0.88rem", color: "var(--color-muted)", lineHeight: 1.6 }}
          >
            {id.styleGrammar}
          </p>
        </section>
      )}
      {id.topicPool && id.topicPool.length > 0 && (
        <section>
          <SectionTitle>Topic pool</SectionTitle>
          <ChipRow items={id.topicPool} tone="secondary" />
        </section>
      )}
      {id.bannedWords && id.bannedWords.length > 0 && (
        <section>
          <SectionTitle>Banned words</SectionTitle>
          <ChipRow items={id.bannedWords} tone="muted" />
        </section>
      )}
    </div>
  );
}

/* ------------------------------- helpers -------------------------------- */

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.7rem",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--color-faint)",
          marginBottom: "0.3rem",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "0.95rem", fontFamily: mono ? "var(--font-mono)" : undefined }}>
        {value}
      </div>
    </div>
  );
}

function ChipRow({
  items,
  tone,
}: {
  items: string[];
  tone: "accent" | "secondary" | "muted";
}) {
  const color =
    tone === "accent"
      ? "var(--color-accent)"
      : tone === "secondary"
        ? "var(--color-secondary)"
        : "var(--color-muted)";
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
      {items.map((it, i) => (
        <span
          key={`${it}-${i}`}
          style={{
            fontSize: "0.76rem",
            padding: "0.25rem 0.6rem",
            borderRadius: 8,
            color,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          {it}
        </span>
      ))}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <div style={{ display: "grid", gap: "0.4rem" }}>
      {items.map((it, i) => (
        <div
          key={i}
          className="glass"
          style={{ padding: "0.7rem 0.95rem", fontSize: "0.86rem", color: "var(--color-muted)" }}
        >
          {it}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Week ahead ------------------------------ */

/** Presigned R2 image (key → /api/asset-url → <img>). */
function AssetImg({ k, alt, style }: { k?: string; alt: string; style?: CSSProperties }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!k) return;
    let live = true;
    fetch(`/api/asset-url?key=${encodeURIComponent(k)}`)
      .then((r) => r.json())
      .then((d) => { if (live && d.url) setUrl(d.url); })
      .catch(() => {});
    return () => { live = false; };
  }, [k]);
  const base: CSSProperties = {
    background: "var(--color-surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--color-muted)",
    fontSize: "0.72rem",
    ...style,
  };
  if (!url) return <div style={base}>{k ? "rendering…" : "no thumbnail"}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} style={{ objectFit: "cover", ...style }} />;
}

type PlanRow = {
  _id: Id<"contentPlan">;
  topic: string;
  title?: string;
  description?: string;
  thumbnailKey?: string;
  status: string;
};

function WeekAheadTab({ ownerId, channelId }: { ownerId: string; channelId: Id<"channels"> }) {
  const plan = useQuery(api.contentPlan.listPlan, { ownerId, channelId }) as PlanRow[] | undefined;
  const del = useMutation(api.contentPlan.deleteItem);
  const reorder = useMutation(api.contentPlan.reorder);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/plan-week", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelId, count: 5 }),
      });
      const d = await r.json();
      setMsg(r.ok ? "Planning 5 upcoming videos — thumbnails appear as they finish." : d.error || "Failed to start.");
    } catch {
      setMsg("Failed to start.");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = async (targetId: string) => {
    const from = dragId.current;
    dragId.current = null;
    if (!from || !plan || from === targetId) return;
    const ids = plan.map((p) => p._id as string);
    const fi = ids.indexOf(from);
    const ti = ids.indexOf(targetId);
    if (fi < 0 || ti < 0) return;
    ids.splice(ti, 0, ids.splice(fi, 1)[0]);
    await reorder({ ids: ids as Id<"contentPlan">[] });
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <SectionTitle>Week ahead — upcoming videos</SectionTitle>
        <button
          onClick={generate}
          disabled={busy}
          className="glass"
          style={{ padding: "0.5rem 1rem", fontSize: "0.85rem", fontWeight: 600, color: "var(--color-fg)", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Starting…" : "+ Plan 5 more"}
        </button>
      </div>
      {msg && <p style={{ fontSize: "0.82rem", color: "var(--color-muted)", marginBottom: "0.9rem" }}>{msg}</p>}

      {plan === undefined ? (
        <SkeletonList rows={3} />
      ) : plan.length === 0 ? (
        <EmptyState title="No upcoming videos planned yet" description="Click “Plan 5 more” to pre-build topics, thumbnails and descriptions." />
      ) : (
        <div style={{ display: "grid", gap: "0.8rem" }}>
          {plan.map((p) => (
            <div
              key={p._id}
              draggable
              onDragStart={() => { dragId.current = p._id; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(p._id)}
              className="glass"
              style={{ display: "grid", gridTemplateColumns: "200px 1fr auto", gap: "1rem", padding: "0.7rem", alignItems: "center", cursor: "grab" }}
            >
              <AssetImg k={p.thumbnailKey} alt={p.title ?? p.topic} style={{ width: "200px", height: "112px", borderRadius: "8px" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", minWidth: 0 }}>
                <span style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--color-fg)" }}>{p.title || p.topic}</span>
                {p.title && p.title !== p.topic && (
                  <span style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>{p.topic}</span>
                )}
                {p.description && (
                  <span style={{ fontSize: "0.8rem", color: "var(--color-muted)", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {p.description}
                  </span>
                )}
                <span style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em", color: p.status === "ready" ? "var(--color-ok)" : "var(--color-muted)" }}>
                  {p.status === "ready" ? "● ready" : "○ generating…"}
                </span>
              </div>
              <button
                onClick={() => del({ id: p._id })}
                title="Delete"
                style={{ background: "none", border: "none", color: "var(--color-muted)", fontSize: "1.1rem", cursor: "pointer", padding: "0.4rem" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
