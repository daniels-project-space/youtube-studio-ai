"use client";

import {
  Suspense,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { useOwnerId } from "@/lib/owner-context";
import { useSelectedChannel } from "@/lib/channel-context";
import type { ChannelRow } from "@/lib/types";
import { EmptyState } from "@/components/EmptyState";
import { SkeletonList } from "@/components/Skeleton";
import { compact } from "@/components/Chart";
import { IconSeo, IconSpark, IconExternal } from "@/components/icons";
import styles from "./seo.module.css";

/** A channel row enriched with its identity.niche (from listChannels). */
type ChannelWithNiche = ChannelRow & { niche: string | null };

type SeoSection = "brief" | "signals" | "strategy";

export type SeoWorkspaceProps = {
  channelSlug?: string | null;
  embedded?: boolean;
  initialSection?: SeoSection;
};

const SEO_SECTIONS: { id: SeoSection; label: string; description: string }[] = [
  {
    id: "brief",
    label: "Next upload",
    description: "Actionable brief and estimate",
  },
  {
    id: "signals",
    label: "Search signals",
    description: "Titles, tags, and thumbnails",
  },
  {
    id: "strategy",
    label: "Market map",
    description: "Gaps, hooks, and competitors",
  },
];

function validSection(value: string | null): SeoSection {
  return value === "signals" || value === "strategy" ? value : "brief";
}

export default function SeoPage() {
  return (
    <Suspense fallback={<SkeletonList rows={4} />}>
      <SeoRoute />
    </Suspense>
  );
}

function SeoRoute() {
  const searchParams = useSearchParams();
  const channelSlug = searchParams.get("channel");
  const section = validSection(searchParams.get("section"));
  return (
    <SeoWorkspace
      key={`${channelSlug ?? "selected"}:${section}`}
      channelSlug={channelSlug}
      initialSection={section}
    />
  );
}

export function SeoWorkspace({
  channelSlug,
  embedded = false,
  initialSection = "brief",
}: SeoWorkspaceProps) {
  const ownerId = useOwnerId();
  const { selectedSlug } = useSelectedChannel();
  const effectiveSlug = channelSlug ?? selectedSlug;
  const [activeSection, setActiveSection] =
    useState<SeoSection>(initialSection);

  const handleSectionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentSection: SeoSection,
  ) => {
    const currentIndex = SEO_SECTIONS.findIndex(
      (section) => section.id === currentSection,
    );
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % SEO_SECTIONS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + SEO_SECTIONS.length) % SEO_SECTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = SEO_SECTIONS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextSection = SEO_SECTIONS[nextIndex].id;
    setActiveSection(nextSection);
    document.getElementById(`seo-tab-${nextSection}`)?.focus();
  };

  // listChannels carries identity.niche — we read it for the niche selector.
  const channels = useQuery(api.channels.listChannels, { ownerId }) as
    | (ChannelRow & { identity?: { niche?: string } })[]
    | undefined;

  const channelNiches = useMemo<ChannelWithNiche[]>(
    () =>
      (channels ?? []).map((c) => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        status: c.status,
        template: c.template,
        budget: c.budget,
        niche: c.identity?.niche ?? null,
      })),
    [channels],
  );

  // Niche resolution: selected channel's niche wins; else a manual selector.
  const selectedChannel = channelNiches.find((c) => c.slug === effectiveSlug);
  const channelNiche = selectedChannel?.niche ?? null;
  const [manualSelection, setManualSelection] = useState<{
    selectedSlug: string | null;
    niche: string;
  } | null>(null);
  const manualNiche =
    !selectedChannel && manualSelection?.selectedSlug === effectiveSlug
      ? manualSelection.niche
      : null;
  const setManualNiche = (niche: string) => {
    setManualSelection({ selectedSlug: effectiveSlug, niche });
  };
  const niche = channelNiche ?? manualNiche;

  // Distinct niches across channels, for the fallback selector.
  const availableNiches = useMemo(
    () =>
      [
        ...new Set(channelNiches.map((c) => c.niche).filter(Boolean)),
      ] as string[],
    [channelNiches],
  );

  const intel = useQuery(api.seo.getNiche, niche ? { ownerId, niche } : "skip");
  const databank = useQuery(
    api.seo.getDatabank,
    niche ? { ownerId, niche } : "skip",
  );
  const competitors = useQuery(
    api.competitors.listCompetitors,
    niche ? { ownerId, niche } : "skip",
  );

  const loadingChannels = channels === undefined;
  const requestedChannelMissing = Boolean(
    channelSlug && channels !== undefined && !selectedChannel,
  );

  return (
    <>
      {embedded ? (
        <header className={styles.embeddedHeader}>
          <div>
            <span>SEO intelligence</span>
            <h2>{selectedChannel?.name ?? "Channel intelligence"}</h2>
          </div>
          {niche ? (
            <ResearchButton niche={niche} channelId={channelNiche ? selectedChannel?._id : undefined} />
          ) : null}
        </header>
      ) : (
        <PackagingHero
          selectedChannel={selectedChannel}
          niche={niche}
          niches={availableNiches}
          intel={intel}
          databank={databank}
          competitors={competitors}
          onSelectNiche={selectedChannel ? undefined : setManualNiche}
        />
      )}

      {loadingChannels ? (
        <SkeletonList rows={4} />
      ) : requestedChannelMissing ? (
        <EmptyState
          title="Channel not found"
          description={`The channel “${channelSlug}” is not available in this workspace.`}
          icon={<IconSeo width={24} height={24} />}
        />
      ) : !niche ? (
        selectedChannel ? (
          <EmptyState
            title="No niche set"
            description={`Set ${selectedChannel.name}'s niche in its Identity tab before running channel-specific research.`}
            icon={<IconSeo width={24} height={24} />}
          />
        ) : (
          <NicheSelector
            niches={availableNiches}
            onSelect={setManualNiche}
            hasChannel={false}
          />
        )
      ) : (
        <div className={`seo-workspace ${styles.workspace}`}>
          {!channelNiche && (
            <NicheSelector
              niches={availableNiches}
              onSelect={setManualNiche}
              hasChannel={false}
              current={niche}
              compactMode
            />
          )}

          {intel === undefined && databank === undefined ? (
            <SkeletonList rows={4} />
          ) : !intel && !databank ? (
            <EmptyState
              title="No niche data yet"
              description={`No intelligence mined for "${niche}" yet. Click "Research now" to mine top competitor videos, title/tag signals, and a strategy databank (requires the intelligence engine to be activated).`}
              icon={<IconSeo width={24} height={24} />}
            />
          ) : (
            <>
              <nav
                className={styles.sectionTabs}
                aria-label="SEO intelligence sections"
                role="tablist"
              >
                {SEO_SECTIONS.map((section) => (
                  <button
                    key={section.id}
                    id={`seo-tab-${section.id}`}
                    type="button"
                    role="tab"
                    aria-selected={activeSection === section.id}
                    aria-controls={`seo-panel-${section.id}`}
                    tabIndex={activeSection === section.id ? 0 : -1}
                    className={`${styles.sectionTab} ${activeSection === section.id ? styles.sectionTabActive : ""}`}
                    onClick={() => setActiveSection(section.id)}
                    onKeyDown={(event) =>
                      handleSectionKeyDown(event, section.id)
                    }
                  >
                    <strong>{section.label}</strong>
                    <span>{section.description}</span>
                  </button>
                ))}
              </nav>

              <div
                id={`seo-panel-${activeSection}`}
                className={styles.sectionPane}
                role="tabpanel"
                aria-labelledby={`seo-tab-${activeSection}`}
              >
                {activeSection === "brief" && (
                  <>
                    <ResearchEvidenceLedger
                      intel={intel}
                      databank={databank}
                      competitors={competitors}
                    />
                    <SeoFocus
                      niche={niche}
                      channelName={channelNiche ? selectedChannel?.name : undefined}
                      intel={intel}
                      databank={databank}
                      competitors={competitors}
                    />
                    <ViewEstimateWidget ownerId={ownerId} niche={niche} />
                  </>
                )}

                {activeSection === "signals" &&
                  (intel ? (
                    <NicheIntelligence intel={intel} />
                  ) : (
                    <EmptyState
                      title="No search signals yet"
                      description="Run research to collect title, tag, and thumbnail evidence for this niche."
                      icon={<IconSeo width={24} height={24} />}
                    />
                  ))}

                {activeSection === "strategy" && (
                  <>
                    {databank ? (
                      <SeoDatabank databank={databank} />
                    ) : (
                      <EmptyState
                        title="No strategy databank yet"
                        description="Run research to identify reusable hooks and open competitor gaps."
                        icon={<IconSeo width={24} height={24} />}
                      />
                    )}
                    <CompetitorTopVideos competitors={competitors} />
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function PackagingHero({
  selectedChannel,
  niche,
  niches,
  intel,
  databank,
  competitors,
  onSelectNiche,
}: {
  selectedChannel: ChannelWithNiche | undefined;
  niche: string | null;
  niches: string[];
  intel: SeoIntel | null | undefined;
  databank: SeoDatabankRow | null | undefined;
  competitors: CompetitorRow[] | undefined;
  onSelectNiche?: (niche: string) => void;
}) {
  const competitorVideos = competitors?.reduce(
    (sum, competitor) => sum + competitor.topVideos.length,
    0,
  ) ?? 0;
  const guide = intel?.thumbnailStyleGuide;
  const visualMeasured = Boolean(
    guide &&
    guide.visualEvidenceStatus !== "metadata_only" &&
    guide.evidenceSource !== "youtube_data_api_v3_metadata" &&
    typeof guide.hasTextOverlayPct === "number",
  );

  return (
    <section className={styles.packagingHero}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>Packaging lab / {selectedChannel?.name ?? niche ?? "fleet"}</span>
        <h1>Find the angle before you write the title.</h1>
        <p>
          Turn stored search language and competitor metadata into a next-upload brief.
          Pixel-level thumbnail claims stay unavailable until visual evidence actually exists.
        </p>
        <div className={styles.heroHandoff} data-ready={Boolean(niche) || undefined}>
          <span aria-hidden="true"><i /></span>
          <div>
            <small>{niche ? "Territory in focus" : "Choose a research territory"}</small>
            <strong>{niche ?? "No niche is bound to the packaging desk"}</strong>
            <em>
              {selectedChannel
                ? `${selectedChannel.name} · channel identity binding`
                : niche
                  ? "Fleet research view · no channel identity is being changed"
                  : "Select a stored territory below to inspect its evidence."}
            </em>
          </div>
          {niche ? (
            <ResearchButton niche={niche} channelId={selectedChannel?.niche ? selectedChannel._id : undefined} />
          ) : null}
        </div>
      </div>

      <figure className={styles.territoryMap}>
        <figcaption>
          <span>Territory map</span>
          <small>{niches.length} identity-bound niches</small>
        </figcaption>
        <div className={styles.territoryField}>
          <span className={styles.territoryOrbit} aria-hidden="true" />
          <span className={styles.territoryAxis} aria-hidden="true" />
          {niches.slice(0, 8).map((item, index) => (
            <button
              type="button"
              key={item}
              data-index={index}
              data-active={item === niche || undefined}
              className={styles.territoryNode}
              onClick={() => onSelectNiche?.(item)}
              disabled={!onSelectNiche && item !== niche}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{item}</strong>
            </button>
          ))}
          {!niches.length && <span className={styles.territoryEmpty}>No channel territories configured</span>}
          <div className={styles.territoryCore}>
            <small>PACKAGING</small>
            <strong>{niche ? "FOCUS" : "MAP"}</strong>
            <span>{niche ? "bound" : "waiting"}</span>
          </div>
        </div>
        <div className={styles.mapLegend}>
          <span><i /> Stored channel identity</span>
          <span>Selection does not mutate channel identity</span>
        </div>
      </figure>

      <div className={styles.packagingMetrics}>
        <PackagingMetric index="01" label="Search record" value={!niche ? "Waiting" : intel === undefined ? "Reading" : intel ? "Stored" : "Absent"} detail={!niche ? "Select a territory" : intel ? `${intel.topTags.length} tags · ${intel.topTitlePatterns.length} patterns` : "No persisted signals"} />
        <PackagingMetric index="02" label="Strategy record" value={!niche ? "Waiting" : databank === undefined ? "Reading" : databank ? "Stored" : "Absent"} detail={!niche ? "Select a territory" : databank ? `${databank.titleTemplates.length} title routes` : "No persisted databank"} />
        <PackagingMetric index="03" label="Competitor sample" value={!niche ? "Waiting" : competitors === undefined ? "Reading" : `${competitorVideos} videos`} detail={!niche ? "Select a territory" : competitors ? `${competitors.length} channels` : "No persisted sample"} />
        <PackagingMetric index="04" label="Thumbnail pixels" value={visualMeasured ? "Measured" : "Unavailable"} detail={visualMeasured ? "Visual attributes stored" : "Metadata is not pixel evidence"} tone={visualMeasured ? "ok" : "warn"} />
      </div>
    </section>
  );
}

function PackagingMetric({
  index,
  label,
  value,
  detail,
  tone,
}: {
  index: string;
  label: string;
  value: string;
  detail: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className={styles.packagingMetric} data-tone={tone}>
      <span>{index}</span>
      <div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div>
    </div>
  );
}

type SeoIntel = {
  optimalTitleLen: number;
  topTags: unknown[];
  topTitlePatterns: unknown[];
  powerWords: unknown[];
  avgViewsTop50: number;
  medianViewsTop50: number;
  thumbnailStyleGuide: {
    dominantColors: string[];
    hasTextOverlayPct: number | null;
    notes: string;
    evidenceSource?: "youtube_data_api_v3_metadata";
    visualEvidenceStatus?: "metadata_only";
    sampledVideoCount?: number;
  };
};

type SeoDatabankRow = {
  titleTemplates: string[];
  hookPatterns: string[];
  competitorGaps: string[];
  sourceAttribution?: {
    provider: "youtube_data_api_v3";
    topPerformersAnalysed: number;
    limitations: string[];
  };
};

type SeoEvidenceRow = {
  label: string;
  state: string;
  detail: string;
  measured?: boolean;
};

/**
 * A compact ledger of the exact persisted research that may support the
 * upload brief. It purposefully shows absences and metadata-only coverage
 * instead of turning partial research into a readiness score.
 */
function ResearchEvidenceLedger({
  intel,
  databank,
  competitors,
}: {
  intel: SeoIntel | null | undefined;
  databank: SeoDatabankRow | null | undefined;
  competitors: CompetitorRow[] | undefined;
}) {
  const competitorVideos = competitors?.reduce(
    (total, competitor) => total + competitor.topVideos.length,
    0,
  );
  const guide = intel?.thumbnailStyleGuide;
  const metadataOnly =
    guide?.visualEvidenceStatus === "metadata_only" ||
    guide?.evidenceSource === "youtube_data_api_v3_metadata" ||
    guide?.notes.toLowerCase().startsWith("minimal guide");
  const visualState =
    intel === undefined
      ? "Loading record"
      : !guide
        ? "No record"
        : metadataOnly
          ? "Metadata only"
          : typeof guide.hasTextOverlayPct === "number"
            ? "Measured"
            : "Not measured";
  const rows: SeoEvidenceRow[] = [
    {
      label: "Search signals",
      state: intel === undefined ? "Loading record" : intel ? "Stored" : "No record",
      detail: intel
        ? `${intel.topTags.length} tags and ${intel.topTitlePatterns.length} title patterns are stored.`
        : "No persisted title, tag, or title-length evidence is available.",
      measured: Boolean(intel),
    },
    {
      label: "Strategy databank",
      state:
        databank === undefined
          ? "Loading record"
          : databank
            ? "Stored"
            : "No record",
      detail: databank?.sourceAttribution
        ? `${databank.sourceAttribution.topPerformersAnalysed} top performers are attributed in the stored record.`
        : databank
          ? "A strategy record exists without a stored source-attribution count."
          : "No persisted title-template, hook, or gap record is available.",
      measured: Boolean(databank),
    },
    {
      label: "Competitor sample",
      state:
        competitors === undefined
          ? "Loading record"
          : competitorVideos
            ? `${competitorVideos} videos`
            : "No videos stored",
      detail:
        competitors === undefined
          ? "Loading the persisted competitor sample."
          : `${competitors.length} competitor channel${competitors.length === 1 ? "" : "s"} in the stored sample.`,
      measured: competitorVideos !== undefined && competitorVideos > 0,
    },
    {
      label: "Thumbnail evidence",
      state: visualState,
      detail:
        guide && typeof guide.sampledVideoCount === "number"
          ? `${guide.sampledVideoCount} sampled video${guide.sampledVideoCount === 1 ? "" : "s"}; ${metadataOnly ? "pixels and overlay text were not measured" : "stored guide available"}.`
          : metadataOnly
            ? "The stored guide is metadata-only; thumbnail pixels and overlay text were not measured."
            : visualState === "Measured" && typeof guide?.hasTextOverlayPct === "number"
              ? `Stored visual guide reports text overlay in ${guide.hasTextOverlayPct}% of the sample; the sample count is not persisted.`
              : "No stored visual measurement is available.",
      measured: visualState === "Measured",
    },
  ];

  return (
    <section className={styles.evidenceLedger} aria-label="Stored SEO research evidence">
      <div className={styles.evidenceLedgerHeader}>
        <small>Research evidence ledger</small>
        <h2>What this upload brief is grounded in</h2>
        <p>Only persisted research is represented here. Metadata-only collection remains visibly limited rather than being presented as visual or audience evidence.</p>
      </div>
      <div className={styles.evidenceRows}>
        {rows.map((row) => (
          <div key={row.label} className={`${styles.evidenceRow} ${row.measured ? styles.evidenceRowMeasured : ""}`}>
            <small>{row.label}</small>
            <strong>{row.state}</strong>
            <span>{row.detail}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SeoFocus({
  niche,
  channelName,
  intel,
  databank,
  competitors,
}: {
  niche: string;
  channelName?: string;
  intel: SeoIntel | null | undefined;
  databank: SeoDatabankRow | null | undefined;
  competitors: CompetitorRow[] | undefined;
}) {
  const titlePattern = intel
    ? labeled(intel.topTitlePatterns, "pattern")[0]
    : undefined;
  const opportunity = databank?.competitorGaps[0];
  const sourceVideos =
    competitors?.reduce(
      (total, competitor) => total + competitor.topVideos.length,
      0,
    ) ?? 0;
  const metadataOnly =
    intel?.thumbnailStyleGuide.visualEvidenceStatus === "metadata_only" ||
    intel?.thumbnailStyleGuide.evidenceSource === "youtube_data_api_v3_metadata" ||
    intel?.thumbnailStyleGuide.notes.toLowerCase().startsWith("minimal guide");
  const thumbnailSignal =
    !intel
      ? "Research needed"
      : metadataOnly || typeof intel.thumbnailStyleGuide.hasTextOverlayPct !== "number"
        ? "Visual evidence unavailable"
        : `${intel.thumbnailStyleGuide.hasTextOverlayPct}% use text`;

  return (
    <section className={styles.focus}>
      <div className={styles.focusHeader}>
        <span>
          <small>Use next</small>
          <h2>Focus for the next upload</h2>
        </span>
        <span>
          {channelName ?? "All channels"} · {niche}
        </span>
      </div>
      <div className={styles.focusGrid}>
        <div>
          <small>Title target</small>
          <strong>
            {intel ? `${intel.optimalTitleLen} characters` : "Research needed"}
          </strong>
          <span>
            {titlePattern ??
              "Run research to learn the winning title structure."}
          </span>
        </div>
        <div>
          <small>Content opportunity</small>
          <strong>{opportunity ? "Gap identified" : "No gap recorded"}</strong>
          <span>
            {opportunity ??
              "The strategy databank has no open competitor gap yet."}
          </span>
        </div>
        <div>
          <small>Thumbnail signal</small>
          <strong>{thumbnailSignal}</strong>
          <span>
            {metadataOnly
              ? "Metadata was collected, but thumbnail pixels and overlay text were not measured."
              : sourceVideos > 0
              ? `Grounded in ${sourceVideos} stored competitor videos.`
              : "No competitor video sample is stored for this niche yet."}
          </span>
        </div>
      </div>
    </section>
  );
}

// ----------------------------- Research now -----------------------------

function ResearchButton({
  niche,
  channelId,
}: {
  niche: string;
  channelId?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">(
    "idle",
  );
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setState("loading");
    setMsg(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche, channelId }),
      });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setState("error");
        setMsg(
          data.error ??
            "Research could not be started. The intelligence engine may not be activated yet.",
        );
        return;
      }
      setState("ok");
      setMsg("Research queued — results will appear once it completes.");
    } catch {
      setState("error");
      setMsg("Network error — research could not be started.");
    }
  }

  return (
    <div className={styles.researchActionWrap} data-state={state}>
      <button
        type="button"
        onClick={run}
        disabled={state === "loading"}
        className={styles.researchAction}
        title="Mines this niche via the competitor-intelligence engine. Requires the intelligence engine (Trigger.dev + YouTube Data API key) to be activated."
      >
        <IconSpark width={16} height={16} />
        {state === "loading" ? "Starting…" : "Research now"}
      </button>
      {msg && (
        <span className={styles.researchStatus}>
          {msg}
        </span>
      )}
    </div>
  );
}

// ----------------------------- Niche selector -----------------------------

function NicheSelector({
  niches,
  onSelect,
  hasChannel,
  current,
  compactMode,
}: {
  niches: string[];
  onSelect: (n: string) => void;
  hasChannel: boolean;
  current?: string;
  compactMode?: boolean;
}) {
  if (niches.length === 0 && !compactMode) {
    return (
      <EmptyState
        title="No niches configured"
        description={
          hasChannel
            ? "The selected channel has no niche set in its identity. Set one to enable SEO research."
            : "None of your channels have a niche configured yet. Set a niche on a channel's identity to enable SEO research."
        }
        icon={<IconSeo width={24} height={24} />}
      />
    );
  }
  return (
    <div className={compactMode ? styles.nicheRail : styles.nicheChooser}>
      <div className={styles.nicheChooserCopy}>
        <span>{compactMode ? "Switch territory" : "Research territories"}</span>
        {!compactMode && <><h2>Choose the market before reading the signals.</h2><p>These territories come from channel identities already stored in the workspace.</p></>}
      </div>
      <div className={styles.nicheOptions}>
        {niches.map((n, index) => (
          <button
            key={n}
            type="button"
            onClick={() => onSelect(n)}
            data-active={n === current || undefined}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{n}</strong>
            <i>↗</i>
          </button>
        ))}
      </div>
    </div>
  );
}

// -------------------------- Niche intelligence --------------------------

function NicheIntelligence({ intel }: { intel: SeoIntel }) {
  const tags = labeled(intel.topTags, "tag");
  const patterns = labeled(intel.topTitlePatterns, "pattern");
  const power = labeled(intel.powerWords, "word");
  const guide = intel.thumbnailStyleGuide;
  const metadataOnly =
    guide.visualEvidenceStatus === "metadata_only" ||
    guide.evidenceSource === "youtube_data_api_v3_metadata" ||
    guide.notes.toLowerCase().startsWith("minimal guide");

  return (
    <section className={styles.signalRoom}>
      <SeoSectionHeading eyebrow="Language evidence" title="Search and packaging signals" detail="Stored metadata patterns, clearly separated from visual thumbnail measurement." />
      <div className={styles.intelligenceGrid}>
        <Panel title="Optimal title length">
          <div className={styles.titleLength}>
            {intel.optimalTitleLen}
            <span> chars</span>
          </div>
          <div className={styles.titleLengthNote}>
            Avg {compact(intel.avgViewsTop50)} · median{" "}
            {compact(intel.medianViewsTop50)} views (top 50)
          </div>
        </Panel>

        <Panel title="Top tags">
          <ChipList items={tags.slice(0, 14)} />
        </Panel>

        <Panel title="Title patterns">
          <ChipList items={patterns.slice(0, 8)} accent />
        </Panel>

        <Panel title="Power words">
          <ChipList items={power.slice(0, 16)} />
        </Panel>

        <Panel title="Thumbnail style guide">
          <div className={styles.paletteStrip}>
            {guide.dominantColors.slice(0, 6).map((c, i) => (
              <span
                key={i}
                title={c}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className={styles.guideState}>
            {metadataOnly || typeof guide.hasTextOverlayPct !== "number"
              ? "Visual thumbnail attributes: not measured from metadata"
              : `Text overlay: ${guide.hasTextOverlayPct}% of top thumbnails`}
          </div>
          {guide.notes && (
            <p className={styles.guideNote}>
              {guide.notes}
            </p>
          )}
        </Panel>
      </div>
    </section>
  );
}

// ----------------------------- SEO databank -----------------------------

function SeoDatabank({ databank }: { databank: SeoDatabankRow }) {
  const attribution = databank.sourceAttribution;
  return (
    <section className={styles.strategyRoom}>
      <SeoSectionHeading eyebrow="Pattern library" title="Strategy databank" detail="Reusable structures extracted from the stored sample; gaps remain hypotheses until separately tested." />
      {attribution && (
        <p className={styles.attributionNote}>
          Source: YouTube Data API v3 metadata from {attribution.topPerformersAnalysed} top performers. Visual, opening-hook, and demand-gap claims remain unavailable without separate evidence.
        </p>
      )}
      <div className={styles.strategyGrid}>
        <Panel title="Title templates">
          <List items={databank.titleTemplates} mono />
        </Panel>
        <Panel title="Hook patterns">
          <List items={databank.hookPatterns} />
        </Panel>
        <Panel title="Competitor gaps">
          <List items={databank.competitorGaps} />
        </Panel>
      </div>
    </section>
  );
}

// ------------------------- View-estimate widget -------------------------

function ViewEstimateWidget({
  ownerId,
  niche,
}: {
  ownerId: string;
  niche: string;
}) {
  const [input, setInput] = useState("");
  const tags = useMemo(
    () =>
      input
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    [input],
  );

  // Reactive estimate — re-runs as tags change (debounced by user typing).
  const estimate = useQuery(api.seo.viewEstimate, { ownerId, niche, tags });

  return (
    <section className={styles.estimateRoom}>
      <SeoSectionHeading eyebrow="Scenario lens" title="Tag-overlap estimate" detail="A bounded comparison to the stored niche sample—not a promise of audience demand." />
      <div className={styles.estimateWorkbench}>
        <label>
          <span>Candidate tag set</span>
          <small>Comma-separated; the calculation stays within this stored niche.</small>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="lofi, study beats, chill, focus"
          />
        </label>

        {tags.length > 0 && estimate && (
          <div className={styles.estimateResult}>
            <span>
              {compact(estimate.estimatedViews)}
            </span>
            <span>
              modeled views ·{" "}
              {estimate.source === "tag_overlap"
                ? `tag overlap (${estimate.matches} matches)`
                : "niche fallback"}
            </span>
          </div>
        )}
        {tags.length === 0 && <div className={styles.estimateIdle}><span>∿</span><strong>Waiting for a candidate tag set</strong><small>No scenario is calculated from an empty input.</small></div>}
      </div>
    </section>
  );
}

// ------------------------- Competitor top videos -------------------------

type CompetitorRow = {
  channelName: string;
  topVideos: {
    youtubeVideoId: string;
    title: string;
    views: number;
  }[];
};

function CompetitorTopVideos({
  competitors,
}: {
  competitors: CompetitorRow[] | undefined;
}) {
  if (competitors === undefined) return <SkeletonList rows={3} />;

  const top = competitors
    .flatMap((c) =>
      c.topVideos.map((v) => ({ ...v, channelName: c.channelName })),
    )
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  return (
    <section className={styles.competitorRoom}>
      <SeoSectionHeading eyebrow="Observed market" title="Competitor top videos" detail="Ranked YouTube metadata from the persisted research sample." />
      {top.length === 0 ? (
        <EmptyState
          title="No competitor videos yet"
          description="Run research to mine the top-performing competitor videos for this niche."
          icon={<IconExternal width={24} height={24} />}
        />
      ) : (
        <div className={styles.competitorLedger}>
          {top.map((v, index) => (
            <a
              key={v.youtubeVideoId}
              href={`https://www.youtube.com/watch?v=${v.youtubeVideoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.competitorRow}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>
                  {v.title}
                </strong>
                <small>{v.channelName}</small>
              </div>
              <em>
                {compact(v.views)} views
              </em>
              <i>↗</i>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

// ------------------------------- Helpers -------------------------------

function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.researchPanel}>
      <div className={styles.researchPanelTitle}>
        {title}
      </div>
      {children}
    </div>
  );
}

function ChipList({ items, accent }: { items: string[]; accent?: boolean }) {
  if (items.length === 0)
    return (
      <span className={styles.emptyValue}>—</span>
    );
  return (
    <div className={styles.chipList} data-accent={accent || undefined}>
      {items.map((it, i) => (
        <span key={i}>
          {it}
        </span>
      ))}
    </div>
  );
}

function List({ items, mono }: { items: string[]; mono?: boolean }) {
  if (items.length === 0)
    return (
      <span className={styles.emptyValue}>—</span>
    );
  return (
    <ul className={styles.patternList} data-mono={mono || undefined}>
      {items.map((it, i) => (
        <li key={i}>
          <span>{String(i + 1).padStart(2, "0")}</span><strong>{it}</strong>
        </li>
      ))}
    </ul>
  );
}

function SeoSectionHeading({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <header className={styles.roomHeading}>
      <div><span>{eyebrow}</span><h2>{title}</h2></div>
      <p>{detail}</p>
    </header>
  );
}

/**
 * topTags / topTitlePatterns / powerWords are arrays of either strings or
 * {<key>, count} objects (v.any() in schema). Normalise to display strings.
 */
function labeled(items: unknown[], key: string): string[] {
  return (items ?? []).map((it) => {
    if (typeof it === "string") return it;
    if (it && typeof it === "object") {
      const obj = it as Record<string, unknown>;
      const v = obj[key];
      if (typeof v === "string") return v;
      if (typeof v === "number") return String(v);
    }
    return String(it);
  });
}
