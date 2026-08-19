/**
 * Run-scoped accounting for model calls.
 *
 * Providers must report their real usage here. Missing usage is kept visible as
 * unpriced; this module never guesses tokens from prompt length. The scope also
 * owns a short-lived response memo so an outer block retry can reuse a valid,
 * already-paid response instead of buying the identical response again.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

export type ModelCallKind =
  | "text"
  | "vision"
  | "audio"
  | "video"
  | "embedding"
  | "other";

export interface ModelUsageRecord {
  provider: string;
  model: string;
  kind: ModelCallKind;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  audioInputTokens?: number;
  cachedAudioInputTokens?: number;
  totalTokens?: number;
  /** A real provider charge exists, but its amount is absent/indeterminate. */
  unpricedReason?: string;
  /** Token cost is priceable, but an additional provider fee is not. */
  additionalUnpricedReason?: string;
}

export interface ModelUsageGroup {
  provider: string;
  model: string;
  kind: ModelCallKind;
  calls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  /** Exact known token charge at the configured/current public rate. */
  costUsd: number;
  unpricedCalls: number;
  unpricedReasons: string[];
}

export interface ModelUsageSummary {
  calls: number;
  cacheHits: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  /** Exact known token charge. May be a lower bound when unpricedCalls > 0. */
  costUsd: number;
  unpricedCalls: number;
  groups: ModelUsageGroup[];
}

interface ModelRate {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number;
  audioInputUsdPerMillion?: number;
  cachedAudioInputUsdPerMillion?: number;
}

interface ScopeState {
  groups: Map<string, ModelUsageGroup>;
  responses: Map<string, unknown>;
}

const storage = new AsyncLocalStorage<ScopeState>();

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function normalizeModel(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(/^(?:google|anthropic)\//, "");
}

function validRate(value: unknown): ModelRate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const input = finiteNonNegative(row.inputUsdPerMillion);
  const output = finiteNonNegative(row.outputUsdPerMillion);
  if (input === undefined || output === undefined) return undefined;
  const cached = finiteNonNegative(row.cachedInputUsdPerMillion);
  const audio = finiteNonNegative(row.audioInputUsdPerMillion);
  const cachedAudio = finiteNonNegative(row.cachedAudioInputUsdPerMillion);
  return {
    inputUsdPerMillion: input,
    outputUsdPerMillion: output,
    ...(cached !== undefined ? { cachedInputUsdPerMillion: cached } : {}),
    ...(audio !== undefined ? { audioInputUsdPerMillion: audio } : {}),
    ...(cachedAudio !== undefined ? { cachedAudioInputUsdPerMillion: cachedAudio } : {}),
  };
}

function overrideRate(provider: string, model: string): ModelRate | undefined {
  const raw = process.env.MODEL_PRICE_OVERRIDES_JSON;
  if (!raw) return undefined;
  try {
    const rows = JSON.parse(raw) as Record<string, unknown>;
    return validRate(rows[`${provider.toLowerCase()}:${normalizeModel(model)}`]);
  } catch {
    // A bad override must not turn into fabricated zero-cost accounting. The
    // call remains unpriced and its summary makes the configuration gap loud.
    return undefined;
  }
}

