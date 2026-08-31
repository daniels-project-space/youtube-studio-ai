import assert from "node:assert/strict";

import {
  listForChannel,
  listInventory,
  listReleaseFeedback,
  recordEntry,
  recordReleaseUsage,
  resolveForPipeline,
} from "../../../convex/studioAssetLibrary";
import {
  createStudioAssetLibraryEntry,
  createStudioAssetReleaseUsageReceipt,
  type StudioAssetLibraryEntryCore,
} from "@/engine/studioAssetLibrary";
import { sha256Hex } from "@/lib/sha256";

type Stored = Record<string, unknown> & { readonly _id: string };
const OWNER = "owner-library";
const CHANNEL = "channel-library";
const RUN = "run-library";
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
    [CHANNEL, { _id: CHANNEL, ownerId: OWNER }],
    [RUN, { _id: RUN, ownerId: OWNER, channelId: CHANNEL }],
  ]);
  let next = 0;
  const rows = (table: string): Stored[] => {
    const stored = tables.get(table);
    if (stored) return stored;
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
          collect: async () => matches(),
        };
      },
    }),
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}:${++next}`;
      const row = { ...value, _id: id } as Stored;
      rows(table).push(row);
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

async function expectRejected(run: () => Promise<unknown>, expression: RegExp) {
  await assert.rejects(run, expression);
}

function core(overrides: Partial<StudioAssetLibraryEntryCore> = {}): StudioAssetLibraryEntryCore {
  return {
    version: "studio-asset-library/v1",
    logicalId: "studio-camera-orbit",
    title: "Studio camera orbit",
    scope: "owned_studio",
    assetKind: "camera_recipe",
    identitySensitivity: "portable",
    status: "approved",
    compatibility: { families: ["comic"], contentLanes: ["cinematic_ai"], moduleIds: ["visual_matter"], treatments: [], runtimeFingerprint: digest("runtime") },
    approval: { provenanceFingerprint: digest("prov"), qualityEvidenceFingerprint: digest("quality"), qualityScore: 91, approvedBy: "reviewer", approvedAt: 1_700_000_000_000 },
    recipe: { version: "studio-asset-recipe/v1", promptFragments: ["steady orbit"], controlValues: {}, instructionFingerprint: digest("instruction") },
    ...overrides,
  };
}

function request() {
  return {
    channelId: CHANNEL,
    family: "comic",
    contentLane: "cinematic_ai",
    moduleId: "visual_matter",
    runtimeFingerprint: digest("runtime"),
    requiredKinds: ["camera_recipe"],
  };
}

async function main() {
  const state = createMemoryState();
  const owner = state.context("owner");
  const service = state.context("service");
  const approved = createStudioAssetLibraryEntry(core());

  await expectRejected(
    () => invoke(recordEntry, owner, { ownerId: OWNER, entry: approved }),
    /requires the bound studio service identity/i,
  );
  assert.equal(state.rows("studioAssetLibraryEntries").length, 0);

  const id = await invoke<string>(recordEntry, service, { ownerId: OWNER, entry: approved });
  assert.equal(await invoke<string>(recordEntry, service, { ownerId: OWNER, entry: approved }), id, "same immutable entry is idempotent");

  await expectRejected(
    () => invoke(listInventory, owner, { ownerId: OWNER }),
    /requires the bound studio service identity/i,
  );
  const inventory = await invoke<Array<{ fingerprint: string }>>(listInventory, service, { ownerId: OWNER });
  assert.deepEqual(inventory.map((item) => item.fingerprint), [approved.fingerprint]);
  await expectRejected(
    () => invoke(listForChannel, owner, { ownerId: OWNER, channelId: CHANNEL }),
    /requires the bound studio service identity/i,
  );
  const channelInventory = await invoke<Array<{ fingerprint: string }>>(listForChannel, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
  });
  assert.deepEqual(channelInventory.map((item) => item.fingerprint), [approved.fingerprint]);

  const result = await invoke<{ status: string }>(resolveForPipeline, service, { ownerId: OWNER, request: request() });
  assert.equal(result.status, "resolved");

  const usage = createStudioAssetReleaseUsageReceipt({
    finalMaster: { sha256: digest("studio-library-release-master"), durationSec: 12 },
    family: "comic",
    contentLane: "cinematic_ai",
    visualReview: {
      reviewFingerprint: "studio-library-release-review",
      reviewReceiptFingerprint: digest("studio-library-release-review-receipt"),
    },
    qualityEvidence: {
      bindingFingerprint: digest("studio-library-release-quality-binding"),
      qualityEvidenceFingerprint: digest("studio-library-release-quality"),
      hardGateReady: true,
      calibrationComplete: true,
      visualStatus: "pass",
      visualScore: 8.1,
      visualMinimumScore: 7,
    },
    uses: [{
      assetEntryFingerprint: approved.fingerprint,
      moduleId: "visual_matter",
      projectionFingerprint: digest("studio-library-release-projection"),
    }],
  });
  await expectRejected(
    () => invoke(recordReleaseUsage, owner, {
      ownerId: OWNER,
      channelId: CHANNEL,
      runId: RUN,
      certificateFingerprint: digest("studio-library-release-certificate"),
      usage,
    }),
    /requires the bound studio service identity/i,
  );
  const observationIds = await invoke<readonly string[]>(recordReleaseUsage, service, {
    ownerId: OWNER,
    channelId: CHANNEL,
    runId: RUN,
    certificateFingerprint: digest("studio-library-release-certificate"),
    usage,
  });
  assert.equal(observationIds.length, 1);
  assert.deepEqual(
    await invoke<readonly string[]>(recordReleaseUsage, service, {
      ownerId: OWNER,
      channelId: CHANNEL,
      runId: RUN,
      certificateFingerprint: digest("studio-library-release-certificate"),
      usage,
    }),
    observationIds,
    "an immutable release certificate records each Studio asset/module observation exactly once",
  );
  assert.equal(state.rows("studioAssetReleaseUsageObservations").length, 1);
  const feedback = await invoke<Array<{
    assetEntryFingerprint: string;
    sealedFinalMasters: number;
    demonstratedForEqualApprovalTieBreak: boolean;
    usage?: unknown;
  }>>(listReleaseFeedback, service, { ownerId: OWNER });
  assert.deepEqual(
    feedback.map((item) => ({
      assetEntryFingerprint: item.assetEntryFingerprint,
      sealedFinalMasters: item.sealedFinalMasters,
      demonstratedForEqualApprovalTieBreak: item.demonstratedForEqualApprovalTieBreak,
    })),
    [{
      assetEntryFingerprint: approved.fingerprint,
      sealedFinalMasters: 1,
      demonstratedForEqualApprovalTieBreak: false,
    }],
    "the Studio may display compact post-release evidence without exposing the sealed receipt itself",
  );
  assert.equal(Object.hasOwn(feedback[0] ?? {}, "usage"), false);

  const deprecation = createStudioAssetLibraryEntry(core({
    status: "deprecated",
    supersedesFingerprint: approved.fingerprint,
  }));
  await invoke(recordEntry, service, { ownerId: OWNER, entry: deprecation });
  const retired = await invoke<{ status: string }>(resolveForPipeline, service, { ownerId: OWNER, request: request() });
  assert.equal(retired.status, "no_approved_match", "a superseding deprecation removes the old entry from resolution");

  await expectRejected(
    () => invoke(recordEntry, service, { ownerId: OWNER, entry: createStudioAssetLibraryEntry(core({ logicalId: "studio-camera-orbit", title: "Unlinked revision" })) }),
    /requires its exact current predecessor/i,
  );
  const otherOwner = await invoke<{ status: string }>(resolveForPipeline, state.context("service", "other-owner"), {
    ownerId: "other-owner",
    request: request(),
  });
  assert.equal(otherOwner.status, "no_approved_match", "another owner cannot discover or reuse this owner’s Studio entries");

  console.log("STUDIO ASSET LIBRARY STATE TESTS PASS");
}

void main();
