"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOperationsAccess } from "@/components/OperationsAccess";
import styles from "./studio-assets.module.css";

type AssetRoom = "approved" | "decisions" | "identity" | "catalog";

type StudioAsset = {
  logicalId: string;
  title: string;
  fingerprint: string;
  scope: "owned_studio" | "channel" | "series";
  channelId?: string;
  seriesIdentity?: string;
  assetKind: string;
  status: "approved" | "deprecated" | "revoked";
  identitySensitivity: "portable" | "channel" | "series";
  compatibility: {
    families: string[];
    contentLanes: string[];
    moduleIds: string[];
    treatments: string[];
    runtimeFingerprint?: string;
  };
  approval: { qualityScore: number; approvedBy: string; approvedAt: number };
  hasRecipe: boolean;
  recipePreview: string[];
  resource?: { contentType: string; byteLength: number; contentSha256: string };
  lora?: {
    candidateId: string;
    adapterClass: "standard_lora" | "ic_lora";
    renderStrength?: number;
    controlKinds: string[];
    requiresComfyWorkflow?: boolean;
    requiresSeriesBinding: boolean;
    benchmarkFingerprint: string;
    runtimeFingerprint: string;
  };
  loraStack?: { adapterCount: number; runtimeFingerprint: string };
  controlGuide?: { controlKind: string; targetId: string };
};

type StudioReusableMedia = {
  logicalId: string;
  fingerprint: string;
  channelId: string;
  family: string;
  kind: string;
  title: string;
  status: "approved" | "deprecated" | "revoked";
  editorialTags: string[];
  evergreen: boolean;
  durationSec?: number;
  contentType: string;
  qualityScore: number;
  maximumLifetimeUses: number;
  cooldownEpisodes: number;
  sourceOrigin: "third_party_stock" | "studio_generated";
};

type EpisodeAssetFolder = {
  _id: string;
  channelId: string;
  name: string;
  createdAt: number;
};

type EpisodeAssetFolderAssignment = {
  _id: string;
  channelId: string;
  folderId: string;
  assetFingerprint: string;
  updatedAt: number;
};

type EpisodeAssetFolderInventory = {
  folders: EpisodeAssetFolder[];
  assignments: EpisodeAssetFolderAssignment[];
};

type StudioChannelOption = { _id: string; name: string; slug: string };

type VisualTreatmentCatalogItem = {
  key: string;
  label: string;
  description: string;
  activePlanningFamilies: string[];
  futureFamilySeeds: string[];
  qaBenchmarkCount: number;
  rendererPrerequisites: string[];
};

type StudioAssetReleaseFeedback = {
  assetEntryFingerprint: string;
  sealedFinalMasters: number;
  measuredVisualFinalMasters: number;
  meanVisualScore: number | null;
  demonstratedForEqualApprovalTieBreak: boolean;
  latestObservedAt: number;
};

/** Browser-safe only: the candidate recipe and release-object location stay server-only. */
type StudioAssetPromotionCandidate = {
  candidateFingerprint: string;
  title: string;
  assetKind: string;
  channelId: string;
  family: string;
  contentLane: string;
  treatment?: string;
  visualQualityScore: number;
  visualMinimumScore: number;
  finalMasterSha256: string;
  finalMasterReleaseCertificateFingerprint: string;
};

/** Metadata-only projection of one accepted, reusable series character adapter. */
type AcceptedCharacterLoRA = {
  registryIdentity: string;
  characterId: string;
  characterSpecFingerprint: string;
  datasetFingerprint: string;
  provider: string;
  adapterFlavor: string;
  runtimeProfileFingerprint: string;
  acceptedAt: number;
};

type StudioAssetImagePreview = {
  title: string;
  url: string;
  contentType: string;
  contentSha256: string;
};

function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function when(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Recorded time unavailable" : date.toLocaleDateString();
}

function executionLabel(asset: StudioAsset): string {
  if (asset.assetKind === "transition_template") {
    return "Approved for the compatible, render-tested title-to-body transition";
  }
  if (asset.assetKind === "overlay_template") return "Approved for compatible quote-card presentation";
  if (asset.assetKind === "motion_graphics_template") return "Approved for compatible data-graphic presentation";
  if (asset.assetKind === "audio_recipe") return "Approved as bounded direction beneath the locked channel sound";
  if (asset.assetKind === "standard_lora_stack") {
    return "Benchmarked adapter pair · one primary identity plus one complementary detail adapter";
  }
  if (asset.assetKind !== "standard_lora_adapter" && asset.assetKind !== "ic_lora_adapter") {
    return asset.status === "approved" ? "Approved for compatible planning" : asset.status;
  }
  if (asset.assetKind === "ic_lora_adapter") {
    return asset.lora?.requiresComfyWorkflow
      ? "Dedicated control workflow · sealed workflow and exact guide required"
      : "Dedicated control workflow · workflow proof required";
  }
  return "Candidate adapter · a matching qualified render route is required";
}

function kindLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function AssetHero({
  access,
  summary,
  loading,
  onRefresh,
}: {
  access: ReturnType<typeof useOperationsAccess>;
  summary: { approved: number; pending: number; reusable: number } | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className={styles.hero} aria-busy={access === "checking" || (access === "owner" && loading) || undefined}>
      <div className={styles.heroCopy}>
        <h1>Studio assets</h1>
        <p>Reusable media, recipes, and visual treatments.</p>
      </div>
      <button type="button" className={styles.refresh} disabled={loading} title={loading ? "Registry refresh is already in progress" : undefined} data-disabled-reason={loading ? "Registry refresh is already in progress" : undefined} onClick={onRefresh}>
        {loading ? "Refreshing…" : access === "owner" ? "Refresh registry" : "Refresh catalog"}
      </button>
      {summary ? <ul className={styles.metricRail} aria-label="Registry summary">
        <li><span>Ready to reuse</span><strong>{summary.approved}</strong></li>
        <li><span>Awaiting review</span><strong>{summary.pending}</strong></li>
        <li><span>Studio-wide</span><strong>{summary.reusable}</strong></li>
      </ul> : null}
    </header>
  );
}

function ViewerBoundary() {
  return (
    <aside className={styles.viewerBoundary}>
      <div className={styles.lockedCopy}>
        <strong>Read-only catalog</strong>
        <span>Explore render-ready concepts without opening private inventory.</span>
      </div>
      <span className={styles.boundaryPill}>Private approvals stay protected</span>
    </aside>
  );
}

function AssetRoomTabs({ room, setRoom, counts, publicMode }: { room: AssetRoom; setRoom: (room: AssetRoom) => void; counts: Record<AssetRoom, number>; publicMode: boolean }) {
  const rooms: { id: AssetRoom; label: string }[] = (publicMode ? [
    { id: "catalog" as const, label: "Catalog" },
  ] : [
    { id: "approved", label: "Inventory" },
    { id: "decisions", label: "Decisions" },
    { id: "identity", label: "Characters" },
    { id: "catalog", label: "Catalog" },
  ]);
  return (
    <nav className={styles.roomTabs} aria-label="Studio asset rooms">
      {rooms.map(item => <button key={item.id} type="button" aria-pressed={room === item.id} className={room === item.id ? styles.roomTabActive : ""} onClick={() => setRoom(item.id)}><strong>{item.label}</strong><span>{counts[item.id]}</span></button>)}
    </nav>
  );
}

function AssetRoomIntro({ room }: { room: AssetRoom }) {
  const copy: Record<AssetRoom, { title: string; detail: string }> = {
    approved: { title: "Media & recipes", detail: "Only approved entries can be reused within their recorded scope." },
    decisions: { title: "Review candidates", detail: "Approve proven recipes for the same channel. Approval rechecks final-master evidence." },
    identity: { title: "Character identity", detail: "Accepted adapters stay bound to their original character, dataset, and runtime." },
    catalog: { title: "Visual treatments", detail: "Storyboard and review profiles—not installed weights or render permission." },
  };
  const selected = copy[room];
  return <header className={styles.roomHeader}><h2>{selected.title}</h2><p>{selected.detail}</p></header>;
}

function EpisodeAssetFolderActions({
  folder,
  busy,
  onRename,
  onRemove,
}: {
  folder: EpisodeAssetFolder;
  busy: boolean;
  onRename: (folderId: string, name: string) => void;
  onRemove: (folderId: string) => void;
}) {
  const [renameDraft, setRenameDraft] = useState(folder.name);
  return <details className={styles.folderActions}>
    <summary>Manage {folder.name}</summary>
    <form onSubmit={(event) => { event.preventDefault(); const name = renameDraft.trim(); if (name && name !== folder.name) onRename(folder._id, name); }}>
      <label htmlFor="episode-folder-rename">Folder name</label>
      <input id="episode-folder-rename" value={renameDraft} maxLength={40} onChange={(event) => setRenameDraft(event.target.value)} disabled={busy} />
      <button type="submit" className={styles.previewButton} disabled={busy || !renameDraft.trim() || renameDraft.trim() === folder.name}>Rename</button>
      <button type="button" className={styles.folderDanger} disabled={busy} onClick={() => {
        if (window.confirm(`Remove “${folder.name}”? Its assets will become unfiled.`)) onRemove(folder._id);
      }}>Remove folder</button>
    </form>
  </details>;
}

