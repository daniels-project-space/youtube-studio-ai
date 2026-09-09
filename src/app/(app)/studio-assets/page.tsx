"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOperationsAccess } from "@/components/OperationsAccess";
import styles from "./studio-assets.module.css";

type AssetRoom = "approved" | "decisions" | "identity" | "runtime" | "catalog";

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

type CuratedLtxCatalogItem = {
  id: string;
  label: string;
  adapterClass: "standard_lora" | "ic_lora";
  purpose: "style" | "subject" | "distillation" | null;
  controls: string[];
  qualityMetric: string;
  qualityPhase: "base_generation" | "shot_control" | "targeted_postprocess";
  sourceUrl: string;
  baseModelVersions: string[];
  loaders: string[];
  supportedFamilies: string[];
  status: "descriptor_only_pending_integrity_pin" | "curation_ready";
  activationGate:
    | "exact_runtime_and_benchmark"
    | "pinned_asset_license_and_direct_benchmark"
    | "pinned_asset_license_workflow_and_benchmark"
    | "pinned_asset_license_workflow_guide_and_benchmark";
  recommendedWorkflowProfiles: {
    workflowId: string;
    qualityRole: string;
    guideKinds: string[];
  }[];
  executionTarget: null | {
    provider: "novita";
    gpuSku: "RTX 5090";
    minimumVramGb: number;
    executor: "dedicated_comfyui_ltx";
  };
  notes: string[];
};

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

type MusicVideoA2VidReadiness = {
  id: string;
  status: "not_installed" | "benchmark_admitted";
  label: string;
  executionTarget: string;
  currentWorkerBoundary: { workerPath: string; loader: string; reason: string };
  activeBenchmark?: {
    runtimeFingerprint: string;
    benchmarkFingerprint: string;
    gpuSku: string;
    minimumVramGb: number;
    admittedAt: string;
  };
  requirements: string[];
};

/** Browser-safe, owner-scoped state for the direct open-weight LTX worker. */
type DirectLtxRuntimeStatus = {
  status: "attested" | "unattested";
  gpuSku: string;
  vramGb: number;
  benchmarkedProfileCount: number;
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
    return "Benchmarked self-hosted LTX pair · one primary adapter plus one complementary detail adapter";
  }
  if (asset.assetKind !== "standard_lora_adapter" && asset.assetKind !== "ic_lora_adapter") {
    return asset.status === "approved" ? "Approved for compatible planning" : asset.status;
  }
  if (asset.assetKind === "ic_lora_adapter") {
    return asset.lora?.requiresComfyWorkflow
      ? "Dedicated self-hosted ComfyUI/LTX control · sealed workflow and exact guide required · direct LTX blocked"
      : "Dedicated self-hosted ComfyUI/LTX control · workflow proof required · direct LTX blocked";
  }
  return "Self-hosted open-weight LTX 2.5 candidate · Novita worker hash verified at render";
}

function kindLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function curatedExecutionLabel(candidate: CuratedLtxCatalogItem): string {
  if (candidate.activationGate === "exact_runtime_and_benchmark") {
    return "Base-quality component · requires an exact pinned runtime and output-quality benchmark";
  }
  if (candidate.adapterClass === "ic_lora") {
    return "Comfy control candidate · requires a guide, exact workflow pin, and shot benchmark";
  }
  if (candidate.activationGate === "pinned_asset_license_and_direct_benchmark") {
    return "Self-hosted open-weight LTX candidate · requires pinned adapter bytes and an exact Novita-worker quality benchmark";
  }
  return "Dedicated Comfy LoRA candidate · requires a sealed workflow and benchmark";
}

function curatedGateLabel(candidate: CuratedLtxCatalogItem): string {
  switch (candidate.activationGate) {
    case "exact_runtime_and_benchmark":
      return "runtime pin · benchmark";
    case "pinned_asset_license_and_direct_benchmark":
      return "adapter pin · licence · direct benchmark";
    case "pinned_asset_license_workflow_and_benchmark":
      return "adapter pin · licence · workflow · benchmark";
    case "pinned_asset_license_workflow_guide_and_benchmark":
      return "adapter pin · licence · workflow · guide · benchmark";
  }
}

function curatedQualityPhaseLabel(phase: CuratedLtxCatalogItem["qualityPhase"]): string {
  switch (phase) {
    case "base_generation":
      return "base generation";
    case "shot_control":
      return "shot control";
    case "targeted_postprocess":
      return "targeted post-process";
  }
}

