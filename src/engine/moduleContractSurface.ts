import type { ModuleManifest } from "./moduleManifest";
import { GENERATED_MODULE_ABI } from "./generatedModuleAbi";
import { artifactContract } from "./artifactSchemas";

export interface ModuleArtifactSurface {
  key: string;
  type: string;
  version: string;
  persist: "inline" | "reference" | "summary";
  opaque: boolean;
}

export interface ModuleAbiEntry {
  requiredInputs: string[];
  optionalInputs: string[];
  outputs: string[];
  optionalOutputs: string[];
  requiredCapabilities: string[];
  capabilities: string[];
  requiredDownstreamCapabilities: string[];
  requiredDownstreamConsumes: Record<string, string>;
}

export interface ModuleAbiIndex {
  artifacts: Record<string, ModuleArtifactSurface>;
  modules: Record<string, ModuleAbiEntry>;
}

/** The operator-safe projection of the exact executable manifests. */
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

function artifactKeys(entries: readonly ModuleAbiEntry[], field: "requiredInputs" | "optionalInputs" | "outputs" | "optionalOutputs"): string[] {
  return unique(entries.flatMap((entry) => entry[field]));
}

/** Stable projection shared by the generator and drift test. */
export function moduleAbiFromManifests(manifests: readonly ModuleManifest[]): ModuleAbiIndex {
  const artifacts: Record<string, ModuleArtifactSurface> = {};
  const addArtifacts = (items: Readonly<Record<string, ModuleArtifactSurface>>) => {
    for (const [key, artifact] of Object.entries(items)) {
      const { type, version, persist, opaque } = artifact;
      artifacts[key] = { key, type, version, persist, opaque };
    }
  };
  const modules = Object.fromEntries(manifests
    .map((manifest) => [manifest.id, {
      requiredInputs: Object.keys(manifest.consumes).sort((a, b) => a.localeCompare(b)),
      optionalInputs: Object.keys(manifest.optionalConsumes).sort((a, b) => a.localeCompare(b)),
      outputs: Object.keys(manifest.produces).sort((a, b) => a.localeCompare(b)),
      optionalOutputs: Object.keys(manifest.optionalProduces).sort((a, b) => a.localeCompare(b)),
      requiredCapabilities: unique(manifest.requiredCapabilities),
      capabilities: unique(manifest.capabilities),
      requiredDownstreamCapabilities: unique(manifest.requiredDownstreamCapabilities),
      requiredDownstreamConsumes: { ...manifest.requiredDownstreamConsumes },
    } satisfies ModuleAbiEntry] as const)
    .sort(([a], [b]) => a.localeCompare(b)));
  for (const manifest of manifests) {
    addArtifacts(manifest.consumes);
    addArtifacts(manifest.optionalConsumes);
    addArtifacts(manifest.produces);
    addArtifacts(manifest.optionalProduces);
    for (const key of Object.values(manifest.requiredDownstreamConsumes)) {
      const { key: artifactKey, type, version, persist, opaque } = artifactContract(key);
      artifacts[artifactKey] = { key: artifactKey, type, version, persist, opaque };
    }
  }
  return {
    artifacts: Object.fromEntries(Object.entries(artifacts).sort(([a], [b]) => a.localeCompare(b))),
    modules,
  };
}

export function moduleContractSurface(
  executableIds: readonly string[],
): ModuleContractSurface | undefined {
  if (!executableIds.length) return undefined;
  const entries = executableIds
    .map((id) => GENERATED_MODULE_ABI.modules[id])
    .filter((entry): entry is ModuleAbiEntry => Boolean(entry));
  const missingExecutableIds = executableIds.filter((id) => !GENERATED_MODULE_ABI.modules[id]);
  const requiredInputs = unique(entries.flatMap((entry) => entry.requiredInputs));
  const requiredInputSet = new Set(requiredInputs);
  const optionalInputs = unique(entries.flatMap((entry) => entry.optionalInputs)
    .filter((key) => !requiredInputSet.has(key)));
  const outputs = unique(entries.flatMap((entry) => entry.outputs));
  const requiredOutputSet = new Set(outputs);
  const optionalOutputs = unique(entries.flatMap((entry) => entry.optionalOutputs)
    .filter((key) => !requiredOutputSet.has(key)));
  const downstreamBindings = Object.fromEntries(entries.flatMap((entry) => Object.entries(entry.requiredDownstreamConsumes)));
  return {
    executableIds: entries.length
      ? executableIds.filter((id) => Boolean(GENERATED_MODULE_ABI.modules[id]))
      : [...executableIds],
    missingExecutableIds: [...missingExecutableIds],
    requiredInputs,
    optionalInputs,
    requiredInputContracts: artifactKeys(entries, "requiredInputs").filter((key) => requiredInputSet.has(key)).map((key) => GENERATED_MODULE_ABI.artifacts[key]!),
    optionalInputContracts: artifactKeys(entries, "optionalInputs").filter((key) => optionalInputs.includes(key)).map((key) => GENERATED_MODULE_ABI.artifacts[key]!),
    requiredCapabilities: unique(entries.flatMap((entry) => entry.requiredCapabilities)),
    outputs,
    optionalOutputs,
    outputContracts: artifactKeys(entries, "outputs").filter((key) => requiredOutputSet.has(key)).map((key) => GENERATED_MODULE_ABI.artifacts[key]!),
    optionalOutputContracts: artifactKeys(entries, "optionalOutputs").filter((key) => optionalOutputs.includes(key)).map((key) => GENERATED_MODULE_ABI.artifacts[key]!),
    capabilities: unique(entries.flatMap((entry) => entry.capabilities)),
    requiredDownstreamCapabilities: unique(entries.flatMap((entry) => entry.requiredDownstreamCapabilities)),
    requiredDownstreamConsumes: downstreamBindings,
    downstreamContracts: Object.fromEntries(Object.entries(downstreamBindings).map(([capability, key]) => [capability, GENERATED_MODULE_ABI.artifacts[key]])),
  };
}
