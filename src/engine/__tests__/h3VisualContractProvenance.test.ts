import assert from "node:assert/strict";

import { registerAllBlocks } from "@/engine/blocks";
import { getManifest } from "@/engine/registry";

registerAllBlocks();

for (const moduleId of ["gen_footage", "signature_clips"] as const) {
  const manifest = getManifest(moduleId);
  assert(manifest, `${moduleId} must be registered`);
  assert.deepEqual(
    manifest.providerProfiles.map((profile) => profile.id),
    ["novita-zimage-minimax-h3-production"],
    `${moduleId} must compile new visual work against the Z-Image + MiniMax H3 profile`,
  );
  assert.equal(
    manifest.providerProfiles.some((profile) => /ltx/i.test(profile.id)),
    false,
    `${moduleId} must not label a fresh H3 route as LTX`,
  );
}

console.log("H3 visual contract provenance tests passed");
