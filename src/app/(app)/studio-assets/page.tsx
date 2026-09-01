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
  runtime,
  loading,
  onRefresh,
}: {
  access: ReturnType<typeof useOperationsAccess>;
  summary: { approved: number; pending: number; reusable: number; ltx: number; control: number };
  runtime: DirectLtxRuntimeStatus | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className={styles.hero} aria-busy={access === "checking" || (access === "owner" && loading) || undefined}>
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>Studio assets / reuse registry</p>
        <h1>Reuse what has earned the right.</h1>
        <p>
          Every recipe, image, adapter, and control stays bound to its review,
          scope, and runtime proof. Similar-looking is never the same as compatible.
        </p>
        <div className={styles.heroActions}>
          <button type="button" className={styles.refresh} disabled={loading || access !== "owner"} onClick={onRefresh}>{access !== "owner" ? access === "checking" ? "Checking access…" : "Registry locked" : loading ? "Reading registry…" : "Refresh registry"}</button>
          <span>Metadata by default · previews only on owner request</span>
        </div>
      </div>
      <div className={styles.registryMap}>
        <div className={styles.registryHeader}><span>Reuse admission</span><small>scope × evidence × runtime</small></div>
        <div className={styles.orbitField}>
          <div className={styles.orbitCore} data-state={summary.approved ? "ready" : "empty"}><span>APPROVED</span><strong>{String(summary.approved).padStart(2, "0")}</strong><small>registry entries</small></div>
          <RegistryNode className={styles.nodeQuality} index="01" label="Quality" value={summary.approved ? "Reviewed" : "Waiting"} />
          <RegistryNode className={styles.nodeScope} index="02" label="Scope" value={summary.reusable ? `${summary.reusable} portable` : "Bound"} />
          <RegistryNode className={styles.nodeRuntime} index="03" label="Runtime" value={runtime?.status === "attested" ? "Attested" : "Unattested"} />
          <i className={styles.orbitA} aria-hidden="true" /><i className={styles.orbitB} aria-hidden="true" /><i className={styles.orbitC} aria-hidden="true" />
        </div>
      </div>
      <div className={styles.metricRail}>
        <AssetMetric index="01" label="Approved" value={String(summary.approved).padStart(2, "0")} detail="evidence-backed" />
        <AssetMetric index="02" label="Decisions" value={String(summary.pending).padStart(2, "0")} detail="owner review" />
        <AssetMetric index="03" label="Portable" value={String(summary.reusable).padStart(2, "0")} detail="Studio-wide" />
        <AssetMetric index="04" label="LTX candidates" value={String(summary.ltx + summary.control).padStart(2, "0")} detail={`${summary.control} IC controls`} />
        <AssetMetric index="05" label="Authority" value={access === "owner" ? "Open" : access === "checking" ? "Checking" : "Locked"} detail="signed session" />
      </div>
    </section>
  );
}

function RegistryNode({ className, index, label, value }: { className: string; index: string; label: string; value: string }) {
  return <div className={`${styles.registryNode} ${className}`}><span>{index}</span><div><small>{label}</small><strong>{value}</strong></div><i /></div>;
}

