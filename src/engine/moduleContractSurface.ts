import { MODULE_CONTRACTS } from "./moduleContracts";

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
  requiredCapabilities: readonly string[];
  outputs: readonly string[];
  optionalOutputs: readonly string[];
  capabilities: readonly string[];
  requiredDownstreamCapabilities: readonly string[];
  requiredDownstreamConsumes: Readonly<Record<string, string>>;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
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
      requiredCapabilities: [],
      outputs: [],
      optionalOutputs: [],
      capabilities: [],
      requiredDownstreamCapabilities: [],
      requiredDownstreamConsumes: {},
    };
  }
  const requiredInputs = unique(contracts.flatMap((contract) => contract.requiredConsumes ?? []));
  const requiredInputSet = new Set(requiredInputs);
  const optionalInputs = unique(
    contracts
      .flatMap((contract) => contract.optionalConsumes ?? [])
      .filter((key) => !requiredInputSet.has(key)),
  );
  return {
    executableIds: executableIds.filter((id) => Boolean(MODULE_CONTRACTS[id])),
    missingExecutableIds: [...missingExecutableIds],
    requiredInputs,
    optionalInputs,
    requiredCapabilities: unique(contracts.flatMap((contract) => contract.requiredCapabilities ?? [])),
    outputs: [],
    optionalOutputs: unique(contracts.flatMap((contract) => contract.optionalProduces ?? [])),
    capabilities: unique(contracts.flatMap((contract) => contract.capabilities)),
    requiredDownstreamCapabilities: unique(
      contracts.flatMap((contract) => contract.requiredDownstreamCapabilities ?? []),
    ),
    requiredDownstreamConsumes: Object.fromEntries(
      contracts.flatMap((contract) => Object.entries(contract.requiredDownstreamConsumes ?? {})),
    ),
  };
}
