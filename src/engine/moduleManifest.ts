import { z } from "zod";
import type { Block, PipelineEntry } from "./types";
import { artifactContract, type ArtifactContract } from "./artifactSchemas";

export type ModuleCertification = "legacy" | "contract" | "golden" | "revoked";
export type ModuleSideEffect =
  | "none"
  | "paid_compute"
  | "external_message"
  | "publish_media"
  | "delete_scoped_artifacts";

export interface ProviderProfile {
  id: string;
  provider: string;
  quality: "draft" | "production" | "hero";
  allowFallback: boolean;
}

export interface ModuleCostContext {
  /** Exact ordered pipeline used for this compilation/preflight. */
  entries: readonly PipelineEntry[];
  /** Index of the module whose envelope is being evaluated. */
  index: number;
}

export type ModuleCostEnvelope = (
  params: Readonly<Record<string, unknown>>,
  context?: Readonly<ModuleCostContext>,
) => number;

export interface ModuleContractOverride {
  version?: string;
  capabilities: string[];
  requiredConsumes?: string[];
  optionalConsumes?: string[];
  optionalProduces?: string[];
  providerProfiles?: ProviderProfile[];
  sideEffects?: ModuleSideEffect[];
  certification?: ModuleCertification;
  certificationEvidence?: string;
  /** Absolute ceiling across every supported configuration. */
  maxCostUsd?: number;
  /** Conservative ceiling for this exact pipeline entry configuration. */
  maxCostUsdFor?: ModuleCostEnvelope;
  maxLatencySec?: number;
  qualityRequired?: boolean;
}

export interface ModuleManifest {
  id: string;
  version: string;
  capabilities: readonly string[];
  consumes: Readonly<Record<string, ArtifactContract>>;
  optionalConsumes: Readonly<Record<string, ArtifactContract>>;
  produces: Readonly<Record<string, ArtifactContract>>;
  optionalProduces: Readonly<Record<string, ArtifactContract>>;
  configSchema: z.ZodType<Record<string, unknown>>;
  providerProfiles: readonly ProviderProfile[];
  costAndLatency: {
    paid: boolean;
    maxCostUsd?: number;
    maxCostUsdFor?: ModuleCostEnvelope;
    maxLatencySec?: number;
  };
  idempotency: {
    required: boolean;
    scope: "none" | "run_module" | "run_artifact";
  };
  retryAndResume: {
    retryable: boolean;
    durableCheckpoint: boolean;
  };
  qualityContract: {
    required: boolean;
    failClosed: boolean;
  };
  securityAndSideEffects: {
    effects: readonly ModuleSideEffect[];
    approvalRequired: boolean;
    tenantScoped: boolean;
  };
  certification: {
    status: ModuleCertification;
    evidence: string;
  };
  execute: Block["run"];
  block: Block;
}

function keyedContracts(keys: readonly string[]): Record<string, ArtifactContract> {
  return Object.fromEntries(keys.map((key) => [key, artifactContract(key)]));
}