/** Current standard-list token rates for models actually used by this app. */
function builtInRate(provider: string, model: string, inputTokens: number): ModelRate | undefined {
  const p = provider.toLowerCase();
  const m = normalizeModel(model);
  if (p === "gemini" || p === "google") {
    if (m === "gemini-2.5-flash" || /^gemini-2\.5-flash-\d/.test(m)) {
      return {
        inputUsdPerMillion: 0.3,
        audioInputUsdPerMillion: 1,
        outputUsdPerMillion: 2.5,
        cachedInputUsdPerMillion: 0.03,
        cachedAudioInputUsdPerMillion: 0.1,
      };
    }
    if (m.startsWith("gemini-2.5-pro")) {
      return inputTokens > 200_000
        ? { inputUsdPerMillion: 2.5, outputUsdPerMillion: 15, cachedInputUsdPerMillion: 0.25 }
        : { inputUsdPerMillion: 1.25, outputUsdPerMillion: 10, cachedInputUsdPerMillion: 0.125 };
    }
    if (m.startsWith("gemini-3.1-pro-preview")) {
      return inputTokens > 200_000
        ? { inputUsdPerMillion: 4, outputUsdPerMillion: 18, cachedInputUsdPerMillion: 0.4 }
        : { inputUsdPerMillion: 2, outputUsdPerMillion: 12, cachedInputUsdPerMillion: 0.2 };
    }
  }
  // First-party Claude API pricing. Keep this exact model family explicit so
  // an unknown provider revision never turns into an invented zero cost.
  if (p === "anthropic") {
    if (m === "claude-sonnet-4-5-20250929" || m === "claude-sonnet-4.5") {
      return { inputUsdPerMillion: 3, outputUsdPerMillion: 15, cachedInputUsdPerMillion: 0.3 };
    }
  }
  // Exact OpenRouter rates for the pinned, non-Google YouTube fleet. Model
  // overrides are intentionally not priced here: an unknown override must show
  // as unpriced rather than appearing cheaper than it is.
  if (p === "openrouter") {
    if (m === "openai/gpt-oss-20b") return { inputUsdPerMillion: 0.03, outputUsdPerMillion: 0.13 };
    if (m === "mistralai/ministral-3b-2512") return { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.1, cachedInputUsdPerMillion: 0.01 };
    if (m === "mistralai/ministral-8b-2512") return { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.15, cachedInputUsdPerMillion: 0.015 };
    if (m === "qwen/qwen3.6-27b") return { inputUsdPerMillion: 0.289, outputUsdPerMillion: 2.4 };
  }
  if (p === "groq") {
    if (m === "qwen/qwen3.6-27b") {
      return { inputUsdPerMillion: 0.6, outputUsdPerMillion: 3 };
    }
    // Kept only so historical/explicit overrides of the now-retired model are
    // accounted while operators migrate to the current default.
    if (m === "meta-llama/llama-4-scout-17b-16e-instruct") {
      return { inputUsdPerMillion: 0.11, outputUsdPerMillion: 0.34 };
    }
  }
  return undefined;
}

export function priceModelUsage(record: ModelUsageRecord): {
  costUsd?: number;
  unpricedReason?: string;
} {
  if (record.unpricedReason) return { unpricedReason: record.unpricedReason };
  const input = finiteNonNegative(record.inputTokens);
  const output = finiteNonNegative(record.outputTokens);
  const reasoning = finiteNonNegative(record.reasoningTokens) ?? 0;
  if (input === undefined || output === undefined) {
    return { unpricedReason: "provider response omitted token usage" };
  }
  const rate =
    overrideRate(record.provider, record.model) ??
    builtInRate(record.provider, record.model, input);
  if (!rate) return { unpricedReason: `no exact rate configured for ${record.provider}:${record.model}` };

  const cached = Math.min(input, finiteNonNegative(record.cachedInputTokens) ?? 0);
  const audio = Math.min(input, finiteNonNegative(record.audioInputTokens) ?? 0);
  const cachedAudio = Math.min(audio, cached, finiteNonNegative(record.cachedAudioInputTokens) ?? 0);
  if (audio > 0 && rate.audioInputUsdPerMillion === undefined) {
    return { unpricedReason: `audio-input rate unavailable for ${record.provider}:${record.model}` };
  }
  const uncachedAudio = Math.max(0, audio - cachedAudio);
  const uncachedNonAudio = Math.max(0, input - cached - uncachedAudio);
  const cachedNonAudio = Math.max(0, cached - cachedAudio);
  const cachedRate = rate.cachedInputUsdPerMillion ?? rate.inputUsdPerMillion;
  const cachedAudioRate = rate.cachedAudioInputUsdPerMillion ?? rate.audioInputUsdPerMillion ?? cachedRate;
  const dollars =
    (uncachedNonAudio * rate.inputUsdPerMillion +
      uncachedAudio * (rate.audioInputUsdPerMillion ?? rate.inputUsdPerMillion) +
      cachedNonAudio * cachedRate +
      cachedAudio * cachedAudioRate +
      (output + reasoning) * rate.outputUsdPerMillion) /
    1_000_000;
  return { costUsd: dollars };
}

