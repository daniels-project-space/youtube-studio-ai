import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { listChannelDirectory, listChannels } from "../../../convex/channels";

const ownerId = "owner-directory";
const channel = {
  _id: "channel-one", _creationTime: 1, ownerId, name: "Distinct channel", slug: "distinct",
  identity: { persona: "PERSONALITY_PRIVATE_CONTEXT".repeat(4000), palette: ["#123456", "#abcdef"],
    niche: "History", imageKey: `owner/${ownerId}/art.png`, styleGrammar: { detail: "large-style-packet" } },
  pipeline: [{ block: "music", config: { prompt: "large-module-configuration".repeat(1000) } }],
  architectReport: { notes: "large-report".repeat(1000) },
  budget: { daily: 10 }, status: "active",
};

function fixture(role = "viewer") {
  let queried = 0;
  const rows = [channel, { ...channel, _id: "channel-two", name: "No artwork", slug: "plain",
    identity: { persona: "Different personality", palette: [] } },
  { ...channel, _id: "foreign", ownerId: "other-owner" }];
  const db = { query: (table: string) => {
    queried++;
    assert.equal(table, "channels");
    return { withIndex: (index: string, build: (q: { eq: (key: string, value: string) => void }) => unknown) => {
      assert.equal(index, "by_owner");
      let selected = rows;
      build({ eq: (key, value) => {
        assert.equal(key, "ownerId");
        selected = rows.filter(row => row.ownerId === value);
      } });
      return { collect: async () => selected };
    } };
  } };
  const ctx = { db, auth: { getUserIdentity: async () => ({
    subject: role === "viewer" ? `viewer:${ownerId}` : ownerId, role, owner_id: ownerId,
  }) } };
  return {
    queried: () => queried,
    invoke: (definition: unknown, requestedOwner = ownerId): Promise<Record<string, unknown>[]> =>
      (definition as { _handler: (ctx: unknown, args: unknown) => Promise<Record<string, unknown>[]> })
        ._handler(ctx, { ownerId: requestedOwner }),
  };
}

test("directory retains navigation identity without transmitting full channel context", async () => {
  const before = JSON.stringify(channel);
  const f = fixture();
  const directory = await f.invoke(listChannelDirectory);
  assert.deepEqual(directory, [
    { _id: channel._id, name: channel.name, slug: channel.slug,
      identity: { imageKey: channel.identity.imageKey, niche: "History", palette: channel.identity.palette } },
    { _id: "channel-two", name: "No artwork", slug: "plain", identity: { imageKey: undefined, niche: undefined, palette: [] } },
  ]);
  const encoded = JSON.stringify(directory);
  assert.doesNotMatch(encoded, /PERSONALITY_PRIVATE_CONTEXT|pipeline|architectReport|budget|styleGrammar/);
  assert.ok(Buffer.byteLength(encoded) < Buffer.byteLength(before) / 100,
    "large-context fixture should shrink by more than 99%, without claiming fleet-wide savings");
  const full = await f.invoke(listChannels);
  assert.deepEqual(full[0], channel, "existing full-context consumers must retain every field");
  assert.equal(JSON.stringify(channel), before, "projection must not strip fields from the stored document");
});

test("directory preserves owner scoping and rejects owner spoofing before reading", async () => {
  for (const role of ["viewer", "owner"]) {
    const f = fixture(role);
    await assert.rejects(f.invoke(listChannelDirectory, "other-owner"), /owner access denied/);
    assert.equal(f.queried(), 0);
    const directory = await f.invoke(listChannelDirectory);
    assert.equal(directory.length, 2);
    assert.ok(directory.every(row => row._id !== "foreign"));
  }
});

test("real navigation, library and SEO callers use the same compact query", () => {
  for (const path of ["src/components/ChannelSwitcher.tsx", "src/app/(app)/library/page.tsx", "src/app/(app)/seo/page.tsx"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /useQuery\(api\.channels\.listChannelDirectory, \{ ownerId \}\)/);
    assert.doesNotMatch(source, /api\.channels\.listChannels\b/);
  }
});