function AssetMetric({ index, label, value, detail }: { index: string; label: string; value: string; detail: string }) {
  return <div className={styles.metric}><span>{index} / {label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function LockedAssetRegistry({ access }: { access: Exclude<ReturnType<typeof useOperationsAccess>, "owner"> }) {
  return (
    <section className={styles.lockedRegistry} aria-live={access === "checking" ? "polite" : undefined}>
      <div className={styles.registrySeal} aria-hidden="true"><span>ASSET</span><i /><b /></div>
      <div className={styles.lockedCopy}>
        <p className={styles.eyebrow}>{access === "checking" ? "Resolving signed session" : "Reuse registry protected"}</p>
        <h2>{access === "checking" ? "Checking registry authority…" : "The asset registry is closed."}</h2>
        <p>{access === "checking" ? "The studio is checking this browser before reading any owner-scoped asset evidence." : "Open owner operations from the top bar to inspect approvals, adapters, and short-lived previews. No private asset request was sent."}</p>
      </div>
      <div className={styles.lockedRules}>
        <div><span>01</span><strong>Identity does not travel</strong><p>Channel and series material stays inside its sealed compatibility boundary.</p></div>
        <div><span>02</span><strong>Catalog is not runtime</strong><p>A model card never becomes installed weights or render permission.</p></div>
        <div><span>03</span><strong>Preview is deliberate</strong><p>Approved images receive a short-lived URL only after an owner click.</p></div>
      </div>
    </section>
  );
}

function AssetRoomTabs({ room, setRoom, counts }: { room: AssetRoom; setRoom: (room: AssetRoom) => void; counts: Record<AssetRoom, number> }) {
  const rooms: { id: AssetRoom; label: string; detail: string }[] = [
    { id: "approved", label: "Approved", detail: "Reusable inventory" },
    { id: "decisions", label: "Decisions", detail: "Owner approvals" },
    { id: "identity", label: "Identity", detail: "Series characters" },
    { id: "runtime", label: "Runtime", detail: "Worker readiness" },
    { id: "catalog", label: "Catalog", detail: "Quality candidates" },
  ];
  return (
    <nav className={styles.roomTabs} aria-label="Studio asset rooms" role="tablist">
      {rooms.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={room === item.id} className={room === item.id ? styles.roomTabActive : ""} onClick={() => setRoom(item.id)}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div><b>{counts[item.id]}</b></button>)}
    </nav>
  );
}

function AssetRoomIntro({ room }: { room: AssetRoom }) {
  const copy: Record<AssetRoom, { eyebrow: string; title: string; detail: string }> = {
    approved: { eyebrow: "Reusable inventory", title: "Approved visual language", detail: "Evidence-backed recipes and source assets that earned a specific compatibility boundary." },
    decisions: { eyebrow: "Owner decision", title: "Candidates awaiting a deliberate answer", detail: "Approval rechecks the retained final-master certificate and remains restricted to its source channel." },
    identity: { eyebrow: "Series identity", title: "Characters allowed to remain themselves", detail: "Accepted adapters can return only for the same sealed specification, dataset, runtime, and review path." },
    runtime: { eyebrow: "Execution boundary", title: "Workers with measured readiness", detail: "Runtime evidence proves only its benchmarked path; it does not authorize dispatch, spend, or release." },
    catalog: { eyebrow: "Descriptor catalog", title: "Candidates, controls, and treatment plans", detail: "Catalog entries describe a possible improvement. They are not installed weights and never imply render admission." },
  };
  const selected = copy[room];
  return <header className={styles.roomHeader}><div><span className={styles.kind}>{selected.eyebrow}</span><h2>{selected.title}</h2></div><p>{selected.detail}</p></header>;
}

export default function StudioAssetsPage() {
  const operationsAccess = useOperationsAccess();
  const [room, setRoom] = useState<AssetRoom>("approved");
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [candidates, setCandidates] = useState<StudioAssetPromotionCandidate[]>([]);
  const [curatedLtxCatalog, setCuratedLtxCatalog] = useState<CuratedLtxCatalogItem[]>([]);
  const [visualTreatmentCatalog, setVisualTreatmentCatalog] = useState<VisualTreatmentCatalogItem[]>([]);
  const [releaseFeedback, setReleaseFeedback] = useState<StudioAssetReleaseFeedback[]>([]);
  const [acceptedCharacterLoRAs, setAcceptedCharacterLoRAs] = useState<AcceptedCharacterLoRA[]>([]);
  const [musicVideoA2Vid, setMusicVideoA2Vid] = useState<MusicVideoA2VidReadiness | null>(null);
  const [directLtxRuntime, setDirectLtxRuntime] = useState<DirectLtxRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<StudioAssetImagePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [approvingCandidate, setApprovingCandidate] = useState<string | null>(null);
  const previewOriginRef = useRef<HTMLElement | null>(null);
  const previewCloseRef = useRef<HTMLButtonElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/studio-assets", { cache: "no-store" });
      const payload = await response.json() as {
        ok?: boolean;
        assets?: StudioAsset[];
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
      setAssets(payload.assets ?? []);
      setCandidates(payload.candidates ?? []);
      setCuratedLtxCatalog(payload.curatedLtxCatalog ?? []);
      setVisualTreatmentCatalog(payload.visualTreatmentCatalog ?? []);
      setReleaseFeedback(payload.releaseFeedback ?? []);
      setAcceptedCharacterLoRAs(payload.acceptedCharacterLoRAs ?? []);
      setMusicVideoA2Vid(payload.musicVideoA2Vid ?? null);
      setDirectLtxRuntime(payload.directLtxRuntime ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Studio assets");
    } finally {
      setLoading(false);
    }
  }, []);

  const approveCandidate = useCallback(async (candidateFingerprint: string) => {
    if (approvingCandidate) return;
    setApprovingCandidate(candidateFingerprint);
    setMessage(null);
    try {
      const response = await fetch("/api/studio-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve-candidate", candidateFingerprint }),
      });
      const payload = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not approve Studio asset candidate");
      }
      await refresh();
      setMessage("Candidate approved for its source channel. It can now be reused only where its sealed compatibility matches.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not approve Studio asset candidate");
    } finally {
      setApprovingCandidate(null);
    }
  }, [approvingCandidate, refresh]);

  const openImagePreview = useCallback(async (asset: StudioAsset, origin: HTMLElement) => {
    if (!asset.resource?.contentType.startsWith("image/") || previewLoading) return;
    previewOriginRef.current = origin;
    setPreviewLoading(asset.fingerprint);
    setPreviewError(null);
    try {
      const response = await fetch(`/api/studio-assets?preview=${encodeURIComponent(asset.fingerprint)}`, {
        cache: "no-store",
      });
      const payload = await response.json() as {
        ok?: boolean;
        preview?: { url?: unknown; contentType?: unknown; contentSha256?: unknown };
        error?: string;
      };
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
      setPreviewError(error instanceof Error ? error.message : "Approved image preview is unavailable");
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
    if (operationsAccess !== "owner") return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [operationsAccess, refresh]);

  const summary = useMemo(() => ({
    approved: assets.filter((asset) => asset.status === "approved").length,
    pending: candidates.length,
    reusable: assets.filter((asset) => asset.scope === "owned_studio").length,
    ltx: curatedLtxCatalog.filter((candidate) => candidate.adapterClass === "standard_lora").length,
    control: curatedLtxCatalog.filter((candidate) => candidate.adapterClass === "ic_lora").length,
  }), [assets, candidates, curatedLtxCatalog]);
  const feedbackByAsset = useMemo(
    () => new Map(releaseFeedback.map((feedback) => [feedback.assetEntryFingerprint, feedback])),
    [releaseFeedback],
  );
  const roomCounts: Record<AssetRoom, number> = {
    approved: assets.length,
    decisions: candidates.length,
    identity: acceptedCharacterLoRAs.length,
    runtime: (directLtxRuntime ? 1 : 0) + (musicVideoA2Vid ? 1 : 0),
    catalog: curatedLtxCatalog.length + visualTreatmentCatalog.length,
  };

  return (
    <div className={styles.page}>
      <AssetHero
        access={operationsAccess}
        summary={summary}
        runtime={directLtxRuntime}
        loading={loading}
        onRefresh={() => { void refresh(); }}
      />

      {operationsAccess !== "owner" ? (
        <LockedAssetRegistry access={operationsAccess} />
      ) : (<>

      <section className={styles.boundaryStrip}>
        <span className={styles.kind}>Read-only evidence inventory</span>
        <strong>Metadata first. Reuse only after exact compatibility.</strong>
        <p>This is our own Studio library, not an external LTX service. The inventory is read-only except for an owner’s deliberate approval of a certificate-backed, channel-only candidate; it never uploads, downloads models, trains, renders, or publishes.</p>
        <small>It never shows storage locations, model bytes, or persistent signed URLs; an owner may explicitly open one short-lived preview for an approved image. Official catalog entries are not installed weights or render permission; an assembly consumer is not admitted until render-parity is proven.</small>
      </section>

      {!loading && room === "runtime" && directLtxRuntime ? <section className={styles.runtimeBanner} aria-label="Direct LTX runtime readiness">
        <strong>Direct LTX runtime · {directLtxRuntime.status === "attested" ? "benchmark admitted" : "benchmark not admitted"}</strong>
        <p>
          {directLtxRuntime.status === "attested"
            ? `This owner has ${directLtxRuntime.benchmarkedProfileCount} sealed direct open-weight LTX 2.5 Novita profile${directLtxRuntime.benchmarkedProfileCount === 1 ? "" : "s"} on ${directLtxRuntime.gpuSku} (${directLtxRuntime.vramGb} GB). Every render still rechecks the exact pinned worker and release evidence.`
            : `No owner-scoped benchmark admission exists for the direct open-weight LTX 2.5 Novita worker (${directLtxRuntime.gpuSku}, ${directLtxRuntime.vramGb} GB). Catalog entries and standard LoRA candidates remain unavailable to render until an exact benchmark is reviewed and admitted.`}
        </p>
      </section> : null}

      {message ? <p className={styles.error} role="alert">{message}</p> : null}
      {previewError ? <p className={styles.error} role="alert">{previewError}</p> : null}
      <AssetRoomTabs room={room} setRoom={setRoom} counts={roomCounts} />
      <AssetRoomIntro room={room} />

      {loading ? <div className={styles.empty}>Loading Studio asset registry…</div> : null}
      {!loading && room === "approved" && !message && assets.length === 0 ? (
        <div className={styles.empty}>
          <strong>No approved Studio assets yet.</strong>
          <span>Assets appear here only after an evidence-backed promotion. A missing asset tells the pipeline to create a new reviewed candidate; it never borrows another channel’s material.</span>
        </div>
      ) : null}

      {!loading && room === "decisions" && candidates.length ? <section className={styles.catalog} aria-labelledby="studio-asset-candidate-approvals">
        <div className={styles.catalogHead}>
          <div>
            <span className={styles.kind}>Owner decision required</span>
            <h2 id="studio-asset-candidate-approvals">Reviewed candidates awaiting approval</h2>
          </div>
          <p>Each candidate came from a passing final master without reusing an existing Studio recipe. Approval rechecks its retained release evidence and keeps the result restricted to the same channel. Nothing becomes Studio-wide automatically.</p>
        </div>
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

      {!loading && room === "approved" && assets.length ? <section className={styles.grid} aria-label="Approved Studio assets">
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
            {asset.resource?.contentType.startsWith("image/") ? <button
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

      {!loading && room === "identity" && acceptedCharacterLoRAs.length ? <section className={styles.catalog} aria-labelledby="series-character-adapter-registry">
        <div className={styles.catalogHead}>
          <div>
            <span className={styles.kind}>Series identity registry</span>
            <h2 id="series-character-adapter-registry">Persistent character adapters</h2>
          </div>
          <p>Accepted identity adapters are reused only for the same sealed character specification. This view deliberately exposes evidence metadata, never adapter paths, bytes, datasets, or a render permission.</p>
        </div>
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
          <p>Designed for sealed music segments with optional approved opening and ending images. It is separate from the existing visual-loop worker, so it cannot silently reuse a text-to-video path.</p>
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
          <p>Cataloged for the Studio, but unavailable until the exact evidence path shown on each card is complete. IC controls additionally require a sealed workflow and input guide, and use a dedicated Novita RTX 5090 with at least 32 GB VRAM.</p>
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
          <p>These profiles now bind the cinematic Visual Matter plan, continuity locks, and visual review. They are not installed models or a renderer admission.</p>
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
        <span>The registry preserves this as an empty evidence state; it does not infer an approval, adapter, runtime, or catalog entry.</span>
      </div> : null}

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
      </>)}
    </div>
  );
}
