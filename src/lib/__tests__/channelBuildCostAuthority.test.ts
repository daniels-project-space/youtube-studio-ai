import assert from "node:assert/strict";
import { channelBuildCostAuthority } from "../channelBuildCostAuthority";

assert.deepEqual(
  channelBuildCostAuthority({
    approveSetupSpend: true,
    runProbe: true,
    perVideoBudgetUsd: 5,
  }),
  {
    setupCapUsd: 6.15,
    validationCapUsd: 3,
    combinedSetupAndValidationCapUsd: 9.15,
    perVideoProductionBudgetUsd: 5,
  },
);
assert.deepEqual(
  channelBuildCostAuthority({
    approveSetupSpend: true,
    runProbe: true,
    perVideoBudgetUsd: 1.5,
  }),
  {
    setupCapUsd: 6.15,
    validationCapUsd: 1.5,
    combinedSetupAndValidationCapUsd: 7.65,
    perVideoProductionBudgetUsd: 1.5,
  },
);
assert.equal(
  channelBuildCostAuthority({
    approveSetupSpend: false,
    runProbe: false,
    perVideoBudgetUsd: 10,
  }).combinedSetupAndValidationCapUsd,
  0,
);

assert.deepEqual(
  channelBuildCostAuthority({
    approveSetupSpend: true,
    runProbe: true,
    perVideoBudgetUsd: 130,
    family: "cinematic",
  }),
  {
    setupCapUsd: 6.15,
    validationCapUsd: 55,
    combinedSetupAndValidationCapUsd: 61.15,
    perVideoProductionBudgetUsd: 130,
  },
);

console.log("channel build displayed/signed cost authority tests passed");
