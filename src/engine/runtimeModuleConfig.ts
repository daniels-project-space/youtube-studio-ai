import { resolveKnobs } from "./customization";
import { moduleSurface } from "./moduleRegistry";
import type { PipelineEntry } from "./types";

export type RuntimeModuleConfig = Readonly<Record<string, unknown>>;

export interface RuntimeModuleConfigMerge {
  /** Immutable copy of the first effective params for every selected block. */
  readonly paramsByBlock: Readonly<Record<string, Record<string, unknown>>>;
  /**
   * The exact validated configuration that readers receive from the frozen
   * invocation. It includes supported virtual modules such as `show-bible`,
   * which configure execution but are not literal pipeline blocks.
   */
  readonly frozenModuleConfig: Readonly<Record<string, Record<string, unknown>>>;
  /** Configured blocks that are intentionally absent from this frozen pipeline. */
  readonly skippedBlockIds: readonly string[];
  /** Pipeline or virtual modules whose settings were validated for this run. */
  readonly applied: readonly Readonly<{
    blockId: string;
    knobCount: number;
    preset?: string;
    virtual?: true;
  }>[];
}

/**
 * These controls are intentionally channel-level configuration rather than a
 * literal operation in the graph. They still affect execution and therefore
 * must be validated and frozen with every invocation.
 */
const VIRTUAL_RUNTIME_MODULE_IDS = new Set(["show-bible"]);

/**
 * These values are set by the sealed Program Brief, selected route, and
 * family length contract. A module configuration can refine execution, but it
 * must never reopen the channel-format decision after pipeline design.
 *
 * Keep this list deliberately narrow: presentation and craft controls remain
 * configurable, while duration, serialized-program, and canonical panel
 * structure stay route owned.
 */
export const ROUTE_OWNED_RUNTIME_PARAM_KEYS: Readonly<Record<string, readonly string[]>> = {
  topic_select: ["targetSeconds", "seriesTitle", "seriesCount"],
  director_brief: ["targetSeconds"],
  dp_brief: ["targetSeconds"],
  editor_brief: ["targetSeconds"],
  composer_brief: ["targetSeconds"],
  critic_spec: ["targetSeconds"],
  script_gen: ["maxSeconds"],
  length_check: ["minSeconds", "maxSeconds"],
  assemble: ["durationSec"],
  whiteboard_scribe: ["targetSeconds"],
  lore_short: ["targetSeconds"],
  motion_comic: ["targetSeconds", "panels"],
  quiz_year: ["targetSeconds"],
  short_strategy: ["targetSeconds"],
  documotion_short: ["targetSeconds"],
};

function assertRouteOwnedRuntimeConfig(input: {
  readonly blockId: string;
  readonly config: Readonly<Record<string, unknown>>;
}): void {
  for (const key of ROUTE_OWNED_RUNTIME_PARAM_KEYS[input.blockId] ?? []) {
    if (!(key in input.config)) continue;
    throw new Error(
      `moduleConfig[${input.blockId}].${key} cannot set a route-owned format value; change the channel Program Brief or selected route instead`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneParams(value: Readonly<Record<string, Record<string, unknown>>>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value).map(([blockId, params]) => [blockId, { ...params }]),
  );
}

/**
 * Applies the mutable channel module configuration exactly once, before the
 * invocation is frozen. A selected module can never silently fall back to its
 * defaults because an operator typo or stale value was ignored.
 *
 * Modules without a registered customization surface may still own narrow
 * runtime-only parameters (for example a generation profile); those values
 * remain opaque here and are validated by their exact block boundary.
 */
export function mergeRuntimeModuleConfig(input: {
  readonly entries: readonly PipelineEntry[];
  readonly paramsByBlock: Readonly<Record<string, Record<string, unknown>>>;
  readonly moduleConfig?: unknown;
}): RuntimeModuleConfigMerge {
  const paramsByBlock = cloneParams(input.paramsByBlock);
  if (input.moduleConfig === undefined) {
    return { paramsByBlock, frozenModuleConfig: {}, skippedBlockIds: [], applied: [] };
  }
  if (!isRecord(input.moduleConfig)) {
    throw new Error("channel moduleConfig must be an object keyed by a selected or supported virtual module id");
  }

  const selected = new Set(input.entries.map((entry) => entry.block));
  const skippedBlockIds: string[] = [];
  const applied: RuntimeModuleConfigMerge["applied"][number][] = [];
  const frozenModuleConfig: Record<string, Record<string, unknown>> = {};
  for (const [blockId, rawConfig] of Object.entries(input.moduleConfig)) {
    const virtual = VIRTUAL_RUNTIME_MODULE_IDS.has(blockId);
    if (!selected.has(blockId) && !virtual) {
      skippedBlockIds.push(blockId);
      continue;
    }
    if (!isRecord(rawConfig)) {
      throw new Error(`moduleConfig[${blockId}] must be an object`);
    }
    assertRouteOwnedRuntimeConfig({ blockId, config: rawConfig });

    const { preset: rawPreset, ...overrides } = rawConfig;
    if (rawPreset !== undefined && (typeof rawPreset !== "string" || !rawPreset.trim())) {
      throw new Error(`moduleConfig[${blockId}].preset must be a non-empty string when supplied`);
    }
    const preset = typeof rawPreset === "string" ? rawPreset : undefined;
    const surface = moduleSurface(blockId);
    let values: Record<string, unknown>;
    if (surface) {
      // The persisted row is untrusted JSON. `resolveKnobs` immediately
      // validates every value against the surface before it can be returned.
      const resolved = resolveKnobs(
        surface,
        preset,
        overrides as Parameters<typeof resolveKnobs>[2],
      );
      if (!resolved.ok) {
        throw new Error(`moduleConfig[${blockId}] is invalid: ${resolved.errors.join("; ")}`);
      }
      // Freeze only values the operator actually chose. Defaults remain owned
      // by the block's existing contract instead of becoming noisy overrides.
      const chosen = new Set([
        ...(preset ? Object.keys(surface.presets[preset] ?? {}) : []),
        ...Object.keys(overrides),
      ]);
      values = Object.fromEntries(
        Object.entries(resolved.values as Record<string, unknown>).filter(([key]) => chosen.has(key)),
      );
    } else {
      // Persisted channel configuration is operator-controlled input. A module
      // without a declared surface has no schema through which its values can
      // be safely interpreted, so it cannot accept a runtime override merely
      // because it happens to be selected in the pipeline.
      throw new Error(`moduleConfig[${blockId}] targets a non-configurable module with no customization surface`);
    }

    // Keep the declarative preset as well as its resolved explicit values. The
    // crew resolver consumes the frozen virtual Show-Bible config directly;
    // replaying the preset plus its already-validated values is deterministic.
    frozenModuleConfig[blockId] = {
      ...(preset ? { preset } : {}),
      ...values,
    };
    if (!virtual) {
      paramsByBlock[blockId] = { ...(paramsByBlock[blockId] ?? {}), ...values };
    }
    applied.push({
      blockId,
      knobCount: Object.keys(values).length,
      ...(preset ? { preset } : {}),
      ...(virtual ? { virtual: true as const } : {}),
    });
  }
  return {
    paramsByBlock,
    frozenModuleConfig,
    skippedBlockIds: [...skippedBlockIds].sort(),
    applied,
  };
}
