import assert from "node:assert/strict";

import { generationProfile } from "@/engine/generationProfiles";
import {
  assertCinematicProofAdmission,
  cinematicProofProfileFingerprint,
  requiresNative720X2CinematicProof,
  sealCinematicProofAdmissionReceipt,
} from "@/lib/cinematicProofAdmission";
import { renderDirectNovita } from "@/lib/novitaDirectRender";
import {
  toNovitaPhaseProfile,
  type NovitaPhaseProfile,
  type NovitaRenderCfg,
} from "@/lib/novitaRenderFarm";

const currentProfile = toNovitaPhaseProfile(generationProfile("production"), "video");
const native720Profile: NovitaPhaseProfile = {
  ...currentProfile,
  width: 2560,
  height: 1408,
  stageOneWidth: 1280,
  stageOneHeight: 704,
};

function proofFor(profile: NovitaPhaseProfile) {
  return sealCinematicProofAdmissionReceipt({
    version: "cinematic-proof-admission/v1",
    profileFingerprint: cinematicProofProfileFingerprint(profile),
    finalMasterSha256: "a".repeat(64),
    visualReviewReceiptFingerprint: "b".repeat(64),
    cinematicFinalMasterQaReceiptFingerprint: "c".repeat(64),
  });
}

function native720Cfg(beforeProviderSpend: () => void): NovitaRenderCfg {
  return {
    prefix: "cinematic-proof-admission-test",
    shots: [],
    profile: native720Profile,
    maxCostUsd: 1,
    lifecycle: {
      ownerId: "owner-test",
      channelId: "channel-test",
      runId: "run-test",
      blockId: "novita_render_video",
    },
    beforeProviderSpend,
  };
}

async function main(): Promise<void> {
  assert.deepEqual(
    [
      currentProfile.stageOneWidth,
      currentProfile.stageOneHeight,
      currentProfile.width,
      currentProfile.height,
      currentProfile.spatialUpscaleFactor,
    ],
    [640, 352, 1280, 704, 2],
    "the retained lower-resolution proof fixture must remain the historical 640x352 -> 1280x704 x2 profile",
  );
  assert.equal(
    requiresNative720X2CinematicProof(currentProfile),
    false,
    "existing 640x352 -> 1280x704 path stays unchanged",
  );
  assert.equal(
    requiresNative720X2CinematicProof(native720Profile),
    true,
    "requested native-720p x2 geometry must be guarded",
  );

  assert.throws(
    () => assertCinematicProofAdmission({ profile: native720Profile }),
    /blocked until an explicit cinematic proof receipt is supplied/,
    "native-720p x2 cannot be admitted without an explicit proof receipt",
  );

  const oldLowerResolutionProof = proofFor(currentProfile);
  assert.throws(
    () => assertCinematicProofAdmission({ profile: native720Profile, proof: oldLowerResolutionProof }),
    /does not match the exact requested native-720p x2 profile/,
    "a 640x352 -> 1280x704 proof cannot approve the native-720p x2 target",
  );
  const syntheticNativeProof = proofFor(native720Profile);
  assert.throws(
    () => assertCinematicProofAdmission({ profile: native720Profile, proof: syntheticNativeProof }),
    /no immutable approved proof receipt is registered/,
    "a caller-generated, self-consistent native-720p receipt is not a trusted proof admission",
  );

  let paidRenderCalls = 0;
  await assert.rejects(
    () => renderDirectNovita(native720Cfg(() => { paidRenderCalls += 1; }), "video"),
    /blocked until an explicit cinematic proof receipt is supplied/,
    "missing native-720p proof must reject before direct provider admission",
  );
  await assert.rejects(
    () => renderDirectNovita({
      ...native720Cfg(() => { paidRenderCalls += 1; }),
      cinematicProofAdmission: oldLowerResolutionProof,
    }, "video"),
    /does not match the exact requested native-720p x2 profile/,
    "old lower-resolution proof must reject before any paid render call",
  );
  await assert.rejects(
    () => renderDirectNovita({
      ...native720Cfg(() => { paidRenderCalls += 1; }),
      cinematicProofAdmission: syntheticNativeProof,
    }, "video"),
    /no immutable approved proof receipt is registered/,
    "a synthetic native-720p receipt must reject before any paid render call",
  );
  assert.equal(paidRenderCalls, 0, "proof admission fails before beforeProviderSpend can run");

  console.log("cinematic proof admission tests passed");
}

void main();
