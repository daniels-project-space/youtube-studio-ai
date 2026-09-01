import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  avatarPrompt,
  bannerPrompt,
  generateChannelArt,
  generateChannelArtAsset,
  generateFlagBanner,
  type ChannelArtRenderRequest,
  type ChannelArtRuntime,
} from "@/lib/channelArt";
import {
  NANO_BANANA_AVATAR_PROFILE,
  type NanoBananaAvatarReceipt,
} from "@/lib/nanoBananaAvatarContract";

type Kind = "avatar" | "banner";

interface RuntimeState {
  renders: ChannelArtRenderRequest[];
  avatarRenders: Array<{ prompt: string; idempotencyContext: string }>;
  renderedKeys: string[];
  downloads: Array<{ url: string; path: string }>;
  conversions: Array<{ input: string; output: string; width: number; height: number }>;
  judgements: Array<{ kind: Kind; prompt: string; imagePaths: string[] }>;
  persisted: Map<string, { bytes: Uint8Array; contentType: string }>;
}

function accepted(kind: Kind, score = 0.94): Record<string, unknown> {
  return kind === "avatar"
    ? {
        score,
        circleSafe: true,
        tinyLegible: true,
        singleMark: true,
        noScene: true,
        noText: true,
        issues: [],
      }
    : { score, safeArea: true, noText: true, issues: [] };
}

function rejected(kind: Kind, issue: string, score = 0.45): Record<string, unknown> {
  return kind === "avatar"
    ? { score, circleSafe: false, tinyLegible: false, noText: true, issues: [issue] }
    : { score, safeArea: false, noText: true, issues: [issue] };
}

function fakeRuntime(config: {
  hasJudge?: boolean;
  verdicts?: Partial<Record<Kind, unknown[]>>;
} = {}): { runtime: ChannelArtRuntime; state: RuntimeState } {
  const state: RuntimeState = {
    renders: [],
    avatarRenders: [],
    renderedKeys: [],
    downloads: [],
    conversions: [],
    judgements: [],
    persisted: new Map(),
  };
  const avatarReceipt = (ordinal: number): NanoBananaAvatarReceipt => ({
    provider: NANO_BANANA_AVATAR_PROFILE.provider,
    model: NANO_BANANA_AVATAR_PROFILE.model,
    apiVersion: NANO_BANANA_AVATAR_PROFILE.apiVersion,
    providerRequestId: `fixture-avatar-${ordinal}`,
    route: NANO_BANANA_AVATAR_PROFILE.route,
    width: NANO_BANANA_AVATAR_PROFILE.providerOutputWidth,
    height: NANO_BANANA_AVATAR_PROFILE.providerOutputHeight,
    promptUtf8Bytes: 400,
    outputCostUsd: NANO_BANANA_AVATAR_PROFILE.outputImageUsd,
    costUsd: NANO_BANANA_AVATAR_PROFILE.outputImageUsd,
    sourceContentType: "image/png",
    providerRequestCanonicalJson: "{}",
    providerRequestSha256: `request-${ordinal}`,
    providerResponseMetadataCanonicalJson: "{}",
    providerResponseMetadataSha256: `metadata-${ordinal}`,
    responseSha256: `response-${ordinal}`,
    createdAt: ordinal,
  });
  const verdicts: Record<Kind, unknown[]> = {
    avatar: [...(config.verdicts?.avatar ?? [accepted("avatar")])],
    banner: [...(config.verdicts?.banner ?? [accepted("banner")])],
  };

  const runtime: ChannelArtRuntime = {
    hasJudge: () => config.hasJudge ?? true,
    renderImage: async (request) => {
      state.renders.push(request);
      const ordinal = String(state.renders.length).padStart(2, "0");
      const key = `imagecraft/${request.prefix}/job-${ordinal}/stills/${request.id}-c01.png`;
      state.renderedKeys.push(key);
      return {
        url: `https://signed.invalid/${request.id}/${ordinal}`,
        key,
      };
    },
    renderAvatar: async (request) => {
      state.avatarRenders.push(request);
      const ordinal = state.avatarRenders.length;
      return {
        bytes: new TextEncoder().encode(`fake-avatar-${ordinal}`),
        receipt: avatarReceipt(ordinal),
      };
    },
    download: async (url, path) => {
      state.downloads.push({ url, path });
      return path;
    },
    makeTempDir: async (prefix) => `/tmp/${prefix}`,
    toJpeg: async (input, output, width, height) => {
      state.conversions.push({ input, output, width, height });
      return output;
    },
    judge: async (request) => {
      state.judgements.push(request);
      const verdict = verdicts[request.kind].shift();
      if (verdict === undefined) throw new Error(`no fake ${request.kind} verdict remaining`);
      return verdict;
    },
    readBytes: async (path) => new TextEncoder().encode(`fake-image:${path}`),
    writeBytes: async () => {},
    putImmutable: async (key, bytes, contentType) => {
      assert.equal(state.persisted.has(key), false, `immutable key was reused: ${key}`);
      state.persisted.set(key, { bytes, contentType });
      return key;
    },
    createVersion: (kind) => `generated-${kind}-version`,
  };
  return { runtime, state };
}