function curatedExecutionTargetLabel(target: NonNullable<CuratedLtxCatalogItem["executionTarget"]>): string {
  return `Dedicated ComfyUI/LTX · ${target.provider} ${target.gpuSku} · ${target.minimumVramGb} GB minimum`;
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
        <p>Reusable media, recipes &amp; character assets.</p>
      </div>
      {access === "owner" ? <button type="button" className={styles.refresh} disabled={loading} onClick={onRefresh}>
        {loading ? "Reading registry…" : "Refresh registry"}
      </button> : null}
      {summary ? <ul className={styles.metricRail} aria-label="Registry summary">
        <li><span>Ready to reuse</span><strong>{summary.approved}</strong></li>
        <li><span>Awaiting review</span><strong>{summary.pending}</strong></li>
        <li><span>Studio-wide</span><strong>{summary.reusable}</strong></li>
      </ul> : null}
    </header>
  );
}

function LockedAssetRegistry({ access }: { access: Exclude<ReturnType<typeof useOperationsAccess>, "owner"> }) {
  return (
    <section className={styles.lockedRegistry} aria-live={access === "checking" ? "polite" : undefined}>
      <div className={styles.lockedCopy}>
        <h2>{access === "checking" ? "Checking access…" : access === "unavailable" ? "Access check unavailable" : "Private asset library"}</h2>
        <p>{access === "checking" ? "Reading this browser session." : "Approvals, adapters, and private previews remain unloaded."}</p>
      </div>
      {access !== "checking" ? <a href="/api/operations/authorize" className={styles.refresh}>Verify with YouTube</a> : null}
    </section>
  );
}

function AssetRoomTabs({ room, setRoom, counts }: { room: AssetRoom; setRoom: (room: AssetRoom) => void; counts: Record<AssetRoom, number> }) {
  const rooms: { id: AssetRoom; label: string }[] = [
    { id: "approved", label: "Inventory" },
    { id: "decisions", label: "Decisions" },
    { id: "identity", label: "Characters" },
    { id: "runtime", label: "Workers" },
    { id: "catalog", label: "Catalog" },
  ];
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
    runtime: { title: "Worker readiness", detail: "Benchmarks qualify a specific path, not permission to spend or publish." },
    catalog: { title: "Quality catalog", detail: "Model and treatment references—not installed weights or render permission." },
  };
  const selected = copy[room];
  return <header className={styles.roomHeader}><h2>{selected.title}</h2><p>{selected.detail}</p></header>;
}

export default function StudioAssetsPage() {
  const operationsAccess = useOperationsAccess();
  // Private state is discarded when owner access is lost, including previews.
  // A later owner session must obtain its own inventory, not reuse old counts.
  if (operationsAccess === "owner") return <OwnedStudioAssetsPage />;
  return <div className={styles.page}>
    <AssetHero access={operationsAccess} summary={null} loading={false} onRefresh={() => {}} />
    <LockedAssetRegistry access={operationsAccess} />
  </div>;
}

