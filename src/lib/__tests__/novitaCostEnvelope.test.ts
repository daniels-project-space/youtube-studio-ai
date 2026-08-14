import assert from "node:assert/strict";
import { generationProfile } from "@/engine/generationProfiles";
import { PRICE } from "@/engine/pricing";
import { novitaCostEnvelope } from "@/lib/novitaCostEnvelope";
import { renderImages, renderVideo, toNovitaPhaseProfile } from "@/lib/novitaRenderFarm";

function derivesExactWorkerCaps(): void {
  const envelope = novitaCostEnvelope({
    label: "cinematic test",
    imageJobs: 4,
    videoJobs: 3,
    maxCostUsd: 10,
  });
  assert.equal(envelope.imageMaxCostUsd, 4 * PRICE.novitaImageMaxUsd);
  assert.equal(envelope.videoMaxCostUsd, 3 * PRICE.novitaVideoMaxUsd);
  assert.equal(envelope.totalMaxCostUsd, envelope.imageMaxCostUsd + envelope.videoMaxCostUsd);
}

function refusesPartialOrMalformedEnvelopesBeforeProviderWork(): void {
  assert.throws(
    () => novitaCostEnvelope({ label: "partial", imageJobs: 1, videoJobs: 1, maxCostUsd: PRICE.novitaImageMaxUsd }),
    /requires a \$0\.7000 Novita envelope but only \$0\.3500 is admitted/,
  );
  assert.throws(
    () => novitaCostEnvelope({ label: "invalid", imageJobs: 1.5 }),
    /non-negative integer/,
  );
  assert.throws(
    () => novitaCostEnvelope({ label: "empty" }),
    /at least one Novita worker/,
  );
}

async function rawProviderBoundaryRefusesMissingSignedCeilings(): Promise<void> {
  const profile = generationProfile("production");
  const base = {
    prefix: "owners/o/channels/c/runs/r/novita-test",
    shots: [{
      id: "s1",
      prompt: "a clean text-free test scene",
      motion: "subtle movement",
      seconds: 5,
      cameraMove: "static" as const,
      shotScale: "medium" as const,
      lens: "35mm",
    }],
  };
  await assert.rejects(
    renderImages({ ...base, profile: toNovitaPhaseProfile(profile, "image") }),
    /requires an explicit signed worker cost ceiling/,
    "the raw image wrapper must fail before importing a provider controller",
  );
  await assert.rejects(
    renderVideo({
      ...base,
      shots: [{ ...base.shots[0], stillKey: "owners/o/channels/c/still.png" }],
      profile: toNovitaPhaseProfile(profile, "video"),
    }),
    /requires an explicit signed worker cost ceiling/,
    "the raw video wrapper must fail before importing a provider controller",
  );
}

async function main(): Promise<void> {
  derivesExactWorkerCaps();
  refusesPartialOrMalformedEnvelopesBeforeProviderWork();
  await rawProviderBoundaryRefusesMissingSignedCeilings();
  console.log("novita cost envelope test passed");
}

void main();