function EpisodeAssetFolderBar({
  folders,
  assignments,
  channels,
  selectedFolder,
  onSelectFolder,
  folderDraft,
  onFolderDraft,
  folderChannelId,
  onFolderChannel,
  onCreate,
  onRename,
  onRemove,
  busy,
  message,
  assetCount,
  unfiledCount,
}: {
  folders: EpisodeAssetFolder[];
  assignments: EpisodeAssetFolderAssignment[];
  channels: StudioChannelOption[];
  selectedFolder: string;
  onSelectFolder: (folderId: string) => void;
  folderDraft: string;
  onFolderDraft: (value: string) => void;
  folderChannelId: string;
  onFolderChannel: (value: string) => void;
  onCreate: () => void;
  onRename: (folderId: string, name: string) => void;
  onRemove: (folderId: string) => void;
  busy: boolean;
  message: string | null;
  assetCount: number;
  unfiledCount: number;
}) {
  const selected = folders.find((folder) => folder._id === selectedFolder) ?? null;
  const countByFolder = new Map<string, number>();
  for (const assignment of assignments) {
    countByFolder.set(assignment.folderId, (countByFolder.get(assignment.folderId) ?? 0) + 1);
  }
  return (
    <section className={styles.episodeFolders} aria-labelledby="episode-asset-folders-title">
      <div className={styles.episodeFoldersHead}>
        <div>
          <span className={styles.kind}>Persistent organization</span>
          <h2 id="episode-asset-folders-title">Episode folders</h2>
        </div>
        <span className={styles.folderHint}>Moves keep release evidence unchanged</span>
      </div>
      <div className={styles.folderChips} role="toolbar" aria-label="Open episode asset folder">
        <button type="button" className={selectedFolder === "all" ? styles.folderChipActive : styles.folderChip} aria-pressed={selectedFolder === "all"} onClick={() => onSelectFolder("all")}>
          All assets <b>{assetCount}</b>
        </button>
        <button type="button" className={selectedFolder === "unfiled" ? styles.folderChipActive : styles.folderChip} aria-pressed={selectedFolder === "unfiled"} onClick={() => onSelectFolder("unfiled")}>
          Unfiled <b>{unfiledCount}</b>
        </button>
        {folders.map((folder) => (
          <button key={folder._id} type="button" className={selectedFolder === folder._id ? styles.folderChipActive : styles.folderChip} aria-pressed={selectedFolder === folder._id} onClick={() => onSelectFolder(folder._id)}>
            <span>{folder.name}</span><b>{countByFolder.get(folder._id) ?? 0}</b>
          </button>
        ))}
      </div>
      <form className={styles.folderCreate} onSubmit={(event) => { event.preventDefault(); onCreate(); }}>
        <label htmlFor="episode-folder-name">New folder</label>
        <input id="episode-folder-name" value={folderDraft} onChange={(event) => onFolderDraft(event.target.value)} maxLength={40} placeholder="e.g. Roman ruins" />
        <select aria-label="Channel for new episode folder" value={folderChannelId} onChange={(event) => onFolderChannel(event.target.value)} disabled={!channels.length || busy}>
          {channels.length ? channels.map((channel) => <option key={channel._id} value={channel._id}>{channel.name}</option>) : <option value="">No channels</option>}
        </select>
        <button type="submit" className={styles.previewButton} disabled={!folderDraft.trim() || !folderChannelId || busy}>{busy ? "Saving…" : "Create folder"}</button>
      </form>
      {selected ? <EpisodeAssetFolderActions key={selected._id} folder={selected} busy={busy} onRename={onRename} onRemove={onRemove} /> : null}
      {message ? <p className={styles.folderMessage} role="status">{message}</p> : null}
    </section>
  );
}

export default function StudioAssetsPage() {
  const operationsAccess = useOperationsAccess();
  // Remount when the session crosses the elevation boundary so the initial
  // room follows the new mode without synchronously setting state in an effect.
  return <OwnedStudioAssetsPage key={operationsAccess === "owner" ? "owner" : "viewer"} access={operationsAccess} />;
}

