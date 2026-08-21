import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { artifactContract } from "@/engine/artifactSchemas";
import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";

registerAllBlocks();

const qa = getManifest("qa_visual");
const upload = getManifest("upload_draft");
const cleanup = getManifest("cleanup");
assert(qa && upload && cleanup, "final-master QA, upload, and cleanup blocks must all be registered");

for (const key of ["finalMasterReleaseCertificate", "finalMasterReleaseCertificateKey"]) {
  assert(key in qa.optionalProduces, `qa_visual must optionally produce ${key} after production QA`);
  assert(!(key in qa.produces), `draft QA must not be required to return ${key}`);
  assert(key in upload.consumes, `upload_draft must consume ${key}`);
  assert(key in cleanup.consumes, `cleanup must consume ${key}`);
}
assert("videoKey" in qa.consumes, "qa_visual must bind its release certificate to the durable final-master key");
assert.equal(
  artifactContract("finalMasterReleaseCertificate").persist,
  "reference",
  "the complete certificate belongs in durable R2 evidence while the immutable runArtifact retains lineage",
);

const narrated = readFileSync(join(process.cwd(), "src/trigger/blocks/narratedBlocks.ts"), "utf8");
const lofi = readFileSync(join(process.cwd(), "src/trigger/blocks/lofiBlocks.ts"), "utf8");
const releaseCertificateDeclaration = narrated.indexOf("let finalMasterReleaseCertificate:");
const productionReleaseGate = narrated.indexOf("if (productionQa) {", releaseCertificateDeclaration);
const receiptCreation = narrated.indexOf("createVisualReviewReleaseReceipt(");
assert(
  releaseCertificateDeclaration >= 0 && productionReleaseGate >= 0 && productionReleaseGate < receiptCreation,
  "only production QA may persist durable release evidence; draft probes must remain certificate-free",
);
assert.match(
  narrated,
  /createVisualReviewReleaseReceipt\([\s\S]*?createFinalMasterReleaseCertificate\([\s\S]*?finalMasterReleaseCertificateKey/,
  "QA must persist the verdict-bearing visual-review receipt before creating the master-bound release certificate",
);
assert.match(
  narrated,
  /finalMasterSha256: finalMasterSha256AfterVisualReview/,
  "QA must return the final-master SHA for every lane, not only cinematic QA",
);
assert.match(
  lofi,
  /verifyFinalMasterReleaseEvidenceForUpload\([\s\S]*?getObjectBytes\(certificateKey\)[\s\S]*?retainedFinalMasterReleaseObjectKeys[\s\S]*?assertReleaseCertificateVisualReviewBindings[\s\S]*?fileSha256\(filePath\)/,
  "upload must reload bounded durable certificate/evidence and hash the exact local master before publishing",
);
const uploadCall = lofi.indexOf("await verifyFinalMasterReleaseEvidenceForUpload(");
const connectorCall = lofi.indexOf("requireYouTubeConnector(client");
assert(
  uploadCall >= 0 && connectorCall >= 0 && uploadCall < connectorCall,
  "release evidence must be revalidated before connector lookup or dispatch",
);
assert.match(
  lofi,
  /retainedFinalMasterReleaseObjectKeys\([\s\S]*?\.{3}retainedReleaseEvidence[\s\S]*?deleteObjects\(del\)/,
  "cleanup must whitelist the certificate's manifest, receipt, and frame evidence before deleting intermediates",
);

console.log("final-master release evidence wiring test passed");
