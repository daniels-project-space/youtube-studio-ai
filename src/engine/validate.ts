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
  const producedKeys: string[] = [];
  const producerOf = new Map<string, string>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const manifest = getManifest(entry.block);
    if (!manifest) {
      throw new PipelineValidationError(
        `step ${i} references unknown block "${entry.block}" (not in registry)`,
      );
    }
    const block = manifest.block;

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
    try {
      return total + configuredMaxCostUsd(manifest, resolved.entries[index].params ?? {}, {
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