function OwnedStudioAssetsPage({ access }: { access: ReturnType<typeof useOperationsAccess> }) {
  const publicMode = access !== "owner";
  const [room, setRoom] = useState<AssetRoom>(() => publicMode ? "catalog" : "approved");
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [reusableMedia, setReusableMedia] = useState<StudioReusableMedia[]>([]);
  const [episodeAssetFolders, setEpisodeAssetFolders] = useState<EpisodeAssetFolderInventory>({ folders: [], assignments: [] });
  const [studioChannels, setStudioChannels] = useState<StudioChannelOption[]>([]);
  const [candidates, setCandidates] = useState<StudioAssetPromotionCandidate[]>([]);
  const [visualTreatmentCatalog, setVisualTreatmentCatalog] = useState<VisualTreatmentCatalogItem[]>([]);
  const [releaseFeedback, setReleaseFeedback] = useState<StudioAssetReleaseFeedback[]>([]);
  const [acceptedCharacterLoRAs, setAcceptedCharacterLoRAs] = useState<AcceptedCharacterLoRA[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<StudioAssetImagePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [approvingCandidate, setApprovingCandidate] = useState<string | null>(null);
  const [episodeFolderFilter, setEpisodeFolderFilter] = useState<string>("all");
  const [folderDraft, setFolderDraft] = useState("");
  const [folderChannelId, setFolderChannelId] = useState("");
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  const previewOriginRef = useRef<HTMLElement | null>(null);
  const previewCloseRef = useRef<HTMLButtonElement | null>(null);
  const registryRequestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    registryRequestRef.current?.abort();
    const controller = new AbortController();
    registryRequestRef.current = controller;
    setLoading(true);
    setLoadError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/studio-assets", { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as {
        ok?: boolean;
        assets?: StudioAsset[];
        reusableMedia?: StudioReusableMedia[];
        episodeAssetFolders?: EpisodeAssetFolderInventory;
        channels?: StudioChannelOption[];
        candidates?: StudioAssetPromotionCandidate[];
        visualTreatmentCatalog?: VisualTreatmentCatalogItem[];
        releaseFeedback?: StudioAssetReleaseFeedback[];
        acceptedCharacterLoRAs?: AcceptedCharacterLoRA[];
        error?: string;
      };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Could not load Studio assets");
      // All inventory collections are required by the real API. A partial or
      // malformed response is unavailable data, not a successfully empty room.
      if (![payload.assets, payload.reusableMedia, payload.candidates, payload.visualTreatmentCatalog,
        payload.releaseFeedback, payload.acceptedCharacterLoRAs].every(Array.isArray)
        || !payload.episodeAssetFolders
        || !Array.isArray(payload.episodeAssetFolders.folders)
        || !Array.isArray(payload.episodeAssetFolders.assignments)
        || !Array.isArray(payload.channels)) {
        throw new Error("The registry response is incomplete. Refresh to try again.");
      }
      if (controller.signal.aborted) return;
      setAssets(payload.assets ?? []);
      setReusableMedia(payload.reusableMedia ?? []);
      setEpisodeAssetFolders(payload.episodeAssetFolders);
      setStudioChannels(payload.channels);
      setCandidates(payload.candidates ?? []);
      setVisualTreatmentCatalog(payload.visualTreatmentCatalog ?? []);
      setReleaseFeedback(payload.releaseFeedback ?? []);
      setAcceptedCharacterLoRAs(payload.acceptedCharacterLoRAs ?? []);
      setLoaded(true);
    } catch (error) {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Could not load Studio assets");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  const approveCandidate = useCallback(async (candidateFingerprint: string) => {
    if (approvingCandidate) return;
    const signal = registryRequestRef.current?.signal;
    setApprovingCandidate(candidateFingerprint);
    setMessage(null);
    try {
      const response = await fetch("/api/studio-assets", {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve-candidate", candidateFingerprint }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (signal?.aborted) return;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not approve Studio asset candidate");
      }
      await refresh();
      if (registryRequestRef.current?.signal.aborted) return;
      setMessage("Candidate approved for its source channel. It can now be reused only where its sealed compatibility matches.");
    } catch (error) {
      if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "Could not approve Studio asset candidate");
    } finally {
      setApprovingCandidate(null);
    }
  }, [approvingCandidate, refresh]);

  const mutateEpisodeFolder = useCallback(async (body: Record<string, unknown>, successMessage: string) => {
    if (folderBusy) return false;
    setFolderBusy(true);
    setFolderMessage(null);
    try {
      const response = await fetch("/api/studio-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Episode folder action failed");
      await refresh();
      setFolderMessage(successMessage);
      return true;
    } catch (error) {
      setFolderMessage(error instanceof Error ? error.message : "Episode folder action failed");
      return false;
    } finally {
      setFolderBusy(false);
    }
  }, [folderBusy, refresh]);

  const createEpisodeFolder = useCallback(async () => {
    const name = folderDraft.trim();
    if (!name || !folderChannelId) return;
    const created = await mutateEpisodeFolder({
      action: "create-episode-folder",
      channelId: folderChannelId,
      name,
    }, "Episode folder created");
    if (created) setFolderDraft("");
  }, [folderChannelId, folderDraft, mutateEpisodeFolder]);

  const renameEpisodeFolder = useCallback(async (folderId: string, name: string) => {
    await mutateEpisodeFolder({ action: "rename-episode-folder", folderId, name }, "Episode folder renamed");
  }, [mutateEpisodeFolder]);

  const removeEpisodeFolder = useCallback(async (folderId: string) => {
    const removed = await mutateEpisodeFolder({ action: "remove-episode-folder", folderId }, "Episode folder removed; its assets are unfiled");
    if (removed) setEpisodeFolderFilter("all");
  }, [mutateEpisodeFolder]);

  const moveEpisodeAsset = useCallback(async (asset: StudioReusableMedia, folderId: string) => {
    await mutateEpisodeFolder({
      action: "move-episode-asset",
      channelId: asset.channelId,
      assetFingerprint: asset.fingerprint,
      ...(folderId ? { folderId } : {}),
    }, folderId ? "Episode asset filed" : "Episode asset unfiled");
  }, [mutateEpisodeFolder]);

  const openImagePreview = useCallback(async (asset: StudioAsset, origin: HTMLElement) => {
    if (asset.status !== "approved" || !asset.resource?.contentType.startsWith("image/") || previewLoading) return;
    const signal = registryRequestRef.current?.signal;
    previewOriginRef.current = origin;
    setPreviewLoading(asset.fingerprint);
    setPreviewError(null);
    try {
      const response = await fetch(`/api/studio-assets?preview=${encodeURIComponent(asset.fingerprint)}`, {
        cache: "no-store",
        signal,
      });
      const payload = await response.json() as {
        ok?: boolean;
        preview?: { url?: unknown; contentType?: unknown; contentSha256?: unknown };
        error?: string;
      };
      if (signal?.aborted) return;
      if (
        !response.ok
        || !payload.ok
        || typeof payload.preview?.url !== "string"
        || typeof payload.preview.contentType !== "string"
        || typeof payload.preview.contentSha256 !== "string"
      ) {
        throw new Error(payload.error ?? "Approved image preview is unavailable");
      }
      setPreview({
        title: asset.title,
        url: payload.preview.url,
        contentType: payload.preview.contentType,
        contentSha256: payload.preview.contentSha256,
      });
    } catch (error) {
      if (!signal?.aborted) setPreviewError(error instanceof Error ? error.message : "Approved image preview is unavailable");
    } finally {
      setPreviewLoading(null);
    }
  }, [previewLoading]);

  useEffect(() => {
    if (!preview) return;
    previewCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previewOriginRef.current?.focus();
      previewOriginRef.current = null;
    };
  }, [preview]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      registryRequestRef.current?.abort();
    };
  }, [access, refresh]);

  const summary = useMemo(() => ({
    approved: assets.filter((asset) => asset.status === "approved").length + reusableMedia.filter((asset) => asset.status === "approved").length,
    pending: candidates.length,
    reusable: assets.filter((asset) => asset.status === "approved" && asset.scope === "owned_studio" && asset.identitySensitivity === "portable").length,
  }), [assets, candidates, reusableMedia]);
  const feedbackByAsset = useMemo(
    () => new Map(releaseFeedback.map((feedback) => [feedback.assetEntryFingerprint, feedback])),
    [releaseFeedback],
  );
  const episodeFolderByAsset = useMemo(
    () => new Map(episodeAssetFolders.assignments.map((assignment) => [assignment.assetFingerprint, assignment.folderId])),
    [episodeAssetFolders.assignments],
  );
  const currentEpisodeAssignments = useMemo(() => {
    const fingerprints = new Set(reusableMedia.map((asset) => asset.fingerprint));
    return episodeAssetFolders.assignments.filter((assignment) => fingerprints.has(assignment.assetFingerprint));
  }, [episodeAssetFolders.assignments, reusableMedia]);
  const visibleReusableMedia = useMemo(
    () => reusableMedia.filter((asset) => {
      if (episodeFolderFilter === "all") return true;
      if (episodeFolderFilter === "unfiled") return !episodeFolderByAsset.has(asset.fingerprint);
      return episodeFolderByAsset.get(asset.fingerprint) === episodeFolderFilter;
    }),
    [episodeFolderByAsset, episodeFolderFilter, reusableMedia],
  );
  const unfiledEpisodeAssetCount = useMemo(
    () => reusableMedia.filter((asset) => !episodeFolderByAsset.has(asset.fingerprint)).length,
    [episodeFolderByAsset, reusableMedia],
  );
  const roomCounts: Record<AssetRoom, number> = {
    approved: assets.length + reusableMedia.length,
    decisions: candidates.length,
    identity: acceptedCharacterLoRAs.length,
    catalog: visualTreatmentCatalog.length,
  };
  const registryReady = loaded && !loading && !loadError;

  return (
    <div className={styles.page}>
      <AssetHero
        access={access}
        summary={registryReady && !publicMode ? summary : null}
        loading={loading}
        onRefresh={() => { void refresh(); }}
      />
      {publicMode ? <ViewerBoundary /> : null}

      {loading ? <p className={styles.loadStatus} role="status">Loading Studio asset registry…</p> : null}
      {loadError ? <div className={styles.error} role="alert"><strong>Inventory unavailable</strong><p>{loadError}</p></div> : null}
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
      {previewError ? <p className={styles.error} role="alert">{previewError}</p> : null}
      {registryReady ? <>
      <AssetRoomTabs room={room} setRoom={setRoom} counts={roomCounts} publicMode={publicMode} />
      <AssetRoomIntro room={room} />

      {!loading && room === "approved" && !message && assets.length === 0 && reusableMedia.length === 0 ? (
        <div className={styles.empty}>
          <strong>No approved Studio assets yet.</strong>
          <span>Reviewed assets will appear here. Until then, pipelines create original material.</span>
        </div>
      ) : null}

      {!loading && room === "approved" && !publicMode ? <EpisodeAssetFolderBar
        folders={episodeAssetFolders.folders}
        assignments={currentEpisodeAssignments}
        channels={studioChannels}
        selectedFolder={episodeFolderFilter}
        onSelectFolder={setEpisodeFolderFilter}
        folderDraft={folderDraft}
        onFolderDraft={setFolderDraft}
        folderChannelId={folderChannelId || studioChannels[0]?._id || ""}
        onFolderChannel={setFolderChannelId}
        onCreate={() => { void createEpisodeFolder(); }}
        onRename={(folderId, name) => { void renameEpisodeFolder(folderId, name); }}
        onRemove={(folderId) => { void removeEpisodeFolder(folderId); }}
        busy={folderBusy}
        message={folderMessage}
        assetCount={reusableMedia.length}
        unfiledCount={unfiledEpisodeAssetCount}
      /> : null}

      {!loading && room === "approved" && visibleReusableMedia.length ? <section className={styles.catalog} aria-labelledby="studio-reusable-media-bank">
        <div className={styles.catalogHead}>
          <div>
            <span className={styles.kind}>Channel media bank</span>
            <h2 id="studio-reusable-media-bank">Release-proven clips</h2>
          </div>
          <p>{visibleReusableMedia.length} shown · 40% maximum · every third episode original</p>
        </div>
        <div className={styles.grid}>
          {visibleReusableMedia.map((asset) => <article className={styles.card} key={asset.fingerprint}>
            <div className={styles.cardHead}>
              <div>
                <span className={styles.kind}>{kindLabel(asset.kind)}</span>
                <h2>{asset.title}</h2>
              </div>
              <span className={asset.status === "approved" ? styles.approved : styles.muted}>{asset.status}</span>
            </div>
            <p className={styles.execution}>Channel-only media · release QA passed</p>
            <dl className={styles.meta}>
              <div><dt>Duration</dt><dd>{asset.durationSec ? `${asset.durationSec.toFixed(1)} sec` : "still"}</dd></div>
              <div><dt>Quality</dt><dd>{asset.qualityScore.toFixed(1)}/10</dd></div>
              <div><dt>Reuse limit</dt><dd>{asset.maximumLifetimeUses} releases · {asset.cooldownEpisodes}-episode gap</dd></div>
              <div><dt>Evidence</dt><dd title={asset.fingerprint}>{shortHash(asset.fingerprint)}</dd></div>
            </dl>
            <div className={styles.tags} aria-label="Media compatibility">
              <span>{kindLabel(asset.family)}</span>
              <span>{asset.sourceOrigin === "third_party_stock" ? "rights bound" : "studio generated"}</span>
              {asset.evergreen ? <span>evergreen</span> : null}
              {asset.editorialTags.slice(0, 4).map((tag) => <span key={tag}>{kindLabel(tag)}</span>)}
            </div>
            <label className={styles.folderSelect}>
              <span>Folder</span>
              <select
                value={episodeFolderByAsset.get(asset.fingerprint) ?? ""}
                disabled={folderBusy}
                onChange={(event) => { void moveEpisodeAsset(asset, event.target.value); }}
              >
                <option value="">Unfiled</option>
                {episodeAssetFolders.folders
                  .filter((folder) => folder.channelId === asset.channelId)
                  .map((folder) => <option key={folder._id} value={folder._id}>{folder.name}</option>)}
              </select>
            </label>
            <p className={styles.feedback}>Same channel only · selected clips stay below the sealed timeline ceiling.</p>
          </article>)}
        </div>
      </section> : null}

      {!loading && room === "decisions" && candidates.length ? <section className={styles.catalog} aria-label="Reviewed candidates awaiting approval">
        <div className={styles.grid}>
          {candidates.map((candidate) => <article className={styles.card} key={candidate.candidateFingerprint}>
            <div className={styles.cardHead}>
              <div>
                <span className={styles.kind}>{kindLabel(candidate.assetKind)}</span>
                <h2>{candidate.title}</h2>
              </div>
              <span className={styles.muted}>awaiting approval</span>
            </div>
            <p className={styles.execution}>A channel-only reusable recipe proposal. Its recipe remains private until the final-master evidence has been rechecked on approval.</p>
            <dl className={styles.meta}>
              <div><dt>Visual review</dt><dd>{candidate.visualQualityScore}/100 · floor {candidate.visualMinimumScore}/100</dd></div>
              <div><dt>Channel</dt><dd title={candidate.channelId}>{shortHash(candidate.channelId)}</dd></div>
              <div><dt>Family</dt><dd>{kindLabel(candidate.family)}</dd></div>
              <div><dt>Evidence</dt><dd title={candidate.finalMasterReleaseCertificateFingerprint}>{shortHash(candidate.finalMasterReleaseCertificateFingerprint)}</dd></div>
            </dl>
            <div className={styles.tags} aria-label="Candidate compatibility">
              <span>{kindLabel(candidate.contentLane)}</span>
              {candidate.treatment ? <span>{kindLabel(candidate.treatment)}</span> : null}
            </div>
            <p className={styles.feedback}>Final-master binding · {shortHash(candidate.finalMasterSha256)} · no render, training, or publication action.</p>
            <button
              type="button"
              className={styles.previewButton}
              disabled={approvingCandidate !== null}
              onClick={() => { void approveCandidate(candidate.candidateFingerprint); }}
            >
              {approvingCandidate === candidate.candidateFingerprint ? "Rechecking evidence…" : "Approve for this channel"}
            </button>
          </article>)}
        </div>
      </section> : null}

      {!loading && room === "approved" && assets.length ? <section className={styles.grid} aria-label="Studio asset inventory">
        {assets.map((asset) => {
          const feedback = feedbackByAsset.get(asset.fingerprint);
          return <article className={styles.card} key={asset.fingerprint}>
            <div className={styles.cardHead}>
              <div>
                <span className={styles.kind}>{kindLabel(asset.assetKind)}</span>
                <h2>{asset.title}</h2>
              </div>
              <span className={asset.status === "approved" ? styles.approved : styles.muted}>{asset.status}</span>
            </div>
            <p className={styles.execution}>{executionLabel(asset)}</p>
            <dl className={styles.meta}>
              <div><dt>Scope</dt><dd>{asset.scope.replaceAll("_", " ")}</dd></div>
              <div><dt>Quality</dt><dd>{asset.approval.qualityScore}/100</dd></div>
              <div><dt>Approved</dt><dd>{when(asset.approval.approvedAt)} · {asset.approval.approvedBy}</dd></div>
              <div><dt>Evidence</dt><dd title={asset.fingerprint}>{shortHash(asset.fingerprint)}</dd></div>
            </dl>
            <div className={styles.tags} aria-label="Compatibility">
              {asset.compatibility.families.map((value) => <span key={`family-${value}`}>{value}</span>)}
              {asset.compatibility.treatments.map((value) => <span key={`treatment-${value}`}>{kindLabel(value)}</span>)}
            </div>
            {asset.recipePreview.length ? <p className={styles.recipe}>{asset.recipePreview.join(" · ")}</p> : null}
            {asset.status === "approved" && asset.resource?.contentType.startsWith("image/") ? <button
              type="button"
              className={styles.previewButton}
              disabled={previewLoading !== null}
              onClick={(event) => { void openImagePreview(asset, event.currentTarget); }}
            >
              {previewLoading === asset.fingerprint ? "Opening preview…" : "Preview approved image"}
            </button> : null}
            {asset.lora ? <p className={styles.adapter}>Adapter <code>{asset.lora.candidateId}</code>{asset.lora.renderStrength ? ` · strength ${asset.lora.renderStrength}` : ""}{asset.lora.controlKinds.length ? ` · controls: ${asset.lora.controlKinds.join(", ")}` : ""}{asset.lora.requiresComfyWorkflow ? " · sealed Comfy workflow" : ""}</p> : null}
            {asset.loraStack ? <p className={styles.adapter}>Approved stack · {asset.loraStack.adapterCount} exact adapters · combined RTX 4090 quality benchmark</p> : null}
            {asset.controlGuide ? <p className={styles.adapter}>Guide: {asset.controlGuide.controlKind} · target {asset.controlGuide.targetId}</p> : null}
            {feedback ? <p className={styles.feedback}>
              Final-master signal · {feedback.sealedFinalMasters} sealed master{feedback.sealedFinalMasters === 1 ? "" : "s"}
              {feedback.meanVisualScore === null ? " · visual score not measured" : ` · mean visual ${feedback.meanVisualScore.toFixed(1)}/10`}
              {feedback.demonstratedForEqualApprovalTieBreak
                ? " · demonstrated tie-break evidence"
                : ` · ${Math.max(0, 3 - feedback.measuredVisualFinalMasters)} more measured master${feedback.measuredVisualFinalMasters === 2 ? "" : "s"} before it can break an equal approval tie`}
            </p> : <p className={styles.feedback}>No sealed final-master feedback yet · approval and benchmark remain the only selection evidence.</p>}
          </article>
        })}
      </section> : null}

      {!loading && room === "identity" && acceptedCharacterLoRAs.length ? <section className={styles.catalog} aria-label="Persistent character adapters">
        <div className={styles.grid}>
          {acceptedCharacterLoRAs.map((adapter) => (
            <article className={styles.card} key={adapter.registryIdentity}>
              <div className={styles.cardHead}>
                <div>
                  <span className={styles.kind}>series-bound character</span>
                  <h2>{adapter.characterId}</h2>
                </div>
                <span className={styles.approved}>accepted for reuse</span>
              </div>
              <p className={styles.execution}>Locked to one character specification and dataset. A matching future episode reuses this identity instead of requesting another training run.</p>
              <dl className={styles.meta}>
                <div><dt>Adapter</dt><dd>{adapter.provider} · {kindLabel(adapter.adapterFlavor)}</dd></div>
                <div><dt>Accepted</dt><dd>{when(adapter.acceptedAt)}</dd></div>
                <div><dt>Registry</dt><dd title={adapter.registryIdentity}>{shortHash(adapter.registryIdentity)}</dd></div>
                <div><dt>Runtime proof</dt><dd title={adapter.runtimeProfileFingerprint}>{shortHash(adapter.runtimeProfileFingerprint)}</dd></div>
              </dl>
              <p className={styles.adapter}>Character specification · {shortHash(adapter.characterSpecFingerprint)} · dataset binding · {shortHash(adapter.datasetFingerprint)}</p>
              <p className={styles.feedback}>Reusable registry evidence only · rendering still requires the matching pinned worker, guide/control contract where applicable, budget reservation, and final review.</p>
            </article>
          ))}
        </div>
      </section> : null}

      {!loading && room === "catalog" && visualTreatmentCatalog.length ? <section className={styles.catalog} aria-labelledby="visual-treatment-catalog">
        <div className={styles.catalogHead}>
          <div>
            <span className={styles.kind}>Visual treatment catalog</span>
            <h2 id="visual-treatment-catalog">Storyboard and review profiles</h2>
          </div>
          <p>Profiles bind visual plans and continuity checks.</p>
        </div>
        <div className={`${styles.grid} ${styles.catalogGrid}`}>
          {visualTreatmentCatalog.map((treatment) => (
            <details className={styles.card} key={treatment.key}>
              <summary className={styles.cardSummary}>
              <div className={styles.cardHead}>
                <div>
                  <span className={styles.kind}>Planning + QA only</span>
                  <h2>{treatment.label}</h2>
                </div>
                <span className={styles.muted}>no renderer admitted</span>
              </div>
              <span className={styles.cardToggle}>View details</span>
              </summary>
              <p className={styles.execution}>Canonical plan → character and setting sheets → storyboard/motion locks → visual review</p>
              <dl className={styles.meta}>
                <div><dt>Benchmarks</dt><dd>{treatment.qaBenchmarkCount} visual checks</dd></div>
                <div><dt>Scope</dt><dd>supervised treatment only</dd></div>
              </dl>
              <div className={styles.tags} aria-label="Active treatment planning consumer">
                {treatment.activePlanningFamilies.map((family) => <span key={`active-${family}`}>{kindLabel(family)} · active plan</span>)}
              </div>
              <p className={styles.recipe}>{treatment.description}</p>
              {treatment.futureFamilySeeds.length ? <p className={styles.adapter}>Future supervised route seeds: {treatment.futureFamilySeeds.map(kindLabel).join(", ")} · not enabled by this catalog</p> : null}
              <p className={styles.adapter}>Renderer gate: {treatment.rendererPrerequisites[0] ?? "adapter benchmark required"}</p>
            </details>
          ))}
        </div>
      </section> : null}

      {!loading && room !== "approved" && roomCounts[room] === 0 ? <div className={styles.empty}>
        <strong>No {room} records are available.</strong>
        <span>The registry returned no entries for this section.</span>
      </div> : null}

      <details className={styles.boundaryStrip}>
        <summary>Reuse rules</summary>
        <ul>
          <li>Browse approved Studio assets. Owner approval is explicit.</li>
          <li>Read-only evidence inventory: no storage locations, model bytes, or persistent signed URLs.</li>
          <li>Open one short-lived preview for an approved image. Channel and character identity stay within their recorded scope.</li>
          <li>Official catalog entries are not installed weights or render permission; an assembly consumer is not admitted until render-parity is proven.</li>
        </ul>
      </details>
      </> : null}

      {preview ? <div className={styles.previewBackdrop} role="presentation" onMouseDown={() => setPreview(null)}>
        <section
          className={styles.previewDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="studio-asset-image-preview-title"
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Tab") {
              // The dialog has one interactive control. Keep keyboard focus
              // in the overlay instead of allowing Tab to reach the hidden
              // asset grid behind it.
              event.preventDefault();
              previewCloseRef.current?.focus();
            }
          }}
        >
          <div className={styles.previewHead}>
            <div>
              <span className={styles.kind}>Approved source asset</span>
              <h2 id="studio-asset-image-preview-title">{preview.title}</h2>
            </div>
            <button ref={previewCloseRef} type="button" className={styles.previewClose} onClick={() => setPreview(null)}>Close</button>
          </div>
          {/* This URL is minted only after an owner-authenticated click and is
              intentionally not retained in the asset inventory response. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.previewImage} src={preview.url} alt={`Approved Studio asset preview: ${preview.title}`} />
          <p className={styles.previewProof}>Image evidence · {preview.contentType} · SHA-256 {shortHash(preview.contentSha256)}</p>
        </section>
      </div> : null}
    </div>
  );
}
