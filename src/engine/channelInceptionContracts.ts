import { FAMILY_KEYS, type FamilyKey } from "./families";

/**
 * Channel inception is deliberately a catalog of contracts, not an executor.
 * Provider calls and live mutations belong to a future resumable workflow that
 * persists each stage receipt before advancing.
 */
export const CHANNEL_INCEPTION_SCHEMA_VERSION = "1.0.0" as const;

export const CHANNEL_INCEPTION_MODULE_KEYS = [
  "channel-inception-research",
  "channel-inception-positioning",
  "channel-inception-seo",
  "channel-inception-voice",
  "channel-inception-avatar",
  "channel-inception-banner",
  "channel-inception-thumbnails",
  "channel-inception-pipeline",
  "channel-inception-probe",
  "channel-inception-readiness",
] as const;

export type ChannelInceptionModuleKey = (typeof CHANNEL_INCEPTION_MODULE_KEYS)[number];

/** Hard reservation ceilings; provider implementations may spend less, never more. */
export const CHANNEL_INCEPTION_STAGE_COST_CEILINGS_USD: Readonly<
  Record<ChannelInceptionModuleKey, number>
> = {
  "channel-inception-research": 0.25,
  "channel-inception-positioning": 0.6,
  "channel-inception-seo": 0.45,
  "channel-inception-voice": 0.75,
  "channel-inception-avatar": 0.4,
  "channel-inception-banner": 0.55,
  "channel-inception-thumbnails": 1.4,
  "channel-inception-pipeline": 0.6,
  "channel-inception-probe": 3,
  "channel-inception-readiness": 0,
};

/** One-time provider ceiling for setup, excluding the separately approved proof render. */
export const CHANNEL_INCEPTION_SETUP_COST_CEILING_USD = Number(
  Object.entries(CHANNEL_INCEPTION_STAGE_COST_CEILINGS_USD)
    .filter(([stage]) => stage !== "channel-inception-probe")
    .reduce((total, [, ceiling]) => total + ceiling, 0)
    .toFixed(2),
);

export type ChannelInceptionCostClass =
  | "deterministic-local"
  | "provider-potential";

export type ChannelInceptionExecutionOwner =
  | "channel-inception-orchestrator"
  | "family-engine"
  | "readiness-projector";

export type ChannelVoiceOwnership = "none" | "channel-cast" | "family-engine";

export type ChannelProbeProfile =
  | "narrated-longform"
  | "ambient-narrated"
  | "music-loop"
  | "motion-comic"
  | "whiteboard"
  | "vertical-short"
  | "cinematic-scenes";

export interface ChannelInceptionFamilyPolicy {
  family: FamilyKey;
  voiceOwnership: ChannelVoiceOwnership;
  requiresNarrativePlaybook: boolean;
  probeProfile: ChannelProbeProfile;
  starterTopicCount: number;
  starterPreviewCount: number;
}

export interface ChannelInceptionModuleContract {
  key: ChannelInceptionModuleKey;
  version: string;
  certification: "contract";
  catalogStatus: "reference";
  stage: string;
  title: string;
  purpose: string;
  requiredDependencies: readonly ChannelInceptionModuleKey[];
  optionalDependencies: readonly ChannelInceptionModuleKey[];
  supportedFamilies: readonly FamilyKey[];
  defaultExecutionOwner: ChannelInceptionExecutionOwner;
  costClass: ChannelInceptionCostClass;
  outputs: readonly string[];
  gates: readonly string[];
}

const ALL_FAMILIES = [...FAMILY_KEYS] as const;
const VOICE_FAMILIES = FAMILY_KEYS.filter((family) => family !== "music_loop");

/**
 * Family policy is intentionally narrow. It decides module applicability and
 * ownership without replacing the family's specialized production pipeline.
 */
export const CHANNEL_INCEPTION_FAMILY_POLICIES: Readonly<
  Record<FamilyKey, ChannelInceptionFamilyPolicy>
