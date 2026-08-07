import {
  CHANNEL_INCEPTION_SETUP_COST_CEILING_USD,
  CHANNEL_INCEPTION_STAGE_COST_CEILINGS_USD,
} from "@/engine/channelInceptionContracts";

export interface ChannelBuildCostAuthority {
  setupCapUsd: number;
  validationCapUsd: number;
  combinedSetupAndValidationCapUsd: number;
  perVideoProductionBudgetUsd: number;
}

/** Single source of truth for both displayed and signed channel-build authority. */
export function channelBuildCostAuthority(args: {
  approveSetupSpend: boolean;
  runProbe: boolean;
  perVideoBudgetUsd: number;
}): ChannelBuildCostAuthority {
  const perVideoProductionBudgetUsd = Number.isFinite(args.perVideoBudgetUsd)
    ? Math.max(0, args.perVideoBudgetUsd)
    : 0;
  const setupCapUsd = args.approveSetupSpend
    ? CHANNEL_INCEPTION_SETUP_COST_CEILING_USD
    : 0;
  const validationCapUsd = args.approveSetupSpend && args.runProbe
    ? Math.min(
        perVideoProductionBudgetUsd,
        CHANNEL_INCEPTION_STAGE_COST_CEILINGS_USD["channel-inception-probe"],
      )
    : 0;
  return {
    setupCapUsd,
    validationCapUsd,
    combinedSetupAndValidationCapUsd: Number((setupCapUsd + validationCapUsd).toFixed(2)),
    perVideoProductionBudgetUsd,
  };
}
