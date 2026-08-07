import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import type { StudioConvexHttpClient } from "@/lib/studioConvexHttpClient";
import {
  channelInceptionStageDescriptor,
  type ChannelInceptionClaimDisposition,
  type ChannelInceptionExecutionAdmission,
  type ChannelInceptionLedgerAdapter,
} from "@/engine/channelInceptionLedger";
import type { ChannelInceptionPlan } from "@/engine/channelInceptionPlan";

const DEFAULT_STAGE_LEASE_MS = 65 * 60 * 1_000;

export async function initializeChannelInceptionLedger(args: {
  convex: StudioConvexHttpClient;
  channelId: Id<"channels">;
  plan: ChannelInceptionPlan;
  admission: ChannelInceptionExecutionAdmission;
}): Promise<void> {
  await args.convex.mutation(api.channels.beginChannelInception, {
    channelId: args.channelId,
    schemaVersion: args.plan.schemaVersion,
    planKey: args.plan.inceptionKey,
    requestFingerprint: args.plan.requestFingerprint,
    requestSnapshot: args.plan.requestSnapshot,
    admission: args.admission,
    stages: args.plan.stages.map(channelInceptionStageDescriptor),
  });
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 1_000) || "unknown channel inception failure";
}

export function convexChannelInceptionLedger(args: {
  convex: StudioConvexHttpClient;
  channelId: Id<"channels">;
  claimant: string;
  leaseMs?: number;
}): ChannelInceptionLedgerAdapter {
  const leaseMs = args.leaseMs ?? DEFAULT_STAGE_LEASE_MS;
  return {
    claim: async (stage, options) => {
      const claim = await args.convex.mutation(api.channels.claimChannelInceptionStage, {
        channelId: args.channelId,
        stage: channelInceptionStageDescriptor(stage),
        claimant: args.claimant,
        leaseMs,
        maximumAttempts: options.maximumAttempts,
        ...(options.observedOutputFingerprint
          ? { observedOutputFingerprint: options.observedOutputFingerprint }
          : {}),
      });
      return {
        disposition: claim.disposition as ChannelInceptionClaimDisposition,
        outputs: claim.outputs,
        executionPhase: claim.executionPhase as "claimed" | "provider-started" | undefined,
        leaseVersion: claim.leaseVersion,
      };
    },
    complete: async (stage, leaseVersion, status, outputs, outputFingerprint) => {
      await args.convex.mutation(api.channels.completeChannelInceptionStage, {
        channelId: args.channelId,
        stage: channelInceptionStageDescriptor(stage),
        claimant: args.claimant,
        leaseVersion,
        status,
        outputFingerprint,
        ...(outputs === undefined ? {} : { outputs }),
      });
    },
    checkpoint: async (stage, leaseVersion, outputs, executionPhase) => {
      await args.convex.mutation(api.channels.checkpointChannelInceptionStage, {
        channelId: args.channelId,
        stage: channelInceptionStageDescriptor(stage),
        claimant: args.claimant,
        leaseVersion,
        outputs,
        ...(executionPhase ? { executionPhase } : {}),
      });
    },
    heartbeat: async (stage, leaseVersion) => {
      await args.convex.mutation(api.channels.heartbeatChannelInceptionStage, {
        channelId: args.channelId,
        stage: channelInceptionStageDescriptor(stage),
        claimant: args.claimant,
        leaseVersion,
        leaseMs,
      });
    },
    fail: async (stage, leaseVersion, error, retryable) => {
      await args.convex.mutation(api.channels.failChannelInceptionStage, {
        channelId: args.channelId,
        stage: channelInceptionStageDescriptor(stage),
        claimant: args.claimant,
        leaseVersion,
        error: cleanError(error),
        retryable,
      });
    },
  };
}