function OwnedStudioAssetsPage() {
  const [room, setRoom] = useState<AssetRoom>("approved");
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [reusableMedia, setReusableMedia] = useState<StudioReusableMedia[]>([]);
  const [candidates, setCandidates] = useState<StudioAssetPromotionCandidate[]>([]);
  const [curatedLtxCatalog, setCuratedLtxCatalog] = useState<CuratedLtxCatalogItem[]>([]);
  const [visualTreatmentCatalog, setVisualTreatmentCatalog] = useState<VisualTreatmentCatalogItem[]>([]);
  const [releaseFeedback, setReleaseFeedback] = useState<StudioAssetReleaseFeedback[]>([]);
  const [acceptedCharacterLoRAs, setAcceptedCharacterLoRAs] = useState<AcceptedCharacterLoRA[]>([]);
  const [musicVideoA2Vid, setMusicVideoA2Vid] = useState<MusicVideoA2VidReadiness | null>(null);
  const [directLtxRuntime, setDirectLtxRuntime] = useState<DirectLtxRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<StudioAssetImagePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [approvingCandidate, setApprovingCandidate] = useState<string | null>(null);
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
        candidates?: StudioAssetPromotionCandidate[];
        curatedLtxCatalog?: CuratedLtxCatalogItem[];
        visualTreatmentCatalog?: VisualTreatmentCatalogItem[];
        releaseFeedback?: StudioAssetReleaseFeedback[];
        acceptedCharacterLoRAs?: AcceptedCharacterLoRA[];
        musicVideoA2Vid?: MusicVideoA2VidReadiness;
        directLtxRuntime?: DirectLtxRuntimeStatus;
        error?: string;
      };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Could not load Studio assets");
      // All inventory collections are required by the real API. A partial or
      // malformed response is unavailable data, not a successfully empty room.
      if (![payload.assets, payload.reusableMedia, payload.candidates, payload.curatedLtxCatalog,
        payload.visualTreatmentCatalog, payload.releaseFeedback, payload.acceptedCharacterLoRAs].every(Array.isArray)) {
        throw new Error("The registry response is incomplete. Refresh to try again.");
      }
      if (controller.signal.aborted) return;
      setAssets(payload.assets ?? []);
      setReusableMedia(payload.reusableMedia ?? []);
      setCandidates(payload.candidates ?? []);
      setCuratedLtxCatalog(payload.curatedLtxCatalog ?? []);
      setVisualTreatmentCatalog(payload.visualTreatmentCatalog ?? []);
      setReleaseFeedback(payload.releaseFeedback ?? []);
      setAcceptedCharacterLoRAs(payload.acceptedCharacterLoRAs ?? []);
      setMusicVideoA2Vid(payload.musicVideoA2Vid ?? null);
      setDirectLtxRuntime(payload.directLtxRuntime ?? null);
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
  }, [refresh]);

  const summary = useMemo(() => ({
    approved: assets.filter((asset) => asset.status === "approved").length + reusableMedia.filter((asset) => asset.status === "approved").length,
    pending: candidates.length,
    reusable: assets.filter((asset) => asset.status === "approved" && asset.scope === "owned_studio" && asset.identitySensitivity === "portable").length,
  }), [assets, candidates, reusableMedia]);
  const feedbackByAsset = useMemo(
    () => new Map(releaseFeedback.map((feedback) => [feedback.assetEntryFingerprint, feedback])),
    [releaseFeedback],
  );
  const roomCounts: Record<AssetRoom, number> = {
    approved: assets.length + reusableMedia.length,
    decisions: candidates.length,
    identity: acceptedCharacterLoRAs.length,
    runtime: (directLtxRuntime ? 1 : 0) + (musicVideoA2Vid ? 1 : 0),
    catalog: curatedLtxCatalog.length + visualTreatmentCatalog.length,
  };
  const registryReady = loaded && !loading && !loadError;

  return (
    <div className={styles.page}>
      <AssetHero
        access="owner"
        summary={registryReady ? summary : null}
        loading={loading}
        onRefresh={() => { void refresh(); }}
      />

      {loading ? <p className={styles.loadStatus} role="status">Loading Studio asset registry…</p> : null}
      {loadError ? <div className={styles.error} role="alert"><strong>Inventory unavailable</strong><p>{loadError}</p></div> : null}
      {message ? <p className={styles.error} role="alert">{message}</p> : null}
      {previewError ? <p className={styles.error} role="alert">{previewError}</p> : null}
      {registryReady ? <>
      <AssetRoomTabs room={room} setRoom={setRoom} counts={roomCounts} />
      <AssetRoomIntro room={room} />

      {!loading && room === "runtime" && directLtxRuntime ? <section className={styles.runtimeBanner} aria-label="Direct LTX runtime readiness">
        <strong>Direct LTX runtime · {directLtxRuntime.status === "attested" ? "benchmark admitted" : "benchmark not admitted"}</strong>
        <p>
          {directLtxRuntime.status === "attested"
            ? `This owner has ${directLtxRuntime.benchmarkedProfileCount} sealed direct open-weight LTX 2.5 Novita profile${directLtxRuntime.benchmarkedProfileCount === 1 ? "" : "s"} on ${directLtxRuntime.gpuSku} (${directLtxRuntime.vramGb} GB). Every render still rechecks the exact pinned worker and release evidence.`
            : `No owner-scoped benchmark admission exists for the direct open-weight LTX 2.5 Novita worker (${directLtxRuntime.gpuSku}, ${directLtxRuntime.vramGb} GB). Catalog entries and standard LoRA candidates remain unavailable to render until an exact benchmark is reviewed and admitted.`}
        </p>
      </section> : null}

      {!loading && room === "approved" && !message && assets.length === 0 && reusableMedia.length === 0 ? (
        <div className={styles.empty}>
          <strong>No approved Studio assets yet.</strong>
          <span>Reviewed assets will appear here. Until then, pipelines create original material.</span>
        </div>
      ) : null}

      {!loading && room === "approved" && reusableMedia.length ? <section className={styles.catalog} aria-labelledby="studio-reusable-media-bank">
        <div className={styles.catalogHead}>
          <div>
            <span className={styles.kind}>Channel media bank</span>
            <h2 id="studio-reusable-media-bank">Release-proven clips</h2>
          </div>
          <p>40% maximum · every third episode original</p>
        </div>
        <div className={styles.grid}>
          {reusableMedia.map((asset) => <article className={styles.card} key={asset.fingerprint}>
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

      {!loading && room === "runtime" && musicVideoA2Vid ? <section className={styles.catalog} aria-labelledby="music-video-engine">
        <div className={styles.catalogHead}>
          <div>
            <span className={styles.kind}>Future render engine</span>
            <h2 id="music-video-engine">{musicVideoA2Vid.label}</h2>
          </div>
          <p>Build music segments from approved audio and stills.</p>
        </div>
        <article className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <span className={styles.kind}>open-weight · Novita</span>
              <h2>{musicVideoA2Vid.executionTarget}</h2>
            </div>
            <span className={musicVideoA2Vid.status === "benchmark_admitted" ? styles.approved : styles.muted}>
              {musicVideoA2Vid.status === "benchmark_admitted" ? "benchmark admitted" : "not installed"}
            </span>
          </div>
          <p className={styles.execution}>{musicVideoA2Vid.currentWorkerBoundary.reason}</p>
          <dl className={styles.meta}>
            <div><dt>Current boundary</dt><dd>{musicVideoA2Vid.currentWorkerBoundary.loader}</dd></div>
            <div><dt>Worker scope</dt><dd>Self-hosted only · no external LTX service</dd></div>
            {musicVideoA2Vid.activeBenchmark ? <>
              <div><dt>Benchmarked runtime</dt><dd title={musicVideoA2Vid.activeBenchmark.runtimeFingerprint}>{shortHash(musicVideoA2Vid.activeBenchmark.runtimeFingerprint)}</dd></div>
              <div><dt>Benchmark</dt><dd>{musicVideoA2Vid.activeBenchmark.gpuSku} · {musicVideoA2Vid.activeBenchmark.minimumVramGb} GB minimum</dd></div>
            </> : null}
          </dl>
          <div className={styles.tags} aria-label="Music-to-video admission requirements">
            {musicVideoA2Vid.requirements.map((requirement) => <span key={requirement}>{requirement}</span>)}
          </div>
          <p className={styles.feedback}>{musicVideoA2Vid.status === "benchmark_admitted"
            ? "A pinned runtime and matched benchmark are stored for reuse. Dispatch remains disabled until a clip supplies its exact mastered-music window, approved reference evidence, held budget, and final-master review."
            : "No render permission yet. Once benchmarked, every clip still binds its exact mastered-music window, approved reference evidence, held budget, and final-master review."}</p>
        </article>
      </section> : null}

      {!loading && room === "catalog" && curatedLtxCatalog.length ? <section className={styles.catalog} aria-labelledby="official-ltx-quality-catalog">
        <div className={styles.catalogHead}>
          <div>
            <span className={styles.kind}>Official LTX catalog</span>
            <h2 id="official-ltx-quality-catalog">Quality and control candidates</h2>
          </div>
          <p>Unavailable assets show their missing requirements.</p>
        </div>
        <div className={styles.grid}>
          {curatedLtxCatalog.map((candidate) => (
            <article className={styles.card} key={candidate.id}>
              <div className={styles.cardHead}>
                <div>
                  <span className={styles.kind}>{candidate.adapterClass === "ic_lora" ? "IC-LoRA control" : "standard LoRA"}</span>
                  <h2>{candidate.label}</h2>
                </div>
                <span className={styles.muted}>not installed</span>
              </div>
              <p className={styles.execution}>{curatedExecutionLabel(candidate)}</p>
              <dl className={styles.meta}>
                <div><dt>Base model</dt><dd>LTX {candidate.baseModelVersions.join(", ")}</dd></div>
                <div><dt>Use</dt><dd>{curatedQualityPhaseLabel(candidate.qualityPhase)}</dd></div>
                <div><dt>Must improve</dt><dd>{kindLabel(candidate.qualityMetric)}</dd></div>
                <div><dt>Gate</dt><dd>{curatedGateLabel(candidate)}</dd></div>
                {candidate.executionTarget ? <div><dt>Executor</dt><dd title={curatedExecutionTargetLabel(candidate.executionTarget)}>{curatedExecutionTargetLabel(candidate.executionTarget)}</dd></div> : null}
              </dl>
              <div className={styles.tags} aria-label="Candidate compatibility">
                {candidate.controls.map((value) => <span key={`control-${value}`}>{kindLabel(value)}</span>)}
                {candidate.supportedFamilies.map((value) => <span key={`family-${value}`}>{kindLabel(value)}</span>)}
              </div>
              {candidate.recommendedWorkflowProfiles.length ? <p className={styles.adapter}>
                Official workflow family: {candidate.recommendedWorkflowProfiles.map((profile) => `${profile.qualityRole} (${profile.workflowId})`).join(" · ")} · still requires a pinned local graph and benchmark
              </p> : null}
              <p className={styles.recipe}>{candidate.notes.join(" ")}</p>
              <a className={styles.source} href={candidate.sourceUrl} target="_blank" rel="noreferrer">Official model card</a>
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
        <div className={styles.grid}>
          {visualTreatmentCatalog.map((treatment) => (
            <article className={styles.card} key={treatment.key}>
              <div className={styles.cardHead}>
                <div>
                  <span className={styles.kind}>Planning + QA only</span>
                  <h2>{treatment.label}</h2>
                </div>
                <span className={styles.muted}>no renderer admitted</span>
              </div>
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
            </article>
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
