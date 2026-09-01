import assert from "node:assert/strict";
import { channelBuildCostAuthority } from "../channelBuildCostAuthority";

assert.deepEqual(
  channelBuildCostAuthority({
    approveSetupSpend: true,
    runProbe: true,
    perVideoBudgetUsd: 5,
  }),
  {
    setupCapUsd: 5.22,
    validationCapUsd: 3,
    combinedSetupAndValidationCapUsd: 8.22,
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
    setupCapUsd: 5.22,
    validationCapUsd: 1.5,
    combinedSetupAndValidationCapUsd: 6.72,
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
    setupCapUsd: 5.22,
    validationCapUsd: 55,
    combinedSetupAndValidationCapUsd: 60.22,
    perVideoProductionBudgetUsd: 130,
  },
);

console.log("channel build displayed/signed cost authority tests passed");
