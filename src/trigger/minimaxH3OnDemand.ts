/**
 * The paid on-demand H3 data plane. Weekly preparation is intentionally kept
 * on the Salad batch task; interactive or repair renders use this Novita
 * route and the same R2-backed request/receipt contract.
 */
import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  miniMaxH3RequestKey,
  renderMiniMaxH3,
  type MiniMaxH3RenderRequest,
} from "@/lib/minimaxH3";
import { getObjectBytes, putObject } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256BytesHex, sha256Hex } from "@/lib/sha256";

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
  const output = await getObjectBytes(parsed.output.r2Key);
  if (output.byteLength !== parsed.output.byteLength || sha256BytesHex(output) !== parsed.output.contentSha256) {
    throw new Error("on-demand MiniMax H3 persisted receipt does not match its R2 output");
  }
  return parsed;
}

export const minimaxH3OnDemandTask = task({
  id: "minimax-h3-on-demand",
  // A transport failure after submission is an unknown outcome. The caller
  // reconciles the request key instead of Trigger replaying a paid render.
  maxDuration: 1_200,
  retry: { maxAttempts: 1 },
  run: async (rawPayload: MiniMaxH3OnDemandArgs) => {
    const payload = assertMiniMaxH3OnDemandArgs(rawPayload);
    await bootstrapSecrets(() => undefined, {
      services: ["cloudflare", "novita"],
      required: [
        "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
        "MINIMAX_H3_NOVITA_WORKER_URL", "MINIMAX_H3_NOVITA_WORKER_TOKEN",
      ],
    });
    const request = {
      ...payload.request,
      provider: "novita" as const,
      execution: "on-demand" as const,
    };
    const requestKey = miniMaxH3RequestKey(request);
    const prior = await readPersistedReceipt(payload.receiptKey, {
      orderKey: payload.orderKey,
      requestKey,
      outputKey: request.output.r2Key,
    });
    if (prior) return { receiptKey: payload.receiptKey, ...prior, reconciled: true as const };
    const result = await renderMiniMaxH3({
      ...request,
    });
    const receipt = {
      schema: "minimax-h3-on-demand/v1",
      orderKey: payload.orderKey,
      requestKey: result.requestKey,
      output: {
        r2Key: result.receipt.output.r2Key,
        contentSha256: result.receipt.output.contentSha256,
        byteLength: result.receipt.output.byteLength,
        costUsd: result.receipt.runtime.costUsd,
      },
      providerReceipt: result.receipt,
      createdAt: Date.now(),
    };
    const body = canonicalJson(receipt);
    // This is create-only. A lost response is reconciled from the exact
    // receipt/request key; it can never overwrite a different paid result.
    try {
      await putObject(payload.receiptKey, body, {
        contentType: "application/json",
        metadata: {
          "h3-on-demand-receipt": "v1",
          "h3-on-demand-sha256": sha256Hex(body),
        },
        ifNoneMatch: "*",
      });
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 409 && status !== 412) throw error;
      const winner = await readPersistedReceipt(payload.receiptKey, {
        orderKey: payload.orderKey,
        requestKey,
        outputKey: request.output.r2Key,
      });
      if (!winner) throw error;
      return { receiptKey: payload.receiptKey, ...winner, reconciled: true as const };
    }
    return { receiptKey: payload.receiptKey, ...receipt };
  },
});
