/**
 * Legacy on-demand H3 receipt reconciliation. New paid dispatch is held until
 * Render Engine has a qualified native profile and terminal receipt route.
 */
import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  miniMaxH3RequestKey,
  type MiniMaxH3RenderRequest,
} from "@/lib/minimaxH3";
import {
  MiniMaxH3OpeningMotionQaEvidenceSchema,
  type MiniMaxH3OpeningMotionQaEvidence,
} from "@/engine/cinematicClipReview";
import { getObjectBytes } from "@/lib/storage";
import { sha256BytesHex } from "@/lib/sha256";

export interface MiniMaxH3OnDemandArgs {
  /** Stable owner/run identity used for task idempotency and reconciliation. */
  orderKey: string;
  /** Owner-scoped create-only receipt path. */
  receiptKey: string;
  request: Omit<MiniMaxH3RenderRequest, "provider" | "execution">;
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error(`on-demand MiniMax H3 ${label} is invalid`);
  }
  return value;
}

function ownerScopedKey(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("owner/") ||
    value.length <= "owner/".length ||
    value.length > 1_000 ||
    value.includes("\\") ||
    /(?:^|\/)\.\.?($|\/)/u.test(value)
  ) {
    throw new Error(`on-demand MiniMax H3 ${label} must be owner-scoped`);
  }
  return value;
}

/** Validates all durable paths before vault hydration or a provider request. */
export function assertMiniMaxH3OnDemandArgs(value: unknown): MiniMaxH3OnDemandArgs {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("on-demand MiniMax H3 payload is invalid");
  }
  const payload = value as Record<string, unknown>;
  if (!payload.request || typeof payload.request !== "object" || Array.isArray(payload.request)) {
    throw new Error("on-demand MiniMax H3 request is invalid");
  }
  const request = payload.request as Record<string, unknown>;
  const firstFrame = request.firstFrame;
  const output = request.output;
  if (
    !firstFrame || typeof firstFrame !== "object" || Array.isArray(firstFrame) ||
    typeof (firstFrame as Record<string, unknown>).r2Key !== "string"
  ) {
    throw new Error("on-demand MiniMax H3 first-frame key is invalid");
  }
  if (
    !output || typeof output !== "object" || Array.isArray(output) ||
    typeof (output as Record<string, unknown>).r2Key !== "string"
  ) {
    throw new Error("on-demand MiniMax H3 output key is invalid");
  }
  ownerScopedKey((firstFrame as Record<string, unknown>).r2Key, "first-frame key");
  ownerScopedKey((output as Record<string, unknown>).r2Key, "output key");
  // Normalize the full sealed request before vault hydration or Trigger
  // dispatch. The on-demand route must reject malformed model inputs without
  // creating a paid task that can only fail later in the worker.
  try {
    miniMaxH3RequestKey({
      ...(payload.request as MiniMaxH3OnDemandArgs["request"]),
      provider: "novita",
      execution: "on-demand",
    });
  } catch (error) {
    throw new Error(`on-demand MiniMax H3 request is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    orderKey: safeIdentifier(payload.orderKey, "order key"),
    receiptKey: (() => {
      const key = ownerScopedKey(payload.receiptKey, "receipt key");
      if (!key.endsWith(".json")) throw new Error("on-demand MiniMax H3 receipt key must end in .json");
      return key;
    })(),
    request: payload.request as MiniMaxH3OnDemandArgs["request"],
  };
}

function objectNotFound(error: unknown): boolean {
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } } | null;
  return candidate?.name === "NoSuchKey" || candidate?.name === "NotFound" ||
    candidate?.$metadata?.httpStatusCode === 404;
}

type PersistedOnDemandReceipt = {
  schema: "minimax-h3-on-demand/v1";
  orderKey: string;
  requestKey: string;
  output: { r2Key: string; contentSha256: string; byteLength: number; costUsd: number };
  providerReceipt: unknown;
  /** Local, post-R2 evidence; distinct from the provider's own receipt. */
  openingMotionQa: MiniMaxH3OpeningMotionQaEvidence;
  createdAt: number;
};

/** Reconciles a prior create-only receipt and its actual R2 bytes. */
async function readPersistedReceipt(
  key: string,
  expected: { orderKey: string; requestKey: string; outputKey: string },
): Promise<PersistedOnDemandReceipt | null> {
  let bytes: Uint8Array;
  try {
    bytes = await getObjectBytes(key);
  } catch (error) {
    if (objectNotFound(error)) return null;
    throw error;
  }
  let parsed: PersistedOnDemandReceipt;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as PersistedOnDemandReceipt;
  } catch {
    throw new Error("on-demand MiniMax H3 receipt exists but is not valid JSON");
  }
  if (
    parsed?.schema !== "minimax-h3-on-demand/v1" ||
    parsed.orderKey !== expected.orderKey ||
    parsed.requestKey !== expected.requestKey ||
    parsed.output?.r2Key !== expected.outputKey ||
    !/^[a-f0-9]{64}$/.test(parsed.output?.contentSha256 ?? "") ||
    !Number.isSafeInteger(parsed.output?.byteLength) || parsed.output.byteLength < 1_024 ||
    !Number.isFinite(parsed.output?.costUsd) || parsed.output.costUsd < 0 ||
    !Number.isSafeInteger(parsed.createdAt) || parsed.createdAt <= 0 ||
    parsed.providerReceipt === undefined
  ) {
    throw new Error("on-demand MiniMax H3 receipt exists but is bound to a different request");
  }
  try {
    MiniMaxH3OpeningMotionQaEvidenceSchema.parse(parsed.openingMotionQa);
  } catch (error) {
    throw new Error(
      `on-demand MiniMax H3 receipt lacks valid opening-motion evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const output = await getObjectBytes(parsed.output.r2Key);
  if (output.byteLength !== parsed.output.byteLength || sha256BytesHex(output) !== parsed.output.contentSha256) {
    throw new Error("on-demand MiniMax H3 persisted receipt does not match its R2 output");
  }
  return parsed;
}

export const minimaxH3OnDemandTask = task({
  id: "minimax-h3-on-demand",
  maxDuration: 1_200,
  retry: { maxAttempts: 1 },
  run: async (rawPayload: MiniMaxH3OnDemandArgs) => {
    const payload = assertMiniMaxH3OnDemandArgs(rawPayload);
    await bootstrapSecrets(() => undefined, {
      services: ["cloudflare"],
      required: ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"],
    });
    const requestKey = miniMaxH3RequestKey({ ...payload.request, provider: "novita", execution: "on-demand" });
    const prior = await readPersistedReceipt(payload.receiptKey, {
      orderKey: payload.orderKey,
      requestKey,
      outputKey: payload.request.output.r2Key,
    });
    if (prior) return { receiptKey: payload.receiptKey, ...prior, reconciled: true as const };
    // Preserve old completed receipts, while refusing any new direct provider spend.
    throw new Error(`MiniMax H3 on-demand order ${payload.orderKey} is held for Render Engine qualification`);
  },
});
