import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  avatarPrompt,
  bannerPrompt,
  channelArtIdentityFromSource,
  generateChannelArt,
  generateChannelArtAsset,
  generateFlagBanner,
  type ChannelArtRuntime,
} from "@/lib/channelArt";
import {
  NANO_BANANA_AVATAR_PROFILE,
  type NanoBananaAvatarReceipt,
} from "@/lib/nanoBananaAvatarContract";
import {
  FAL_NANO_BANANA_BANNER_PROFILE,
  type FalNanoBananaBannerReceipt,
} from "@/lib/falNanoBananaBannerContract";

type Kind = "avatar" | "banner";

interface RuntimeState {
  bannerRenders: Array<{ prompt: string; idempotencyContext: string }>;
  avatarRenders: Array<{ prompt: string; idempotencyContext: string }>;
  renderedKeys: string[];
  conversions: Array<{ input: string; output: string; width: number; height: number }>;
  crops: Array<{ input: string; output: string; width: number; height: number }>;
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
    : { score, safeArea: true, edgeToEdge: true, noText: true, issues: [] };
}

function rejected(kind: Kind, issue: string, score = 0.45): Record<string, unknown> {
  return kind === "avatar"
    ? { score, circleSafe: false, tinyLegible: false, noText: true, issues: [issue] }
    : { score, safeArea: false, edgeToEdge: true, noText: true, issues: [issue] };
}

