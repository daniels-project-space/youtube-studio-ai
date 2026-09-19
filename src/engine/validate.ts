/**
 * Pipeline validation + preflight (MASTER-PLAN §D).
 *
 * - validatePipeline: topological check that every block's `consumes` is
 *   produced by an UPSTREAM block in pipeline order. Rejects loud on mismatch,
 *   unknown blocks, or duplicate produced keys.
 * - preflight: asserts required runtime keys are present + a budget is set
 *   (and per-paid-block readiness), before any paid block can spend.
 */
import type { Block, PipelineEntry } from "./types";
import { getManifest } from "./registry";
import { configuredMaxCostUsd, type ModuleManifest } from "./moduleManifest";

export class PipelineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineValidationError";
  }
}

export class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreflightError";
  }
}

export interface ResolvedPipeline {
  blocks: Block[];
  manifests: ModuleManifest[];
  entries: PipelineEntry[];
  /** All keys produced across the pipeline, in order of first production. */
  producedKeys: string[];
}

function isExplicitArtifactReplacement(
  key: string,
  previousProducer: string,
  nextProducer: string,
): boolean {
  // intro_card reports whether its standalone asset rendered; the legacy lofi
  // assembler then reports whether that asset was actually prepended (or its
  // deblur intro was applied). The latter is intentionally authoritative.
  return key === "introApplied" && previousProducer === "intro_card" && nextProducer === "assemble";
}

/**
 * Topologically validate an ordered pipeline. Because the pipeline is already
 * an ordered list, the topological constraint reduces to: at the point each
 * block runs, every key it consumes must already have been produced by an
 * earlier block (or be a declared seed input).
 *
 * @param entries  ordered pipeline entries from a channel
 * @param seeds    keys assumed present before the pipeline starts (e.g. channel config)
 */
export function validatePipeline(
  entries: PipelineEntry[],
  seeds: string[] = [],
): ResolvedPipeline {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new PipelineValidationError("pipeline is empty");
  }

  const blocks: Block[] = [];
  const manifests: ModuleManifest[] = [];
  const available = new Set<string>(seeds);
  const availableCapabilities = new Set<string>();
  const capabilityProducedAt = new Map<string, number>();
  const producedKeys: string[] = [];
  const producerOf = new Map<string, string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.version !== undefined && (typeof entry.version !== "string" || !entry.version.trim())) {
      throw new PipelineValidationError(
        `step ${i} block "${entry.block}" version must be a non-empty string`,
      );
    }
    const manifest = getManifest(entry.block, entry.version);
    if (!manifest) {
      throw new PipelineValidationError(
        `step ${i} references unknown block "${entry.block}"` +
          (entry.version === undefined ? "" : ` version "${entry.version}"`) + " (not in registry)",
      );
    }
    const block = manifest.block;

    // A module may require a capability as well as the concrete artifact keys
    // it consumes. This prevents a look-alike patch from satisfying a key
    // name while skipping the upstream module that owns its policy/quality
    // contract. Payload transfer remains explicit below through `consumes`.
    for (const capability of manifest.requiredCapabilities) {
      if (!availableCapabilities.has(capability)) {
        throw new PipelineValidationError(
          `block "${block.id}" (step ${i}) requires upstream capability "${capability}"`,
        );
      }
    }

    // Every consumed key must be produced upstream (or be a seed).
    for (const need of Object.keys(manifest.consumes)) {
      if (!available.has(need)) {
        throw new PipelineValidationError(
          `block "${block.id}" (step ${i}) consumes "${need}" which is not produced by any upstream block` +
            (seeds.length ? ` or seed [${seeds.join(", ")}]` : ""),
        );
      }
    }

    // Register this block's produced keys; reject duplicate producers (loud).
    for (const out of [
      ...Object.keys(manifest.produces),
      ...Object.keys(manifest.optionalProduces),
    ]) {
      if (producerOf.has(out)) {
        const previousProducer = producerOf.get(out)!;
        if (!isExplicitArtifactReplacement(out, previousProducer, block.id)) {
          throw new PipelineValidationError(
            `key "${out}" produced by both "${previousProducer}" and "${block.id}" (duplicate producer)`,
          );
        }
        producerOf.set(out, block.id);
        continue;
      }
      producerOf.set(out, block.id);
      available.add(out);
      producedKeys.push(out);
    }

    blocks.push(block);
    manifests.push(manifest);
    for (const capability of manifest.capabilities) {
      availableCapabilities.add(capability);
      capabilityProducedAt.set(capability, i);
    }
  }

  // An output handoff is not allowed to become inert configuration. When a
  // module says its job requires a specialised later consumer, the exact
  // consumer capability must appear after it in the same compiled graph.
  for (const [index, manifest] of manifests.entries()) {
    for (const capability of manifest.requiredDownstreamCapabilities) {
      const handoffArtifact = manifest.requiredDownstreamConsumes[capability];
      const consumerIndex = manifests.findIndex((candidate, candidateIndex) =>
        candidateIndex > index &&
        candidate.capabilities.includes(capability) &&
        (handoffArtifact in candidate.consumes || handoffArtifact in candidate.optionalConsumes),
      );
      if (consumerIndex < 0) {
        const capabilityIndex = capabilityProducedAt.get(capability);
        const detail = capabilityIndex === undefined || capabilityIndex <= index
          ? `downstream capability "${capability}"`
          : `downstream capability "${capability}" consuming "${handoffArtifact}"`;
        throw new PipelineValidationError(
          `block "${manifest.id}" (step ${index}) requires ${detail}`,
        );
      }
    }
  }

  return { blocks, manifests, entries, producedKeys };
}

