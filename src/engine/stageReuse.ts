import { createHash } from "node:crypto";
import type { ModuleManifest } from "./moduleManifest";
import type { ArtifactRef } from "./types";
import { StageReuseReceiptSchema, STAGE_REUSE_RECONCILIATION_MARKER, type StageReuseReceipt, type StageReuseOutputIdentity } from "./stageReuseContract";

/** Match JSON persistence: omitted object fields cannot change after Convex round-trip. */
function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, (item) => stableJson(item ?? null)).join(",")}]`;
  if (typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error("stage reuse identity requires finite, plain JSON data");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function stageReuseHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

/**
 * Worker-local media addresses may move; their durable keys may not. These
 * are exactly the sibling/nested media shapes restored by rehydrateOutputs.
 * This binds storage identity, NOT file-byte integrity (owned by media QA).
 */
function portable(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["json", value];
  const object = value as Record<string, unknown>;
  const isKey = (item: unknown): item is string => typeof item === "string" && item.length > 0 &&
    !/^https?:\/\//i.test(item) && !/^[/\\]/.test(item) && !/^[a-zA-Z]:\\/.test(item);
  const isLocal = (item: unknown): item is string => typeof item === "string" &&
    item.length > 3 && item.length < 400 && !/\s/.test(item) && /^(?:[A-Za-z]:[\\/]|\/)/.test(item);
  return Object.fromEntries(Object.entries(object).filter(([, item]) => item !== undefined).map(([key, item]) => {
    const base = key.replace(/(LocalPath|Url|Path)$/, "");
    const storageKey = base !== key ? object[`${base}Key`] : undefined;
    if (isLocal(item) && isKey(storageKey)) return [key, ["media", storageKey]];
    const keys = key.endsWith("Clips") ? object[`${key.replace(/Clips$/, "")}Keys`] : undefined;
    if (Array.isArray(item) && Array.isArray(keys) && keys.length === item.length &&
        item.every(isLocal) && keys.every(isKey)) {
      return [key, ["media-array", keys]];
    }
    if (Array.isArray(item)) return [key, ["array", item.map((entry) => {
      // Only top-level overlay array entries are materialised by the real
      // rehydrator. Arbitrary nested configuration.path is NOT a media path.
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const overlay = entry as Record<string, unknown>;
        if (isLocal(overlay.path) && isKey(overlay.key)) {
          const { path: _path, ...rest } = overlay;
          void _path;
          return ["overlay", { ...rest, path: ["media", overlay.key] }];
        }
      }
      return ["json", entry];
    })]];
    return [key, ["json", item]];
  }));
}

export interface StageReuseInvocation {
  ownerId: string; runId: string; channelId: string; keyPrefix: string;
  manifest: ModuleManifest;
  params: Readonly<Record<string, unknown>>;
  store: Readonly<Record<string, unknown>>;
  inputRefs: Readonly<Record<string, ArtifactRef>>;
  inputIdentities?: Readonly<Record<string, StageReuseOutputIdentity>>;
}

export function stageInvocationHash(args: StageReuseInvocation): string {
  const { manifest, params, store, inputRefs, inputIdentities, ownerId, runId, channelId, keyPrefix } = args;
  const scope = { ownerId, runId, channelId, keyPrefix };
  const inputs = Object.fromEntries([...new Set([
    ...Object.keys(manifest.consumes), ...Object.keys(manifest.optionalConsumes),
  ])].sort().map((key) => {
    const raw = store[key];
    const projected = manifest.resumeInputProjections?.[key] === "own_block_entry";
    // Legacy whole-string/array repair hints remain whole inputs. Only an
    // explicitly audited map consumer may ignore another block's repair.
    const value = projected && raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)[manifest.id] : raw;
    const identity = projected ? undefined : inputIdentities?.[key];
    const valueHash = value === undefined ? undefined : stageReuseHash(portable({ [key]: value, ...mediaSiblings(key, store) }));
    if (identity && valueHash !== undefined && identity.portablePayloadHash !== valueHash) {
      throw new Error(`input "${key}" changed from its accepted producer output`);
    }
    // A block may persist a content-addressed reference instead of a large
    // optional inline artifact. Only that producer's sealed omission can
    // preserve identity while its existing consumer loads the payload later.
    const effectiveHash = valueHash ?? (identity?.deferred && inputRefs[key] ? identity.portablePayloadHash : undefined);
    return [key, effectiveHash !== undefined
      ? { valueHash: effectiveHash,
        ...(projected ? { projectedInputHash: stageReuseHash(value) } : { ref: inputRefs[key] }) }
      : { absent: true }];
  }));
  const contracts = (record: ModuleManifest["consumes"]) => Object.fromEntries(
    Object.entries(record).map(([key, contract]) => [key, { type: contract.type, version: contract.version }]),
  );
  return stageReuseHash({ scope, moduleId: manifest.id, moduleVersion: manifest.version, params, inputs,
    consumes: contracts(manifest.consumes), optionalConsumes: contracts(manifest.optionalConsumes),
    produces: contracts(manifest.produces), optionalProduces: contracts(manifest.optionalProduces),
    providerProfiles: manifest.providerProfiles, resumeInputProjections: manifest.resumeInputProjections,
    deferredConsumes: manifest.deferredConsumes });
}

/** Cached consumers need no bytes. New execution must understand deferred data. */
export function assertDeferredInputsExecutable(manifest: ModuleManifest, store: Readonly<Record<string, unknown>>,
  identities: Readonly<Record<string, StageReuseOutputIdentity>>): void {
  for (const key of [...Object.keys(manifest.consumes), ...Object.keys(manifest.optionalConsumes)]) {
    if (store[key] === undefined && identities[key]?.deferred && !manifest.deferredConsumes?.includes(key)) {
      throw new Error(`module "${manifest.id}" cannot execute with deferred input "${key}"; materialize it before execution`);
    }
  }
}

export function assertStageInvocationUnchanged(args: StageReuseInvocation, expected: string): void {
  try {
    if (stageInvocationHash(args) !== expected) throw new Error("input or configuration changed");
  } catch (error) {
    throw new Error(`${STAGE_REUSE_RECONCILIATION_MARKER}: module "${args.manifest.id}" mutated its input or configuration during execution: ${error instanceof Error ? error.message : error}`);
  }
}

function mediaSiblings(key: string, store: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const base = key.replace(/(LocalPath|Url|Path)$/, "");
  const sibling = base !== key ? `${base}Key` : key.endsWith("Clips") ? `${key.replace(/Clips$/, "")}Keys` : undefined;
  return sibling && sibling in store ? { [sibling]: store[sibling] } : {};
}

export function sealStageReuseReceipt(invocationHash: string, outputs: Record<string, unknown>, refs: readonly ArtifactRef[], fullOutputs = outputs): StageReuseReceipt {
  const outputRefs = [...refs].sort((a, b) => a.key.localeCompare(b.key));
  const body = { version: "stage-reuse/v1" as const, invocationHash,
    persistedOutputsHash: stageReuseHash(outputs), portableOutputsHash: stageReuseHash(portable(outputs)),
    outputRefs,
    outputIdentities: outputRefs.map(({ key }) => ({ key,
      portablePayloadHash: stageReuseHash(portable({ [key]: fullOutputs[key], ...mediaSiblings(key, fullOutputs) })),
      deferred: fullOutputs[key] !== undefined && outputs[key] === undefined,
    })) };
  return StageReuseReceiptSchema.parse({ ...body, fingerprint: stageReuseHash(body) });
}

export function assertStageReuseReceipt(raw: unknown, invocationHash: string, outputs: Record<string, unknown>): StageReuseReceipt {
  const receipt = StageReuseReceiptSchema.parse(raw);
  const { fingerprint, ...body } = receipt;
  if (fingerprint !== stageReuseHash(body)) throw new Error("cached execution receipt is corrupt");
  if (receipt.invocationHash !== invocationHash) throw new Error("cached execution inputs, configuration or module contract changed");
  if (receipt.persistedOutputsHash !== stageReuseHash(outputs)) throw new Error("cached execution outputs changed");
  if (new Set(receipt.outputRefs.map((ref) => ref.key)).size !== receipt.outputRefs.length) {
    throw new Error("cached execution repeats an output identity");
  }
  if (receipt.outputIdentities.length !== receipt.outputRefs.length ||
      new Set(receipt.outputIdentities.map((entry) => entry.key)).size !== receipt.outputRefs.length ||
      receipt.outputIdentities.some((entry) => !receipt.outputRefs.some((ref) => ref.key === entry.key))) {
    throw new Error("cached execution has inconsistent output materialization identities");
  }
  for (const identity of receipt.outputIdentities) {
    const key = identity.key;
    if (identity.deferred ? outputs[key] !== undefined : outputs[key] === undefined) {
      throw new Error("cached execution changed its declared materialization shape");
    }
    if (!identity.deferred && identity.portablePayloadHash !== stageReuseHash(portable({ [key]: outputs[key], ...mediaSiblings(key, outputs) }))) {
      throw new Error("cached output does not match its portable payload identity");
    }
  }
  return receipt;
}

export function assertRestoredStageOutputs(receipt: StageReuseReceipt, outputs: Record<string, unknown>): void {
  if (receipt.portableOutputsHash !== stageReuseHash(portable(outputs))) {
    throw new Error("artifact restoration changed content beyond worker-local media addresses");
  }
}
