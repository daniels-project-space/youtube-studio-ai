import assert from "node:assert/strict";

import {
  claimEpisodeAndResolve,
  listInventory,
  recordEntry,
  recordUsage,
} from "../../../convex/studioReusableMedia";
import {
  STUDIO_REUSABLE_MEDIA_VERSION,
  createStudioReusableMediaEntry,
  createStudioReusableMediaUsageReceipt,
  type StudioReusableMediaPlan,
} from "@/engine/studioReusableMedia";
import { approvedThirdPartyStockSource } from "@/lib/thirdPartyStockEvidence";
import { sha256Hex } from "@/lib/sha256";

type Stored = Record<string, unknown> & { readonly _id: string };
const OWNER = "owner-media";
const CHANNEL = "channel-stoic";
const RUN_SOURCE = "run-source";
const RUN_ONE = "run-one";
const RUN_TWO = "run-two";
const RUN_THREE = "run-three";
const digest = (value: string) => sha256Hex(value);

function identity(role: "owner" | "service", ownerId = OWNER) {
  return {
    subject: role === "owner" ? ownerId : "service:youtube-studio-ai",
    issuer: "https://youtube-studio-ai.local",
    tokenIdentifier: `test|${role}`,
    role,
    owner_id: ownerId,
  };
}

function createMemoryState() {
  const tables = new Map<string, Stored[]>();
  const documents = new Map<string, Stored>([
    [CHANNEL, {
      _id: CHANNEL,
      ownerId: OWNER,
      family: "narrated_stock",
      identity: { programBrief: { nicheKey: "psychology", subcategory: "stoicism" } },
    }],
    ...[RUN_SOURCE, RUN_ONE, RUN_TWO, RUN_THREE].map((runId) => [runId, {
      _id: runId,
      ownerId: OWNER,
      channelId: CHANNEL,
    }] as const),
  ]);
  let next = 0;
  const rows = (table: string): Stored[] => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created: Stored[] = [];
    tables.set(table, created);
    return created;
  };
  const db = {
    get: async (id: string) => documents.get(String(id)) ?? null,
    normalizeId: (_table: string, value: string) => value,
    query: (table: string) => ({
      withIndex: (
        _index: string,
        select: (query: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        const predicates: Array<readonly [string, unknown]> = [];
        const query = {
          eq(field: string, value: unknown) {
            predicates.push([field, value]);
            return query;
          },
        };
        select(query);
        const matches = () => rows(table).filter((row) => predicates.every(([field, value]) => row[field] === value));
        return {
          unique: async () => {
            const found = matches();
            if (found.length > 1) throw new Error("test database unique index collision");
            return found[0] ?? null;
          },
          first: async () => matches()[0] ?? null,
          collect: async () => matches(),
        };
      },
    }),
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}:${++next}`;
      rows(table).push({ ...value, _id: id });
      return id;
    },
  };
  return {
    rows,
    context(role: "owner" | "service", ownerId = OWNER) {
      return { auth: { getUserIdentity: async () => identity(role, ownerId) }, db };
    },
  };
}

async function invoke<T>(definition: unknown, context: unknown, args: unknown): Promise<T> {
  return await (definition as { _handler: (handlerContext: unknown, handlerArgs: unknown) => Promise<T> })._handler(context, args);
}

function claimRequest(runId: string) {
  return {
    ownerId: OWNER,
    channelId: CHANNEL,
    runId,
    family: "narrated_stock",
    nicheKey: "psychology",
    subcategory: "stoicism",
    targetTimelineSeconds: 100,
    perAssetMaximumScreenSeconds: 12,
    queryTags: ["stoic", "ruins"],
    kinds: ["b_roll_video"],
  };
}

async function main() {
  const state = createMemoryState();
  const owner = state.context("owner");
  const service = state.context("service");
  const entry = createStudioReusableMediaEntry({
    version: STUDIO_REUSABLE_MEDIA_VERSION,
    logicalId: "media_stoic_ruins",
    ownerId: OWNER,
    channelId: CHANNEL,
    family: "narrated_stock",
    nicheKey: "psychology",
    subcategory: "stoicism",
    kind: "b_roll_video",
    status: "approved",
    title: "Quiet Roman ruins",
    editorialTags: ["ruins", "stoic"],
    evergreen: false,
    resource: {
      r2Key: "owner/owner-media/channel/channel-stoic/studio-media/clip.mp4",
      contentSha256: digest("clip"),
      contentType: "video/mp4",
      byteLength: 1_024,
      durationSec: 12,
      width: 3840,
      height: 2160,
    },
    source: {
      origin: "third_party_stock",
      source: approvedThirdPartyStockSource({
        provider: "pexels",
        assetId: "stoic-ruins",
        assetUrl: "https://www.pexels.com/video/12345/",
      }),
      acquiredAt: 1_780_000_000_000,
      relevanceScore: 9,
    },
    origin: {
      sourceRunId: RUN_SOURCE,
      finalMasterSha256: digest("source-master"),
      finalMasterReleaseCertificateFingerprint: digest("source-certificate"),
      visualReviewReceiptFingerprint: digest("source-review"),
      qualityEvidenceFingerprint: digest("source-quality"),
    },
    quality: {
      hardGateReady: true,
      calibrationComplete: true,
      finalMasterVisualScore: 9,
      finalMasterVisualMinimumScore: 8,
    },
    maximumLifetimeUses: 6,
    cooldownEpisodes: 2,
  });

  await assert.rejects(
    () => invoke(recordEntry, owner, { ownerId: OWNER, entry }),
    /requires the bound studio service identity/i,
  );
  const entryId = await invoke<string>(recordEntry, service, { ownerId: OWNER, entry });
  assert.equal(await invoke<string>(recordEntry, service, { ownerId: OWNER, entry }), entryId);

  const first = await invoke<StudioReusableMediaPlan>(claimEpisodeAndResolve, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    runId: RUN_ONE,
    request: claimRequest(RUN_ONE),
  });
  assert.equal(first.episodeOrdinal, 1);
  assert.equal(first.selections.length, 1);
  assert.equal(first.selections[0]?.assetFingerprint, entry.fingerprint);
  assert.deepEqual(
    await invoke<StudioReusableMediaPlan>(claimEpisodeAndResolve, service, {
      ownerId: OWNER,
      channelId: CHANNEL,
      runId: RUN_ONE,
      request: claimRequest(RUN_ONE),
    }),
    first,
    "a task retry must receive the same immutable ordinal and selection",
  );

  const usage = createStudioReusableMediaUsageReceipt({
    plan: first,
    finalMasterSha256: digest("release-master"),
    certificateFingerprint: digest("release-certificate"),
    actualUsage: {
      planFingerprint: first.fingerprint,
      uses: [{ assetFingerprint: entry.fingerprint, screenSeconds: first.selections[0]!.plannedScreenSeconds }],
      reusedTimelineSeconds: first.selections[0]!.plannedScreenSeconds,
    },
  });
  const usageIds = await invoke<readonly string[]>(recordUsage, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    runId: RUN_ONE,
    usage,
  });
  assert.equal(usageIds.length, 1);
  assert.deepEqual(await invoke<readonly string[]>(recordUsage, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    runId: RUN_ONE,
    usage,
  }), usageIds, "release usage must be idempotent");
  const conflictingUsage = createStudioReusableMediaUsageReceipt({
    plan: first,
    finalMasterSha256: digest("release-master"),
    certificateFingerprint: digest("release-certificate"),
    actualUsage: {
      planFingerprint: first.fingerprint,
      uses: [{ assetFingerprint: entry.fingerprint, screenSeconds: 6 }],
      reusedTimelineSeconds: 6,
    },
  });
  await assert.rejects(
    () => invoke(recordUsage, service, {
      ownerId: OWNER,
      channelId: CHANNEL,
      runId: RUN_ONE,
      usage: conflictingUsage,
    }),
    /cannot record conflicting usage/i,
  );

  const second = await invoke<StudioReusableMediaPlan>(claimEpisodeAndResolve, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    runId: RUN_TWO,
    request: claimRequest(RUN_TWO),
  });
  assert.equal(second.episodeOrdinal, 2);
  assert.equal(second.selections.length, 0, "cooldown evidence must suppress immediate media repetition");

  const third = await invoke<StudioReusableMediaPlan>(claimEpisodeAndResolve, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    runId: RUN_THREE,
    request: claimRequest(RUN_THREE),
  });
  assert.equal(third.episodeOrdinal, 3);
  assert.equal(third.originalEpisode, true);
  assert.equal(third.selections.length, 0, "every third claimed release must remain fully original");

  const inventory = await invoke<Array<Record<string, unknown>>>(listInventory, service, { ownerId: OWNER });
  assert.equal(inventory.length, 1);
  assert.equal("r2Key" in inventory[0]!, false);
  assert.equal("source" in inventory[0]!, false);
  assert.equal(state.rows("studioReusableMediaEpisodeClaims").length, 3);
  assert.equal(state.rows("studioReusableMediaUsageObservations").length, 1);

  const { fingerprint: _entryFingerprint, ...entryCore } = entry;
  void _entryFingerprint;
  const revoked = createStudioReusableMediaEntry({
    ...entryCore,
    status: "revoked",
    supersedesFingerprint: entry.fingerprint,
  });
  const revokedId = await invoke<string>(recordEntry, service, { ownerId: OWNER, entry: revoked });
  assert.notEqual(revokedId, entryId, "a status revision must supersede even when the immutable bytes are unchanged");
  const inventoryAfterRevocation = await invoke<Array<Record<string, unknown>>>(listInventory, service, { ownerId: OWNER });
  assert.equal(inventoryAfterRevocation.length, 1);
  assert.equal(inventoryAfterRevocation[0]?.status, "revoked");

  console.log("STUDIO REUSABLE MEDIA STATE TESTS PASS");
}

void main();
