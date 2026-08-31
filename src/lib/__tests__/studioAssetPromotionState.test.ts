import assert from "node:assert/strict";

import {
  approveCandidate,
  getForOwnerApproval,
  listPendingForOwner,
  recordCandidate,
} from "../../../convex/studioAssetPromotions";
import { createStudioAssetPromotionCandidates } from "@/engine/studioAssetPromotion";
import { sha256Hex } from "@/lib/sha256";

type Stored = Record<string, unknown> & { readonly _id: string };
const OWNER = "owner-promotion";
const CHANNEL = "channel-promotion";
const RUN = "run-promotion";
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
    const found = tables.get(table);
    if (found) return found;
    const created: Stored[] = [];
    tables.set(table, created);
    return created;
  };
  const db = {
    get: async (id: string) => documents.get(String(id)) ?? null,
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
      rows(table).push({ ...value, _id: id } as Stored);
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

const visualMatter = {
  version: "visual-matter/v1" as const,
  status: "planned" as const,
  revision: digest("promotion-visual-matter"),
  topic: "A tiny bridge learns to listen to the wind",
  channelWorld: "paper city at sunset",
  moodBoard: {
    id: "mood-primary" as const,
    mood: "warm and observant",
    palette: ["paper cream", "sunset orange"],
    lighting: "long low light",
    visualPrompt: "tactile paper city, focused composition",
  },
  characters: [],
  settings: [{
    id: "setting-promotion",
    name: "paper city",
    continuityLock: "layered paper streets and a small wind bridge",
    stylePrompt: "clean dimensional paper layers",
  }],
  storyboard: [{
    shotId: "shot-promotion",
    beatId: "beat-promotion",
    t0: 0,
    t1: 4,
    characterIds: [],
    settingId: "setting-promotion",
    promptAddendum: "slow reveal across folded streets to the bridge",
    motionAddendum: "measured lateral slide with small parallax",
    acceptanceCriteria: ["stable material", "clear silhouette", "no accidental text"],
    referenceAssetIds: [],
  }],
  reviewLocks: [{
    shotId: "shot-promotion",
    startSec: 0,
    endSec: 4,
    expected: "a paper city bridge reveal",
    acceptanceCriteria: ["stable material", "clear silhouette", "no accidental text"],
  }],
  referenceAssets: [],
};

async function main() {
  const state = createMemoryState();
  const owner = state.context("owner");
  const service = state.context("service");
  const candidate = createStudioAssetPromotionCandidates({
    ownerId: OWNER,
    channelId: CHANNEL,
    runId: RUN,
    family: "cinematic",
    contentLane: "cinematic_ai",
    finalMasterReleaseCertificateKey: "owners/owner-promotion/runs/run-promotion/release.json",
    finalMasterReleaseCertificateFingerprint: digest("promotion-certificate"),
    finalMasterSha256: digest("promotion-master"),
    qualityEvidenceFingerprint: digest("promotion-quality"),
    visualReviewReceiptFingerprint: digest("promotion-visual-review"),
    visualQualityScore: 88,
    visualMinimumScore: 75,
    visualMatter,
    sourceEntryFingerprints: [],
  })[0]!;

  await expectRejected(
    () => invoke(recordCandidate, owner, { ownerId: OWNER, candidate }),
    /requires the bound studio service identity/i,
  );
  assert.equal(state.rows("studioAssetPromotionCandidates").length, 0);

  const storedId = await invoke<string>(recordCandidate, service, { ownerId: OWNER, candidate });
  assert.equal(
    await invoke<string>(recordCandidate, service, { ownerId: OWNER, candidate }),
    storedId,
    "candidate capture is idempotent for the exact sealed final-master observation",
  );
  await expectRejected(
    () => invoke(listPendingForOwner, owner, { ownerId: OWNER }),
    /requires the bound studio service identity/i,
  );
  const inventory = await invoke<Array<Record<string, unknown>>>(listPendingForOwner, service, { ownerId: OWNER });
  assert.equal(inventory.length, 1);
  assert.equal("recipe" in inventory[0]!, false);
  assert.equal("finalMasterReleaseCertificateKey" in inventory[0]!, false);

  assert.equal(
    await invoke(getForOwnerApproval, state.context("service", "other-owner"), {
      ownerId: "other-owner",
      candidateFingerprint: candidate.candidateFingerprint,
    }),
    null,
    "another owner cannot retrieve a candidate for certificate verification",
  );
  await expectRejected(
    () => invoke(approveCandidate, owner, {
      ownerId: OWNER,
      candidateFingerprint: candidate.candidateFingerprint,
      approvedBy: OWNER,
      approvedAt: 1_760_000_000_000,
    }),
    /requires the bound studio service identity/i,
  );

  const approvedId = await invoke<string>(approveCandidate, service, {
    ownerId: OWNER,
    candidateFingerprint: candidate.candidateFingerprint,
    approvedBy: OWNER,
    approvedAt: 1_760_000_000_000,
  });
  assert.equal(
    await invoke<string>(approveCandidate, service, {
      ownerId: OWNER,
      candidateFingerprint: candidate.candidateFingerprint,
      approvedBy: OWNER,
      approvedAt: 1_760_000_000_000,
    }),
    approvedId,
    "the same owner decision is idempotent",
  );
  assert.equal(state.rows("studioAssetLibraryEntries").length, 1);
  assert.equal(state.rows("studioAssetPromotionApprovals").length, 1);
  assert.deepEqual(
    await invoke<Array<Record<string, unknown>>>(listPendingForOwner, service, { ownerId: OWNER }),
    [],
    "an approved candidate leaves the browser-safe pending approval surface",
  );

  console.log("STUDIO ASSET PROMOTION STATE TESTS PASS");
}

void main();