function groupKey(provider: string, model: string, kind: ModelCallKind): string {
  return `${provider.toLowerCase()}\u0000${normalizeModel(model)}\u0000${kind}`;
}

function groupFor(state: ScopeState, details: Pick<ModelUsageRecord, "provider" | "model" | "kind">): ModelUsageGroup {
  const key = groupKey(details.provider, details.model, details.kind);
  const existing = state.groups.get(key);
  if (existing) return existing;
  const created: ModelUsageGroup = {
    provider: details.provider.toLowerCase(),
    model: normalizeModel(details.model),
    kind: details.kind,
    calls: 0,
    cacheHits: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    unpricedCalls: 0,
    unpricedReasons: [],
  };
  state.groups.set(key, created);
  return created;
}

/** Record one successful provider response. No-op outside a usage scope. */
export function recordModelUsage(record: ModelUsageRecord): void {
  const state = storage.getStore();
  if (!state) return;
  const group = groupFor(state, record);
  const input = finiteNonNegative(record.inputTokens) ?? 0;
  const output = finiteNonNegative(record.outputTokens) ?? 0;
  const reasoning = finiteNonNegative(record.reasoningTokens) ?? 0;
  const cached = finiteNonNegative(record.cachedInputTokens) ?? 0;
  group.calls++;
  group.inputTokens += input;
  group.outputTokens += output;
  group.reasoningTokens += reasoning;
  group.cachedInputTokens += cached;
  group.totalTokens += finiteNonNegative(record.totalTokens) ?? input + output + reasoning;
  const priced = priceModelUsage(record);
  if (priced.costUsd !== undefined) group.costUsd += priced.costUsd;
  const unpricedReason = priced.unpricedReason ?? record.additionalUnpricedReason;
  if (unpricedReason) {
    group.unpricedCalls++;
    if (!group.unpricedReasons.includes(unpricedReason)) {
      group.unpricedReasons.push(unpricedReason);
    }
  }
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`).join(",")}}`;
}

export function modelRequestCacheKey(provider: string, model: string, request: unknown): string {
  return createHash("sha256")
    .update(provider.toLowerCase())
    .update("\u0000")
    .update(normalizeModel(model))
    .update("\u0000")
    .update(stableJson(request))
    .digest("hex");
}

export function getCachedModelResponse<T>(
  key: string,
  details: Pick<ModelUsageRecord, "provider" | "model" | "kind">,
): T | undefined {
  const state = storage.getStore();
  if (!state || !state.responses.has(key)) return undefined;
  groupFor(state, details).cacheHits++;
  return state.responses.get(key) as T;
}

export function cacheModelResponse(key: string, value: unknown): void {
  storage.getStore()?.responses.set(key, value);
}

function snapshot(state: ScopeState): ModelUsageSummary {
  const groups = [...state.groups.values()]
    .map((group) => ({ ...group, unpricedReasons: [...group.unpricedReasons] }))
    .sort((a, b) => groupKey(a.provider, a.model, a.kind).localeCompare(groupKey(b.provider, b.model, b.kind)));
  return groups.reduce<ModelUsageSummary>(
    (sum, group) => ({
      calls: sum.calls + group.calls,
      cacheHits: sum.cacheHits + group.cacheHits,
      inputTokens: sum.inputTokens + group.inputTokens,
      outputTokens: sum.outputTokens + group.outputTokens,
      reasoningTokens: sum.reasoningTokens + group.reasoningTokens,
      cachedInputTokens: sum.cachedInputTokens + group.cachedInputTokens,
      totalTokens: sum.totalTokens + group.totalTokens,
      costUsd: sum.costUsd + group.costUsd,
      unpricedCalls: sum.unpricedCalls + group.unpricedCalls,
      groups,
    }),
    {
      calls: 0,
      cacheHits: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      unpricedCalls: 0,
      groups,
    },
  );
}

export function createModelUsageScope(): {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  snapshot: () => ModelUsageSummary;
} {
  const state: ScopeState = { groups: new Map(), responses: new Map() };
  return {
    run: <T>(fn: () => Promise<T>) => storage.run(state, fn),
    snapshot: () => snapshot(state),
  };
}
