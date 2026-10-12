import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { studioErnieReferenceComfyProfile, STUDIO_ERNIE_REFERENCE_COMFY } from "../studioErnieComfyProfile";

test("Studio's real Comfy source remains identical to its live registered graph and pinned native recipe", () => {
  const profile = studioErnieReferenceComfyProfile();
  assert.equal(createHash("sha256").update(JSON.stringify(profile.graph)).digest("hex"), STUDIO_ERNIE_REFERENCE_COMFY.sourceSha256);
  assert.equal(profile.profileId, "ernie-image");
  assert.equal(profile.models.length, 4);
  assert.ok(profile.models.every(model => model.filesystemId === 3975 && model.provider === "jarvis"));
  assert.deepEqual(profile.graph["6"].inputs, { width: 896, height: 1200, batch_size: 1 });
  assert.equal(profile.graph["7"].inputs.steps, 50);
  assert.equal(profile.graph["7"].inputs.cfg, 4);
  assert.equal(profile.graph["11"].inputs.prompt, "{{candidate.enhancer_instruction}}");
  assert.deepEqual(profile.graph["4"].inputs.text, ["12", 0]);
  assert.equal(profile.graph["9"].inputs.filename_prefix, "{{output.prefix}}");
  assert.deepEqual(profile.loras, []);
});
