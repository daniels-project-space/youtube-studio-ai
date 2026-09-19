import { MODULE_CONTRACTS } from "./moduleContracts";
import { artifactContract } from "./artifactSchemas";

export interface ModuleArtifactSurface {
  key: string;
  type: string;
  version: string;
  persist: "inline" | "reference" | "summary";
  opaque: boolean;
}

/**
 * The small, read-only contract view shared by operator surfaces.
 *
 * The executable manifest remains the authority for validation and execution;
 * this projection only makes the same ABI legible in the catalog. Keeping the
 * projection here prevents each screen from inventing a second list of inputs
 * or downstream handoffs. It intentionally reads the browser/server-safe
 * contract declarations rather than importing provider-heavy block runners.
 */
export interface ModuleContractSurface {
  executableIds: readonly string[];
  missingExecutableIds: readonly string[];
  requiredInputs: readonly string[];
  optionalInputs: readonly string[];
  requiredInputContracts: readonly ModuleArtifactSurface[];
  optionalInputContracts: readonly ModuleArtifactSurface[];
  requiredCapabilities: readonly string[];
  outputs: readonly string[];
  optionalOutputs: readonly string[];
  outputContracts: readonly ModuleArtifactSurface[];
  optionalOutputContracts: readonly ModuleArtifactSurface[];
  capabilities: readonly string[];
  requiredDownstreamCapabilities: readonly string[];
  requiredDownstreamConsumes: Readonly<Record<string, string>>;
  downstreamContracts: Readonly<Record<string, ModuleArtifactSurface>>;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function artifactSurface(key: string): ModuleArtifactSurface {
  const contract = artifactContract(key);
  return {
    key: contract.key,
    type: contract.type,
    version: contract.version,
    persist: contract.persist,
    opaque: contract.opaque,
  };
}

function artifactSurfaces(keys: readonly string[]): ModuleArtifactSurface[] {
  return unique(keys).map(artifactSurface);
}

/**
 * Resolve the exact declared contracts behind a catalog binding. Missing ids
 * are retained as an explicit warning instead of being silently omitted; a
 * card can therefore never imply that an unknown step has a contract.
 */
export function moduleContractSurface(
  executableIds: readonly string[],
): ModuleContractSurface | undefined {
  if (!executableIds.length) return undefined;
  const contracts = executableIds
    .map((id) => MODULE_CONTRACTS[id])
    .filter((contract): contract is NonNullable<typeof contract> => Boolean(contract));
  const missingExecutableIds = executableIds.filter((id) => !MODULE_CONTRACTS[id]);
  if (!contracts.length) {
    return {
      executableIds: [...executableIds],
      missingExecutableIds: [...missingExecutableIds],
      requiredInputs: [],
      optionalInputs: [],
      requiredInputContracts: [],
      optionalInputContracts: [],
      requiredCapabilities: [],
      outputs: [],
      optionalOutputs: [],
      outputContracts: [],
      optionalOutputContracts: [],
      capabilities: [],
      requiredDownstreamCapabilities: [],
      requiredDownstreamConsumes: {},
      downstreamContracts: {},
    };
  }
  const requiredInputs = unique(contracts.flatMap((contract) => contract.requiredConsumes ?? []));
  const requiredInputSet = new Set(requiredInputs);
  const optionalInputs = unique(
    contracts
      .flatMap((contract) => contract.optionalConsumes ?? [])
      .filter((key) => !requiredInputSet.has(key)),
  );
  const optionalOutputs = unique(contracts.flatMap((contract) => contract.optionalProduces ?? []));
  const downstreamBindings = Object.fromEntries(
    contracts.flatMap((contract) => Object.entries(contract.requiredDownstreamConsumes ?? {})),
  );
  return {
    executableIds: executableIds.filter((id) => Boolean(MODULE_CONTRACTS[id])),
    missingExecutableIds: [...missingExecutableIds],
    requiredInputs,
    optionalInputs,
    requiredInputContracts: artifactSurfaces(requiredInputs),
    optionalInputContracts: artifactSurfaces(optionalInputs),
    requiredCapabilities: unique(contracts.flatMap((contract) => contract.requiredCapabilities ?? [])),
    outputs: [],
    optionalOutputs,
    outputContracts: [],
    optionalOutputContracts: artifactSurfaces(optionalOutputs),
    capabilities: unique(contracts.flatMap((contract) => contract.capabilities)),
    requiredDownstreamCapabilities: unique(
      contracts.flatMap((contract) => contract.requiredDownstreamCapabilities ?? []),
    ),
    requiredDownstreamConsumes: Object.fromEntries(
      contracts.flatMap((contract) => Object.entries(contract.requiredDownstreamConsumes ?? {})),
    ),
    downstreamContracts: Object.fromEntries(
      Object.entries(downstreamBindings).map(([capability, artifact]) => [capability, artifactSurface(artifact)]),
    ),
  };
}
