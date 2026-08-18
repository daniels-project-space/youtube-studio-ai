import assert from "node:assert/strict";
import { isAssetGateApproved, parseDocuAssetGate } from "@/lib/documotion";

function run(): void {
  const strict = parseDocuAssetGate('{"styleOk":true,"briefOk":true,"noText":true,"framingOk":true}');
  assert.equal(isAssetGateApproved(strict), true);

  const prose = parseDocuAssetGate(
    "Assessment: styleOk: true; briefOk: true; noText: true; framingOk: true. All constraints are met.",
  );
  assert.equal(isAssetGateApproved(prose), true);

  const missing = parseDocuAssetGate("styleOk: true; briefOk: true; noText: true");
  assert.equal(isAssetGateApproved(missing), false);
  console.log("documotion asset-gate parser test passed");
}

run();
