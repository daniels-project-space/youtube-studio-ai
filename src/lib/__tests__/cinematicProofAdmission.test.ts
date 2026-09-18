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
  launchVideo,
  renderVideo,
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
    /no immutable approved proof receipt is registered/,
    "native-720p x2 cannot be admitted without a release-controlled proof receipt",
  );

  const oldLowerResolutionProof = proofFor(currentProfile);
  assert.notEqual(
    oldLowerResolutionProof.profileFingerprint,
    cinematicProofProfileFingerprint(native720Profile),
    "a 640x352 -> 1280x704 receipt cannot be the native-720p profile's immutable registry key",
  );
  const syntheticNativeProof = proofFor(native720Profile);

  let paidRenderCalls = 0;
  await assert.rejects(
    () => renderDirectNovita(native720Cfg(() => { paidRenderCalls += 1; }), "video"),
    /Direct LTX video execution is retired; use the attested MiniMax H3 renderer instead/,
    "the retired direct video worker must reject before provider admission",
  );
  await assert.rejects(
    () => renderVideo(native720Cfg(() => { paidRenderCalls += 1; })),
    /Direct LTX video execution is retired; use the attested MiniMax H3 renderer instead/,
    "the retired public video wrapper must reject before provider admission",
  );
  await assert.rejects(
    () => launchVideo(native720Cfg(() => { paidRenderCalls += 1; })),
    /Direct LTX video execution is retired; use the attested MiniMax H3 renderer instead/,
    "the retired bridge video wrapper must reject before secret bootstrap",
  );
  await assert.rejects(
    () => renderDirectNovita({
      ...native720Cfg(() => { paidRenderCalls += 1; }),
      // Runtime payloads can carry arbitrary extra keys. The controller must
      // ignore a caller-crafted receipt rather than treating it as authority.
      cinematicProofAdmission: syntheticNativeProof,
    } as unknown as NovitaRenderCfg, "video"),
    /Direct LTX video execution is retired; use the attested MiniMax H3 renderer instead/,
    "a caller-crafted receipt cannot reactivate the retired direct video worker",
  );
  assert.equal(paidRenderCalls, 0, "proof admission fails before beforeProviderSpend can run");

  console.log("cinematic proof admission tests passed");
}

void main();