function fakeRuntime(config: {
  hasJudge?: boolean;
  verdicts?: Partial<Record<Kind, unknown[]>>;
} = {}): { runtime: ChannelArtRuntime; state: RuntimeState } {
  const state: RuntimeState = {
    bannerRenders: [],
    avatarRenders: [],
    renderedKeys: [],
    conversions: [],
    crops: [],
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
  const bannerReceipt = (ordinal: number): FalNanoBananaBannerReceipt => ({
    provider: FAL_NANO_BANANA_BANNER_PROFILE.provider,
    model: FAL_NANO_BANANA_BANNER_PROFILE.model,
    apiVersion: FAL_NANO_BANANA_BANNER_PROFILE.apiVersion,
    providerRequestId: `fixture-banner-${ordinal}`,
    route: FAL_NANO_BANANA_BANNER_PROFILE.route,
    width: FAL_NANO_BANANA_BANNER_PROFILE.accountingWidth,
    height: FAL_NANO_BANANA_BANNER_PROFILE.accountingHeight,
    promptUtf8Bytes: 400,
    outputCostUsd: FAL_NANO_BANANA_BANNER_PROFILE.outputImageUsd,
    costUsd: FAL_NANO_BANANA_BANNER_PROFILE.outputImageUsd,
    sourceContentType: "image/png",
    providerRequestCanonicalJson: "{}",
    providerRequestSha256: `banner-request-${ordinal}`,
    providerResponseMetadataCanonicalJson: "{}",
    providerResponseMetadataSha256: `banner-metadata-${ordinal}`,
    responseSha256: `banner-response-${ordinal}`,
    createdAt: ordinal,
  });
  const verdicts: Record<Kind, unknown[]> = {
    avatar: [...(config.verdicts?.avatar ?? [accepted("avatar")])],
    banner: [...(config.verdicts?.banner ?? [accepted("banner")])],
  };

  const runtime: ChannelArtRuntime = {
    hasJudge: () => config.hasJudge ?? true,
    renderBanner: async (request) => {
      state.bannerRenders.push(request);
      const ordinal = state.bannerRenders.length;
      return {
        bytes: new TextEncoder().encode(`fake-banner-${ordinal}`),
        receipt: bannerReceipt(ordinal),
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
    makeTempDir: async (prefix) => `/tmp/${prefix}`,
    toJpeg: async (input, output, width, height) => {
      state.conversions.push({ input, output, width, height });
      return output;
    },
    cropCenter: async (input, output, width, height) => {
      state.crops.push({ input, output, width, height });
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

const SEASIDE_IDENTITY = {
  ...IDENTITY,
  name: "Seaside Ghibli Lofi",
  worldSetting: "a vibrant hand-painted coastal storybook world with a deep-blue foaming ocean, piers, coves, and sunlit seaside rooms",
  worldComposition: "wide balanced framing with a strong foreground, ocean and sky breathing room, and a calm single focal story",
  worldMotifs: ["turquoise ocean waves", "paper lanterns", "coastal wildflowers", "a small fluffy cat"],
  visualAvoid: ["generic headphones-at-a-desk scene", "photorealistic CGI", "harsh neon cyberpunk"],
};

function assertIdentityDerivationUsesTheChannelWorld(): void {
  const derived = channelArtIdentityFromSource({
    name: "Investory",
    identity: {
      persona: "financial history explained through patient long-term thinking",
      styleGrammar: "sober heritage-finance editorial art",
      palette: ["near black", "aged bronze", "parchment", "muted teal"],
      niche: "finance",
      creativeBrief: {
        iconicMotif: "an antique bronze key whose teeth form a compound-growth rhythm",
        vibe: "earned insight and durable value",
      },
    },
    styleDNA: {
      setting: "an illuminated archival market archive of ledgers, price tapes, and patient human decision-making",
      composition: "one central institutional object with layered data-like depth, never a lifestyle desk",
      motifs: ["engraved ledger lines", "bronze key", "long-horizon growth curve"],
      visualAvoid: ["coffee desk", "generic trading monitors", "LoFi room", "neon cyberpunk"],
    },
  });
  const prompt = bannerPrompt(derived);
  assert.match(prompt, /archival market archive/i);
  assert.match(prompt, /long-horizon growth curve/i);
  assert.match(prompt, /DO NOT INTRODUCE:.*coffee desk/i);
  assert.doesNotMatch(prompt, /coastal storybook/i);
}

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
  assert.match(banner, /head no higher than 35% and the base no lower than 65%/i);
  assert.match(banner, /must fill every pixel of the canvas edge-to-edge/i);
  assert.match(banner, /absolutely no text/i);

  const seasideBanner = bannerPrompt(SEASIDE_IDENTITY);
  assert.match(seasideBanner, /LOCKED CHANNEL WORLD:.*coastal storybook/i);
  assert.match(seasideBanner, /RECURRING WORLD ANCHORS:.*turquoise ocean waves/i);
  assert.match(seasideBanner, /DO NOT INTRODUCE:.*generic headphones-at-a-desk scene/i);
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
  assert.equal(state.bannerRenders.length, 1);
  assert.match(state.avatarRenders[0].idempotencyContext, /art\/avatar\/avatar-v7\/avatar-candidate-01$/);
  assert.match(state.avatarRenders[1].prompt, /subject is too small/i, "critique must guide the retry");
  assert.match(state.bannerRenders[0].idempotencyContext, /art\/banner\/banner-v9\/banner-candidate-01$/);
  assert.match(state.bannerRenders[0].prompt, /absolutely no text/i);

  assert.match(result.imageKey, /art\/avatar\/avatar-v7\/approved\.jpg$/);
  assert.match(result.bannerKey, /art\/banner\/banner-v9\/approved\.jpg$/);
  assert.notEqual(result.imageKey, result.bannerKey);

  assert(state.conversions.some(({ width, height }) => width === 1024 && height === 1024));
  assert(state.conversions.some(({ width, height }) => width === 48 && height === 48));
  assert(state.conversions.some(({ width, height }) => width === 256 && height === 256));
  assert(state.conversions.some(({ width, height }) => width === 1280 && height === 720));
  assert.deepEqual(state.crops.map(({ input, width, height }) => ({ input, width, height })), [
    { input: "/tmp/channel-art-quiet-stoic-banner/banner-candidate-01-full.jpg", width: 773, height: 212 },
  ]);
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
  assert.equal(state.bannerRenders.length, 0, "missing judge must stop before a paid Nano Banana render");
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
  assert.equal(state.bannerRenders.length, 0);
  const keys = [...state.persisted.keys()];
  assert(keys.some((key) => key.endsWith("art/avatar/rejected-v2/rejection.json")));
  assert(!keys.some((key) => key.endsWith("approved.jpg")));
  assert(!keys.some((key) => key.endsWith("approval.json")));
}

async function assertLetterboxedBannerFailsClosed(): Promise<void> {
  const { runtime, state } = fakeRuntime({
    verdicts: {
      // A high score is not enough. Missing the explicit full-bleed proof must
      // reject a banner so a letterboxed provider image can never be promoted.
      banner: [{ score: 0.99, safeArea: true, noText: true, issues: ["black matte bars"] }],
    },
  });
  await assert.rejects(
    generateChannelArt("owner-test", "letterbox-reject", IDENTITY, () => {}, {
      runtime,
      avatar: false,
      banner: true,
      maxAttempts: 1,
      version: { banner: "letterbox-v1" },
      existing: { imageKey: "owners/owner-test/channels/letterbox-reject/art/avatar/approved.jpg" },
    }),
    /banner rejected after 1 attempts/i,
  );
  assert.equal(state.bannerRenders.length, 1);
  assert([...state.persisted.keys()].some((key) => key.endsWith("art/banner/letterbox-v1/rejection.json")));
  assert(![...state.persisted.keys()].some((key) => key.endsWith("art/banner/letterbox-v1/approved.jpg")));
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
    assert.equal(state.bannerRenders.length, 0);
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
  assert.equal(state.bannerRenders.length, 1);
  assert.equal(state.avatarRenders.length, 0);
  assert.match(state.bannerRenders[0].idempotencyContext, /banner-candidate-01$/);
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
  assert.deepEqual(
    state.bannerRenders.map((render) => render.idempotencyContext.split("/").at(-1)?.split("-candidate-")[0]),
    ["banner"],
  );
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
  assert.equal(state.bannerRenders.length, 1);
  assert.match(state.bannerRenders[0].prompt, /flag of Germany/i);
  assert.match(state.bannerRenders[0].prompt, /1546x423 safe area/i);
  assert(state.persisted.has(
    "owner/owner-test/channel/quiet-stoic-de/art/banner/de-v1/approval.json",
  ));
}

async function assertDefaultProviderHasNoFallback(): Promise<void> {
  const source = await readFile(new URL("../channelArt.ts", import.meta.url), "utf8");
  assert.match(source, /generateFalNanoBananaBannerWithReceipt/);
  assert.match(source, /generateFalNanoBananaAvatarImageWithReceipt/);
  assert.match(source, /NANO_BANANA_AVATAR_PROFILE/);
  assert.match(source, /FAL_NANO_BANANA_BANNER_PROFILE/);
  assert.match(source, /maxProviderSpendUsd/);
  assert.doesNotMatch(source, /renderNovitaImage|novitaCostEnvelope|generateFalImage|replicate|generateFluxImage/);
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
  assertIdentityDerivationUsesTheChannelWorld();
  await assertApprovedIndependentOutputs();
  await assertMissingJudgeFailsBeforeSpend();
  await assertRejectedCandidateNeverReturns();
  await assertLetterboxedBannerFailsClosed();
  await assertExistingAvatarsArePreserved();
  await assertPerAssetPreservation();
  await assertIndependentlyLeasedAssetGeneration();
  await assertFlagBannerUsesSameGate();
  await assertDefaultProviderHasNoFallback();
  console.log("CHANNEL ART ROOT-CAUSE PASS");
}

void main();