> = {
  narrated_stock: {
    family: "narrated_stock",
    voiceOwnership: "channel-cast",
    requiresNarrativePlaybook: true,
    probeProfile: "narrated-longform",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
  music_loop: {
    family: "music_loop",
    voiceOwnership: "none",
    requiresNarrativePlaybook: false,
    probeProfile: "music-loop",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
  sleep: {
    family: "sleep",
    voiceOwnership: "channel-cast",
    requiresNarrativePlaybook: true,
    probeProfile: "ambient-narrated",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
  comic: {
    family: "comic",
    // The comic engine owns its multi-character cast. This avoids paying for a
    // second global cast that the self-contained comic renderer never consumes.
    voiceOwnership: "family-engine",
    requiresNarrativePlaybook: true,
    probeProfile: "motion-comic",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
  shorts: {
    family: "shorts",
    voiceOwnership: "channel-cast",
    requiresNarrativePlaybook: true,
    probeProfile: "vertical-short",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
  documentary_collage_short: {
    family: "documentary_collage_short",
    voiceOwnership: "channel-cast",
    requiresNarrativePlaybook: true,
    probeProfile: "vertical-short",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
  whiteboard: {
    family: "whiteboard",
    voiceOwnership: "channel-cast",
    requiresNarrativePlaybook: true,
    probeProfile: "whiteboard",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
  cinematic: {
    family: "cinematic",
    voiceOwnership: "channel-cast",
    requiresNarrativePlaybook: true,
    probeProfile: "cinematic-scenes",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
  quizyear: {
    family: "quizyear",
    // NOBODY speaks: the format is on-screen typography and a timer, so there
    // is no cast voice to own and no narrative playbook to author.
    voiceOwnership: "none",
    requiresNarrativePlaybook: false,
    probeProfile: "vertical-short",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
  datachart: {
    family: "datachart",
    // ONE narrator reads the countdown for the whole channel, so the channel's
    // cast voice is exactly the right owner (unlike the comic engine, which
    // owns a multi-character cast of its own).
    voiceOwnership: "channel-cast",
    requiresNarrativePlaybook: true,
    // 16:9 narrated chart video — the longform probe is the honest match.
    probeProfile: "narrated-longform",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
  simstory: {
    family: "simstory",
    voiceOwnership: "channel-cast",
    requiresNarrativePlaybook: true,
    probeProfile: "narrated-longform",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
  loreshort: {
    family: "loreshort",
    // The lore engine speaks with ONE first-person narrator for the whole
    // channel, so the channel's cast voice is exactly the right owner (unlike
    // the comic engine, which owns a multi-character cast of its own).
    voiceOwnership: "channel-cast",
    requiresNarrativePlaybook: true,
    // 16:9 narrated micro-doc, not a vertical Short — the longform probe is the
    // honest match even though each episode runs about a minute.
    probeProfile: "narrated-longform",
    starterTopicCount: 3,
    starterPreviewCount: 3,
  },
};

export const CHANNEL_INCEPTION_MODULE_CONTRACTS: readonly ChannelInceptionModuleContract[] = [
  {
    key: "channel-inception-research",
    version: "1.0.0",
    certification: "contract",
    catalogStatus: "reference",
    stage: "inception/research",
    title: "Channel Research Evidence",
    purpose:
      "Capture a versioned niche, competitor, audience-demand and source-evidence snapshot before creative decisions are made.",
    requiredDependencies: [],
    optionalDependencies: [],
    supportedFamilies: ALL_FAMILIES,
    defaultExecutionOwner: "channel-inception-orchestrator",
    costClass: "provider-potential",
    outputs: ["research-evidence", "competitor-set", "audience-demand", "research-receipt"],
    gates: [
      "real source evidence is present and timestamped",
      "missing credentials or evidence block readiness instead of reporting skipped success",
      "research inputs and model/provider receipts are versioned",
    ],
  },
  {
    key: "channel-inception-positioning",
    version: "1.0.0",
    certification: "contract",
    catalogStatus: "reference",
    stage: "inception/identity",
    title: "Positioning, Style DNA & Show Bible",
    purpose:
      "Turn research into a coherent channel thesis, Style DNA, Show Bible, visual identity and measurable quality bar.",
    requiredDependencies: ["channel-inception-research"],
    optionalDependencies: [],
    supportedFamilies: ALL_FAMILIES,
    defaultExecutionOwner: "channel-inception-orchestrator",
    costClass: "provider-potential",
    outputs: ["positioning-thesis", "style-dna", "show-bible", "quality-bar", "identity-revision"],
    gates: [
      "Style DNA confidence and unresolved-gap thresholds pass",
      "Show Bible, positioning and quality bar do not contradict one another",
      "locked identity fields are explicit and versioned",
    ],
  },
  {
    key: "channel-inception-seo",
    version: "1.0.0",
    certification: "contract",
    catalogStatus: "reference",
    stage: "inception/editorial",
    title: "SEO & Editorial Foundation",
    purpose:
      "Create research-grounded topic, title and metadata doctrine plus a narrative playbook only for families that use scripts.",
    requiredDependencies: ["channel-inception-research", "channel-inception-positioning"],
    optionalDependencies: [],
    supportedFamilies: ALL_FAMILIES,
    defaultExecutionOwner: "channel-inception-orchestrator",
    costClass: "provider-potential",
    outputs: ["topic-doctrine", "metadata-doctrine", "narrative-playbook-when-applicable", "seo-receipt"],
    gates: [
      "topics and metadata trace to research evidence",
      "no-script families do not pay for or receive a narrative playbook",
      "legacy fallback is retired only after a proven replacement exists",
    ],
  },
  {
    key: "channel-inception-voice",
    version: "1.0.0",
    certification: "contract",
    catalogStatus: "reference",
    stage: "inception/voice",
    title: "Voice Casting & Readiness",
    purpose:
      "Produce consumed, evidence-backed voice readiness for narrated families while allowing self-contained engines to own their cast.",
    requiredDependencies: ["channel-inception-positioning"],
    optionalDependencies: [],
    supportedFamilies: VOICE_FAMILIES,
    defaultExecutionOwner: "channel-inception-orchestrator",
    costClass: "provider-potential",
    outputs: ["voice-cast", "audition-evidence", "cold-open-proof", "voice-readiness"],
    gates: [
      "selected cast is consumed by the effective family pipeline",
      "audition and cold-open evidence pass fail-closed readiness",
      "music-loop families omit this module entirely",
    ],
  },
  {
    key: "channel-inception-avatar",
    version: "1.0.0",
    certification: "contract",
    catalogStatus: "reference",
    stage: "inception/brand",
    title: "Channel Avatar",
    purpose:
      "Preserve approved avatars or create versioned candidates with circular-crop and tiny-size legibility evidence.",
    requiredDependencies: ["channel-inception-positioning"],
    optionalDependencies: [],
    supportedFamilies: ALL_FAMILIES,
    defaultExecutionOwner: "channel-inception-orchestrator",
    costClass: "provider-potential",
    outputs: ["avatar-candidate-or-protected-reference", "avatar-qa-receipt"],
    gates: [
      "protected existing avatar is never overwritten",
      "candidate passes circular crop and tiny-size recognition",
      "candidate is text-free and content-addressed",
    ],
  },
  {
    key: "channel-inception-banner",
    version: "1.0.0",
    certification: "contract",
    catalogStatus: "reference",
    stage: "inception/brand",
    title: "Banner, Background & Color System",
    purpose:
      "Manage banner, reusable background treatment and channel colors independently from the avatar and from one another.",
    requiredDependencies: ["channel-inception-positioning"],
    optionalDependencies: [],
    supportedFamilies: ALL_FAMILIES,
    defaultExecutionOwner: "channel-inception-orchestrator",
    costClass: "provider-potential",
    outputs: ["banner-candidate-or-protected-reference", "background-system", "color-system", "banner-qa-receipt"],
    gates: [
      "protected existing brand assets are never overwritten",
      "banner passes YouTube safe-area and no-garbled-text checks",
      "background and colors remain consistent with locked Style DNA",
    ],
  },
  {
    key: "channel-inception-thumbnails",
    version: "1.0.0",
    certification: "contract",
    catalogStatus: "reference",
    stage: "inception/package",
    title: "Thumbnail Foundation & Starter Slate",
    purpose:
      "Create an evidence-grounded thumbnail playbook, starter topics and only the missing versioned preview candidates.",
    requiredDependencies: [
      "channel-inception-research",
      "channel-inception-positioning",
      "channel-inception-seo",
    ],
    optionalDependencies: [],
    supportedFamilies: ALL_FAMILIES,
    defaultExecutionOwner: "channel-inception-orchestrator",
    costClass: "provider-potential",
    outputs: ["thumbnail-playbook", "starter-topics", "starter-preview-candidates", "thumbnail-qa-receipts"],
    gates: [
      "playbook is blocked until Style DNA and research are established",
      "only missing starter topics and previews are generated",
      "every accepted preview passes mobile, reference and typography QA",
    ],
  },
  {
    key: "channel-inception-pipeline",
    version: "1.0.0",
    certification: "contract",
    catalogStatus: "reference",
    stage: "inception/pipeline",
    title: "Family Pipeline Compile",
    purpose:
      "Compile the channel's specialized family pipeline, preserving family engines and retiring only compiler-declared legacy blocks.",
    requiredDependencies: ["channel-inception-positioning", "channel-inception-seo"],
    optionalDependencies: ["channel-inception-voice"],
    supportedFamilies: ALL_FAMILIES,
    defaultExecutionOwner: "channel-inception-orchestrator",
    costClass: "deterministic-local",
    outputs: ["effective-pipeline", "compiler-fingerprint", "catalog-flow", "qualification-report"],
    gates: [
      "effective pipeline passes production policy validation",
      "family-specific modules and parameters are preserved",
      "Golden labels require immutable promotion proof",
    ],
  },
  {
    key: "channel-inception-probe",
    version: "1.0.0",
    certification: "contract",
    catalogStatus: "reference",
    stage: "inception/probe",
    title: "Bounded Family Probe",
    purpose:
      "Plan one bounded, resumable family-specific proof run with no publication and with receipts for every paid boundary.",
    requiredDependencies: ["channel-inception-pipeline"],
    optionalDependencies: [],
    supportedFamilies: ALL_FAMILIES,
    defaultExecutionOwner: "channel-inception-orchestrator",
    costClass: "provider-potential",
    outputs: ["probe-artifacts", "quality-verdict", "cost-receipt", "recovery-checkpoint"],
    gates: [
      "probe is bounded, resumable and idempotent",
      "publication remains disabled",
      "provider spend requires a separate admitted execution receipt",
    ],
  },
  {
    key: "channel-inception-readiness",
    version: "1.0.0",
    certification: "contract",
    catalogStatus: "reference",
    stage: "inception/project",
    title: "Channel Tile & Readiness Projection",
    purpose:
      "Project one materialized UI record from admitted stage receipts instead of inferring readiness from shallow fields.",
    requiredDependencies: [
      "channel-inception-research",
      "channel-inception-positioning",
      "channel-inception-seo",
      "channel-inception-avatar",
      "channel-inception-banner",
      "channel-inception-thumbnails",
      "channel-inception-pipeline",
    ],
    optionalDependencies: ["channel-inception-voice", "channel-inception-probe"],
    supportedFamilies: ALL_FAMILIES,
    defaultExecutionOwner: "readiness-projector",
    costClass: "deterministic-local",
    outputs: ["channel-tile-projection", "readiness-blockers", "effective-module-path", "accepted-artwork-references"],
    gates: [
      "projection consumes admitted receipts rather than raw success statuses",
      "source and effective pipeline are distinguished",
      "catalog-mapped and Golden-qualified states are distinguished",
    ],
  },
];

export interface ChannelInceptionCatalogModule {
  key: ChannelInceptionModuleKey;
  stage: string;
  title: string;
  engine: string;
  how: string;
  gates: string[];
  status: "reference";
}

/** Honest catalog projection: these are contracts with no executable binding. */
export const CHANNEL_INCEPTION_CATALOG_MODULES: ChannelInceptionCatalogModule[] =
  CHANNEL_INCEPTION_MODULE_CONTRACTS.map((contract) => ({
    key: contract.key,
    stage: contract.stage,
    title: contract.title,
    engine: `Channel Inception contract ${contract.version} (catalog-only; no executor bound)`,
    how:
      `${contract.purpose} The contract defines dependencies, outputs, quality gates and cost class, ` +
      "but it cannot execute provider work or mutate a live channel.",
    gates: [...contract.gates],
    status: "reference",
  }));

export function channelInceptionContract(
  key: ChannelInceptionModuleKey,
): ChannelInceptionModuleContract {
  const contract = CHANNEL_INCEPTION_MODULE_CONTRACTS.find((candidate) => candidate.key === key);
  if (!contract) throw new Error(`Unknown channel inception module: ${key}`);
  return contract;
}

/** Fail fast if catalog edits introduce duplicate modules, invalid families or a dependency cycle. */
export function assertChannelInceptionContracts(): void {
  const keySet = new Set(CHANNEL_INCEPTION_MODULE_KEYS);
  const contractsByKey = new Map<ChannelInceptionModuleKey, ChannelInceptionModuleContract>();

  if (CHANNEL_INCEPTION_MODULE_CONTRACTS.length !== CHANNEL_INCEPTION_MODULE_KEYS.length) {
    throw new Error("Channel inception contract count does not match the declared module keys");
  }

  for (const contract of CHANNEL_INCEPTION_MODULE_CONTRACTS) {
    if (contractsByKey.has(contract.key)) throw new Error(`Duplicate channel inception module: ${contract.key}`);
    contractsByKey.set(contract.key, contract);
    if (contract.certification !== "contract" || contract.catalogStatus !== "reference") {
      throw new Error(`${contract.key} must remain an honest reference/contract module until proven`);
    }
    if (!/^\d+\.\d+\.\d+$/.test(contract.version)) {
      throw new Error(`${contract.key} has an invalid semantic version`);
    }
    const dependencySet = new Set<ChannelInceptionModuleKey>();
    for (const dependency of [...contract.requiredDependencies, ...contract.optionalDependencies]) {
      if (!keySet.has(dependency)) throw new Error(`${contract.key} depends on unknown module ${dependency}`);
      if (dependency === contract.key) throw new Error(`${contract.key} cannot depend on itself`);
      if (dependencySet.has(dependency)) throw new Error(`${contract.key} repeats dependency ${dependency}`);
      dependencySet.add(dependency);
    }
    if (!contract.supportedFamilies.length) throw new Error(`${contract.key} supports no channel family`);
    if (new Set(contract.supportedFamilies).size !== contract.supportedFamilies.length) {
      throw new Error(`${contract.key} repeats a supported family`);
    }
  }

  const familyKeys = [...FAMILY_KEYS].sort();
  const policyKeys = Object.keys(CHANNEL_INCEPTION_FAMILY_POLICIES).sort();
  if (familyKeys.join("|") !== policyKeys.join("|")) {
    throw new Error("Every channel family must have exactly one inception policy");
  }
  if (CHANNEL_INCEPTION_FAMILY_POLICIES.music_loop.voiceOwnership !== "none") {
    throw new Error("music_loop must omit voice inception");
  }
  if (CHANNEL_INCEPTION_FAMILY_POLICIES.comic.voiceOwnership !== "family-engine") {
    throw new Error("comic must be able to own its voice cast");
  }

  const visiting = new Set<ChannelInceptionModuleKey>();
  const visited = new Set<ChannelInceptionModuleKey>();
  const visit = (key: ChannelInceptionModuleKey): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) throw new Error(`Channel inception dependency cycle at ${key}`);
    visiting.add(key);
    const contract = contractsByKey.get(key);
    if (!contract) throw new Error(`Missing channel inception contract for ${key}`);
    for (const dependency of [...contract.requiredDependencies, ...contract.optionalDependencies]) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of CHANNEL_INCEPTION_MODULE_KEYS) visit(key);
}