export interface PreflightInput {
  /** Per-run budget ceiling in USD; must be > 0 when any paid block exists. */
  budgetUsd: number;
  /** Env/secret key names that must be present for this run. */
  requiredKeys?: string[];
  /** A lookup the caller provides for required-key presence (e.g. process.env). */
  hasKey?: (name: string) => boolean;
}

const PROMPT_PARAM_KEY = /^(?:system|user|positive|negative|image|motion|text|generation)Prompt$|^instructions?$/i;
const PROMPT_SHAPED_PARAM_KEY = /prompt/i;
const PROVIDER_SELECTOR_KEY = /^(model|modelId|provider|providerId|route|engine)$/i;
const MAX_PARAMETER_STRING_LENGTH = 120_000;

/**
 * Validate the JSON-shaped knobs that a paid module will hand to a provider.
 *
 * Provider adapters should still validate their own domain-specific request,
 * but they must never be the first place we discover an empty prompt,
 * non-finite numeric knob, or an empty model/provider selector: by then a
 * remote child may already have been created. This walk is deliberately
 * narrow and deterministic, and does not rewrite or default operator input.
 */
function assertPaidParamsSafe(
  blockId: string,
  value: unknown,
  path = "params",
  seen = new Set<object>(),
  nodes = { count: 0 },
): void {
  nodes.count++;
  if (nodes.count > 20_000) {
    throw new PreflightError(`paid block "${blockId}" parameters are too deeply nested`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PreflightError(`paid block "${blockId}" has non-finite parameter at ${path}`);
    }
    return;
  }
  if (value === null || typeof value === "boolean" || typeof value === "undefined") return;
  if (typeof value === "string") {
    if (value.length > MAX_PARAMETER_STRING_LENGTH) {
      throw new PreflightError(
        `paid block "${blockId}" parameter at ${path} exceeds ${MAX_PARAMETER_STRING_LENGTH} characters`,
      );
    }
    return;
  }
  if (typeof value !== "object") {
    throw new PreflightError(`paid block "${blockId}" has unsupported parameter type at ${path}`);
  }
  if (seen.has(value)) {
    throw new PreflightError(`paid block "${blockId}" parameters contain a circular value at ${path}`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPaidParamsSafe(blockId, entry, `${path}[${index}]`, seen, nodes));
    seen.delete(value);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (PROMPT_PARAM_KEY.test(key)) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        throw new PreflightError(
          `paid block "${blockId}" requires a non-empty string at ${childPath}`,
        );
      }
    } else if (PROMPT_SHAPED_PARAM_KEY.test(key) && entry !== undefined && entry !== null && typeof entry !== "string") {
      // Generic `prompt` knobs are allowed to be omitted/empty because some
      // modules intentionally synthesize a default from upstream style DNA;
      // when supplied, however, they must still be text rather than an object
      // that a provider adapter would stringify unpredictably.
      throw new PreflightError(`paid block "${blockId}" requires a string at ${childPath}`);
    }
    if (PROVIDER_SELECTOR_KEY.test(key)) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        throw new PreflightError(
          `paid block "${blockId}" requires a non-empty provider/model selector at ${childPath}`,
        );
      }
    }
    assertPaidParamsSafe(blockId, entry, childPath, seen, nodes);
  }
  seen.delete(value);
}

/**
 * Preflight a resolved pipeline before execution. Fails loud if a paid block
 * exists without a budget, or if any required key is missing.
 */
export function preflight(
  resolved: ResolvedPipeline,
  input: PreflightInput,
): void {
  const paidIndexes = resolved.manifests
    .map((manifest, index) => (manifest.costAndLatency.paid ? index : -1))
    .filter((index) => index >= 0);
  const hasPaid = paidIndexes.length > 0;
  if (hasPaid && (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0)) {
    throw new PreflightError(
      "pipeline contains paid blocks but no positive budget ceiling is set",
    );
  }

  // Reserve the compiler-declared worst case before the first paid provider
  // call. Runtime cost accounting still stops unexpected overages, but doing
  // that only after a provider has charged us is too late to be a spend rail.
  // A paid module without a finite envelope is therefore not executable.
  const reservedMaxCostUsd = paidIndexes.reduce((total, index) => {
    const manifest = resolved.manifests[index];
    const params = resolved.entries[index].params ?? {};
    assertPaidParamsSafe(manifest.id, params);
    try {
      return total + configuredMaxCostUsd(manifest, params, {
        entries: resolved.entries,
        index,
      });
    } catch (error) {
      throw new PreflightError(error instanceof Error ? error.message : String(error));
    }
  }, 0);
  if (hasPaid && reservedMaxCostUsd > input.budgetUsd + Number.EPSILON) {
    throw new PreflightError(
      `pipeline reserves up to $${reservedMaxCostUsd.toFixed(2)} but the per-video budget is $${input.budgetUsd.toFixed(2)}`,
    );
  }

  const required = input.requiredKeys ?? [];
  if (required.length > 0) {
    const has = input.hasKey ?? ((n: string) => Boolean(process.env[n]));
    const missing = required.filter((k) => !has(k));
    if (missing.length > 0) {
      throw new PreflightError(
        `missing required keys: ${missing.join(", ")}`,
      );
    }
  }
}