export function manifestFromBlock(
  block: Block,
  override?: ModuleContractOverride,
): ModuleManifest {
  const requiredKeys = override?.requiredConsumes ?? block.consumes;
  const required = new Set(requiredKeys);
  const optionalConsumes = (override?.optionalConsumes ?? []).filter((key) => !required.has(key));
  const optionalOutputKeys = new Set(override?.optionalProduces ?? []);
  const requiredOutputKeys = block.produces.filter((key) => !optionalOutputKeys.has(key));
  const effects = new Set<ModuleSideEffect>(override?.sideEffects ?? []);
  if (block.paid) effects.add("paid_compute");
  if (effects.size === 0) effects.add("none");
  const external = [...effects].some((effect) =>
    ["external_message", "publish_media", "delete_scoped_artifacts"].includes(effect),
  );

  return {
    id: block.id,
    version: override?.version ?? "1.0.0-migration",
    capabilities: override?.capabilities ?? [],
    consumes: keyedContracts(requiredKeys),
    optionalConsumes: keyedContracts(optionalConsumes),
    produces: keyedContracts(requiredOutputKeys),
    optionalProduces: keyedContracts([...optionalOutputKeys]),
    configSchema: z.record(z.string(), z.unknown()),
    providerProfiles: override?.providerProfiles ?? [],
    costAndLatency: {
      paid: Boolean(block.paid),
      maxCostUsd: override?.maxCostUsd,
      maxCostUsdFor: override?.maxCostUsdFor,
      maxLatencySec: override?.maxLatencySec,
    },
    idempotency: {
      required: Boolean(block.paid) || external,
      scope: external ? "run_artifact" : block.paid ? "run_module" : "none",
    },
    retryAndResume: {
      retryable: !effects.has("delete_scoped_artifacts"),
      durableCheckpoint: Boolean(block.paid) || effects.has("publish_media"),
    },
    qualityContract: {
      required: override?.qualityRequired ?? false,
      failClosed: override?.qualityRequired ?? false,
    },
    securityAndSideEffects: {
      effects: [...effects],
      approvalRequired: effects.has("publish_media"),
      tenantScoped: true,
    },
    certification: {
      status: override?.certification ?? "legacy",
      evidence: override?.certificationEvidence ?? "legacy block adapter; contract certification pending",
    },
    execute: block.run,
    block,
  };
}

/**
 * Resolve the spend ceiling for one configured module invocation. The static
 * maximum remains the absolute contract; a parameter-aware envelope may only
 * make that reservation smaller, never enlarge or bypass it.
 */
export function configuredMaxCostUsd(
  manifest: ModuleManifest,
  params: Readonly<Record<string, unknown>> = {},
  context?: Readonly<ModuleCostContext>,
): number {
  if (!manifest.costAndLatency.paid) return 0;
  const absolute = manifest.costAndLatency.maxCostUsd;
  if (!Number.isFinite(absolute) || absolute === undefined || absolute < 0) {
    throw new Error(`paid module "${manifest.id}" has no finite absolute cost envelope`);
  }
  const configured = manifest.costAndLatency.maxCostUsdFor?.(params, context) ?? absolute;
  if (!Number.isFinite(configured) || configured < 0) {
    throw new Error(`paid module "${manifest.id}" produced an invalid configured cost envelope`);
  }
  if (configured > absolute + Number.EPSILON) {
    throw new Error(
      `paid module "${manifest.id}" configured envelope $${configured.toFixed(2)} exceeds its absolute $${absolute.toFixed(2)} ceiling`,
    );
  }
  return configured;
}

export function assertExecutableManifest(manifest: ModuleManifest): void {
  if (manifest.id !== manifest.block.id) {
    throw new Error(`manifest id ${manifest.id} does not match block id ${manifest.block.id}`);
  }
  const overlap = Object.keys(manifest.optionalConsumes).filter((key) => key in manifest.consumes);
  if (overlap.length) {
    throw new Error(`manifest ${manifest.id} declares required/optional input overlap: ${overlap.join(", ")}`);
  }
  const outputOverlap = Object.keys(manifest.optionalProduces).filter((key) => key in manifest.produces);
  if (outputOverlap.length) {
    throw new Error(`manifest ${manifest.id} declares required/optional output overlap: ${outputOverlap.join(", ")}`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(manifest.version)) {
    throw new Error(`manifest ${manifest.id} has invalid version ${manifest.version}`);
  }
  if (manifest.costAndLatency.paid && manifest.idempotency.scope === "none") {
    throw new Error(`paid manifest ${manifest.id} must declare idempotency`);
  }
  if (manifest.securityAndSideEffects.effects.includes("publish_media") && !manifest.idempotency.required) {
    throw new Error(`publishing manifest ${manifest.id} must require idempotency`);
  }
}
