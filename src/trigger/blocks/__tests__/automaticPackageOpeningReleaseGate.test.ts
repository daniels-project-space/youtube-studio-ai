import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src", "trigger", "blocks", "lofiBlocks.ts"),
  "utf8",
);

const certificateVerification = source.indexOf(
  "const finalMasterReleaseCertificate = await verifyFinalMasterReleaseEvidenceForUpload(",
);
const automaticGate = source.indexOf(
  "if (uploadProgramRoute && certifiedFamilyAdmission(uploadProgramRoute.family).automatic)",
);
const connectorLookup = source.indexOf("const connector = await requireYouTubeConnector(client");

assert.ok(certificateVerification >= 0, "upload must first revalidate the release certificate");
assert.ok(automaticGate > certificateVerification, "automatic package-opening proof must use the verified certificate");
assert.ok(automaticGate < connectorLookup, "missing automatic package-opening proof must fail before connector/upload work");
assert.match(
  source.slice(automaticGate, connectorLookup),
  /requireAutomaticPackageToOpeningReceipt\([\s\S]*?packageToOpeningOmission/,
  "automatic route uploads must reject an omission rather than treating it as release proof",
);

console.log("automatic package-to-opening release gate test passed");
