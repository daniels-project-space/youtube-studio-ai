import assert from "node:assert/strict";

import {
  recordStudioAssetReleaseUsage,
  resolveStudioAssetApprovedImagePreview,
  resolveStudioAssetsForPipeline,
} from "@/lib/studioAssetLibraryRuntime";
import { listAcceptedCharacterLoRAInventory } from "@/lib/narrativeSeriesStateRuntime";
import { sha256Hex } from "@/lib/sha256";

const digest = (value: string) => sha256Hex(value);

async function main() {
  let called = 0;
  const result = await resolveStudioAssetsForPipeline({
    client: {
      query: async (_reference, args) => {
        called += 1;
        const request = args as { ownerId: string; request: { ownerId: string; requiredKinds: string[] } };
        assert.equal(request.ownerId, "owner-1");
        assert.equal(request.request.ownerId, "owner-1");
        assert.deepEqual(request.request.requiredKinds, ["camera_recipe"]);
        return { status: "no_approved_match", missingKinds: ["camera_recipe"], blockers: ["promote one"] };
      },
    },
    request: {
      ownerId: "owner-1",
      channelId: "channel-1",
      family: "comic",
      contentLane: "cinematic_ai",
      moduleId: "visual_matter",
      runtimeFingerprint: digest("runtime"),
      requiredKinds: ["camera_recipe"],
    },
  });
  assert.equal(called, 1);
  assert.equal(result.status, "no_approved_match");
  const preview = await resolveStudioAssetApprovedImagePreview({
    client: {
      query: async (_reference, args) => {
        const request = args as { ownerId: string; assetEntryFingerprint: string };
        assert.equal(request.ownerId, "owner-1");
        assert.equal(request.assetEntryFingerprint, digest("approved-image"));
        return {
          r2Key: "owner/owner-1/studio-assets/approved-image.png",
          contentType: "image/png",
          contentSha256: digest("approved-image-bytes"),
        };
      },
    },
    ownerId: "owner-1",
    assetEntryFingerprint: digest("approved-image"),
  });
  assert.deepEqual(preview, {
    r2Key: "owner/owner-1/studio-assets/approved-image.png",
    contentType: "image/png",
    contentSha256: digest("approved-image-bytes"),
  });
  const adapters = await listAcceptedCharacterLoRAInventory({
    client: {
      query: async (_reference, args) => {
        const request = args as { ownerId: string };
        assert.equal(request.ownerId, "owner-1");
        return [{
          registryIdentity: digest("registry"),
          characterId: "mira",
          characterSpecFingerprint: digest("character"),
          datasetFingerprint: digest("dataset"),
          provider: "ltx",
          adapterFlavor: "ic_lora",
          runtimeProfileFingerprint: digest("runtime-profile"),
          acceptedAt: 1_700_000_000_000,
        }];
      },
      mutation: async () => {
        throw new Error("read-only inventory must not mutate state");
      },
    },
    ownerId: "owner-1",
  });
  assert.equal(adapters.length, 1);
  assert.equal(adapters[0]?.characterId, "mira");
  assert.ok(!("adapterReference" in (adapters[0] ?? {})));
  let mutationCalled = 0;
  await recordStudioAssetReleaseUsage({
    client: {
      mutation: async (_reference, args) => {
        mutationCalled += 1;
        const request = args as {
          ownerId: string;
          channelId: string;
          runId: string;
          certificateFingerprint: string;
          usage: { receiptFingerprint: string };
        };
        assert.equal(request.ownerId, "owner-1");
        assert.equal(request.channelId, "channel-1");
        assert.equal(request.runId, "run-1");
        assert.equal(request.certificateFingerprint, digest("certificate"));
        assert.equal(request.usage.receiptFingerprint, digest("usage"));
        return null;
      },
    },
    ownerId: "owner-1",
    channelId: "channel-1",
    runId: "run-1",
    certificateFingerprint: digest("certificate"),
    usage: { receiptFingerprint: digest("usage") },
  });
  assert.equal(mutationCalled, 1);
  console.log("STUDIO ASSET LIBRARY RUNTIME TESTS PASS");
}

void main();
