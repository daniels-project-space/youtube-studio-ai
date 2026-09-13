/**
 * The paid on-demand H3 data plane. Weekly preparation is intentionally kept
 * on the Salad batch task; interactive or repair renders use this Novita
 * route and the same R2-backed request/receipt contract.
 */
import { task } from "@trigger.dev/sdk";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  renderMiniMaxH3,
  type MiniMaxH3RenderRequest,
} from "@/lib/minimaxH3";
import { putObject } from "@/lib/storage";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

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
    const result = await renderMiniMaxH3({
      ...payload.request,
      provider: "novita",
      execution: "on-demand",
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
    await putObject(payload.receiptKey, body, {
      contentType: "application/json",
      metadata: {
        "h3-on-demand-receipt": "v1",
        "h3-on-demand-sha256": sha256Hex(body),
      },
      ifNoneMatch: "*",
    });
    return { receiptKey: payload.receiptKey, ...receipt };
  },
});