const IDENTITY = {
  name: "Quiet Stoic",
  niche: "practical stoicism",
  persona: "calm, disciplined and humane",
  iconicMotif: "a centered weathered marble philosopher bust",
  styleGrammar: "museum-grade cinematic portraiture",
  palette: ["charcoal", "warm ivory", "burnished amber"],
  vibe: "still confidence",
};

function assertPromptContracts(): void {
  const avatar = avatarPrompt(IDENTITY);
  assert.match(avatar, /circular crop/i);
  assert.match(avatar, /48px/i);
  assert.match(avatar, /perfectly centered/i);
  assert.match(avatar, /not a scene/i);
  assert.match(avatar, /generic glossy app icon/i);
  assert.match(avatar, /no text/i);

  const banner = bannerPrompt(IDENTITY);
  assert.match(banner, /1546x423 safe area/i);
  assert.match(banner, /outer edges are atmospheric extension only/i);
  assert.match(banner, /absolutely no text/i);
}

async function assertApprovedIndependentOutputs(): Promise<void> {
  const { runtime, state } = fakeRuntime({
    verdicts: {
      avatar: [
        rejected("avatar", "subject is too small"),
        accepted("avatar", 0.93),
      ],
      banner: [accepted("banner", 0.91)],
    },
  });

  const result = await generateChannelArt(
    "owner-test",
    "quiet-stoic",
    IDENTITY,
    () => {},
    {
      runtime,
      maxAttempts: 3,
      version: { avatar: "avatar-v7", banner: "banner-v9" },
    },
  );

  assert.equal(state.avatarRenders.length, 2);
  assert.equal(state.renders.length, 1);
  assert.deepEqual(state.renders.map((request) => request.profileId), [
    "production",
  ]);
  assert.deepEqual(
    state.renders.map((request) => request.maxCostUsd),
    [0.35],
    "the banner candidate must receive only its own direct-worker envelope",
  );
  assert.match(state.avatarRenders[0].idempotencyContext, /art\/avatar\/avatar-v7\/avatar-candidate-01$/);
  assert.match(state.avatarRenders[1].prompt, /subject is too small/i, "critique must guide the retry");
  assert.match(state.renders[0].prefix, /art\/banner\/banner-v9$/);
  assert.match(state.renders[0].negativePrompt, /important subject outside the central safe area/i);

  assert.match(result.imageKey, /art\/avatar\/avatar-v7\/approved\.jpg$/);
  assert.match(result.bannerKey, /^imagecraft\/.*art\/banner\/banner-v9\//);
  assert.notEqual(result.imageKey, result.bannerKey);

  assert(state.conversions.some(({ width, height }) => width === 1024 && height === 1024));
  assert(state.conversions.some(({ width, height }) => width === 48 && height === 48));
  assert(state.conversions.some(({ width, height }) => width === 256 && height === 256));
  assert(state.conversions.some(({ width, height }) => width === 1280 && height === 720));
  assert(state.conversions.some(({ width, height }) => width === 773 && height === 212));
  assert.deepEqual(state.judgements.map(({ imagePaths }) => imagePaths.length), [2, 2, 2]);

  const persistedKeys = [...state.persisted.keys()];
  assert(persistedKeys.some((key) => key.endsWith("art/avatar/avatar-v7/approved.jpg")));
  assert(persistedKeys.some((key) => key.endsWith("art/avatar/avatar-v7/approval.json")));
  assert(persistedKeys.some((key) => key.endsWith("art/banner/banner-v9/approval.json")));
  assert(!persistedKeys.some((key) => key.endsWith("rejection.json")));

  const avatarManifestEntry = [...state.persisted.entries()].find(([key]) =>
    key.endsWith("art/avatar/avatar-v7/approval.json"));
  assert(avatarManifestEntry);
  const manifest = JSON.parse(new TextDecoder().decode(avatarManifestEntry[1].bytes)) as {
    status: string;
    candidates: Array<{ key: string; critique: { pass: boolean } }>;
  };
  assert.equal(manifest.status, "approved");
  assert.equal(manifest.candidates.length, 2);
  assert.equal(manifest.candidates[0].critique.pass, false);
  assert.equal(manifest.candidates[1].critique.pass, true);
  assert.match(manifest.candidates[1].key, /art\/avatar\/avatar-v7\/avatar-candidate-02\.source$/);
}

async function assertMissingJudgeFailsBeforeSpend(): Promise<void> {
  const { runtime, state } = fakeRuntime({ hasJudge: false });
  await assert.rejects(
    generateChannelArt("owner-test", "missing-judge", IDENTITY, () => {}, {
      runtime,
      version: "missing-judge-v1",
    }),
    /quality judge is unavailable/i,
  );
  assert.equal(state.renders.length, 0, "missing judge must stop before a paid Imagecraft render");
  assert.equal(state.avatarRenders.length, 0, "missing judge must stop before a paid Nano Banana render");
  assert.equal(state.persisted.size, 0);
}

async function assertRejectedCandidateNeverReturns(): Promise<void> {
  const { runtime, state } = fakeRuntime({
    verdicts: {
      avatar: [
        rejected("avatar", "not circular-crop safe", 0.72),
        // High score but omitted required booleans: fail closed.
        { score: 0.99, issues: [] },
      ],
    },
  });

  await assert.rejects(
    generateChannelArt("owner-test", "rejected-avatar", IDENTITY, () => {}, {
      runtime,
      version: { avatar: "rejected-v2" },
      maxAttempts: 2,
      banner: false,
      existing: { bannerKey: "owners/owner-test/channels/rejected-avatar/art/banner/good.png" },
    }),
    /avatar rejected after 2 attempts/i,
  );

  assert.equal(state.avatarRenders.length, 2);
  assert.equal(state.renders.length, 0);
  const keys = [...state.persisted.keys()];
  assert(keys.some((key) => key.endsWith("art/avatar/rejected-v2/rejection.json")));
  assert(!keys.some((key) => key.endsWith("approved.jpg")));
  assert(!keys.some((key) => key.endsWith("approval.json")));
}

async function assertExistingAvatarsArePreserved(): Promise<void> {
  for (const channel of ["quiet-stoic", "stoic-truths"]) {
    const { runtime, state } = fakeRuntime({ hasJudge: false });
    const existing = {
      imageKey: `owners/owner-test/channels/${channel}/art/avatar/approved-original.jpg`,
      bannerKey: `owners/owner-test/channels/${channel}/art/banner/approved-original.png`,
    };
    const result = await generateChannelArt(
      "owner-test",
      channel,
      { ...IDENTITY, name: channel === "quiet-stoic" ? "Quiet Stoic" : "Stoic Truths" },
      () => {},
      { runtime, existing, preserveExisting: true },
    );
    assert.deepEqual(result, existing);
    assert.equal(state.renders.length, 0);
    assert.equal(state.avatarRenders.length, 0);
    assert.equal(state.judgements.length, 0);
  }
}

async function assertPerAssetPreservation(): Promise<void> {
  const { runtime, state } = fakeRuntime({
    verdicts: { banner: [accepted("banner")] },
  });
  const existingAvatar = "owners/owner-test/channels/quiet-stoic/art/avatar/approved-original.jpg";
  const result = await generateChannelArt("owner-test", "quiet-stoic", IDENTITY, () => {}, {
    runtime,
    version: { banner: "banner-refresh-v3" },
    existing: {
      imageKey: existingAvatar,
      bannerKey: "owners/owner-test/channels/quiet-stoic/art/banner/old.png",
    },
    preserveExisting: { avatar: true, banner: false },
  });
  assert.equal(result.imageKey, existingAvatar);
  assert.match(result.bannerKey, /art\/banner\/banner-refresh-v3\//);
  assert.equal(state.renders.length, 1);
  assert.equal(state.avatarRenders.length, 0);
  assert.match(state.renders[0].id, /^banner-candidate-/);
}

async function assertIndependentlyLeasedAssetGeneration(): Promise<void> {
  const { runtime, state } = fakeRuntime({
    verdicts: { avatar: [accepted("avatar")], banner: [accepted("banner")] },
  });
  const avatar = await generateChannelArtAsset(
    "owner-test",
    "quiet-stoic",
    "avatar",
    IDENTITY,
    () => {},
    { runtime, version: { avatar: "avatar-stage-v1" } },
  );
  const banner = await generateChannelArtAsset(
    "owner-test",
    "quiet-stoic",
    "banner",
    IDENTITY,
    () => {},
    { runtime, version: { banner: "banner-stage-v1" } },
  );
  assert.match(avatar, /art\/avatar\/avatar-stage-v1\//);
  assert.match(banner, /art\/banner\/banner-stage-v1\//);
  assert.equal(state.avatarRenders.length, 1);
  assert.deepEqual(state.renders.map((render) => render.id.split("-candidate-")[0]), ["banner"]);
}

async function assertFlagBannerUsesSameGate(): Promise<void> {
  const { runtime, state } = fakeRuntime({
    verdicts: { banner: [accepted("banner")] },
  });
  const key = await generateFlagBanner(
    "owner-test",
    "quiet-stoic-de",
    { ...IDENTITY, name: "Der stille Stoiker" },
    "Germany",
    () => {},
    { runtime, version: { banner: "de-v1" }, maxAttempts: 1 },
  );
  assert.match(key, /art\/banner\/de-v1\//);
  assert.equal(state.renders.length, 1);
  assert.match(state.renders[0].prompt, /flag of Germany/i);
  assert.match(state.renders[0].prompt, /1546x423 safe area/i);
  assert(state.persisted.has(
    "owner/owner-test/channel/quiet-stoic-de/art/banner/de-v1/approval.json",
  ));
}

async function assertDefaultProviderHasNoFallback(): Promise<void> {
  const source = await readFile(new URL("../channelArt.ts", import.meta.url), "utf8");
  assert.match(source, /renderNovitaImage/);
  assert.match(source, /generateFalNanoBananaAvatarImageWithReceipt/);
  assert.match(source, /NANO_BANANA_AVATAR_PROFILE/);
  assert.match(source, /novitaCostEnvelope/);
  assert.match(source, /maxProviderSpendUsd/);
  assert.match(source, /imageJobs: args\.maxAttempts/);
  assert.doesNotMatch(source, /generateFalImage|replicate|generateFluxImage/);
  assert.match(source, /profileId: "production"/);
  assert.match(source, /ifNoneMatch: "\*"/);
  assert.match(source, /hasJudge: hasVisionKey/);
  assert.doesNotMatch(source, /hasJudge: hasGeminiKey/);

  const refreshSource = await readFile(
    new URL("../../trigger/refreshShowBible.ts", import.meta.url),
    "utf8",
  );
  // Show-Bible refresh is intentionally a no-spend maintenance task. Identity
  // art must go through its admitted channel-inception stage, not an ambient
  // Trigger task that can silently create paid work.
  assert.doesNotMatch(refreshSource, /generateChannelArt/);
  assert.match(refreshSource, /refuses standalone paid art generation/);
  assert.match(refreshSource, /identity: \{ \.\.\.identity, creativeBrief \}/);
}

async function main(): Promise<void> {
  assertPromptContracts();
  await assertApprovedIndependentOutputs();
  await assertMissingJudgeFailsBeforeSpend();
  await assertRejectedCandidateNeverReturns();
  await assertExistingAvatarsArePreserved();
  await assertPerAssetPreservation();
  await assertIndependentlyLeasedAssetGeneration();
  await assertFlagBannerUsesSameGate();
  await assertDefaultProviderHasNoFallback();
  console.log("CHANNEL ART ROOT-CAUSE PASS");
}

void main();
