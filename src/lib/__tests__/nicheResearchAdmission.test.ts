import assert from "node:assert/strict";
import { assertResearchChannel, assertResearchOwner, MAX_RESEARCH_BODY_BYTES, parseResearchInput, readResearchBody } from "@/lib/nicheResearchAdmission";
import { upsertDatabank } from "../../../convex/seo";

async function main() {
  assert.deepEqual(parseResearchInput({ niche: "  history  " }), { niche: "history" });
  assert.deepEqual(parseResearchInput({ niche: "history", channelId: "channel123" }), { niche: "history", channelId: "channel123" });
  for (const input of [null, [], {}, { niche: 4 }, { niche: " " }, { niche: "x".repeat(201) }, { niche: "history", channelId: 1 }, { niche: "history", channelId: " x " }, { niche: "history", channelId: "x".repeat(129) }]) {
    assert.throws(() => parseResearchInput(input));
  }
  assert.deepEqual(await readResearchBody(new Request("http://localhost", { method: "POST", body: '{"niche":"history"}' })), { niche: "history" });
  await assert.rejects(readResearchBody(new Request("http://localhost", { method: "POST", body: "x".repeat(MAX_RESEARCH_BODY_BYTES + 1) })), /too large/);
  await assert.rejects(readResearchBody(new Request("http://localhost", { method: "POST", body: "{" })), /invalid JSON/);
  assertResearchChannel({ ownerId: "a", identity: { niche: "history" } }, "a", "history");
  assertResearchOwner("a", "a");
  assert.throws(() => assertResearchOwner("b", "a"), /worker identity/);
  assert.throws(() => assertResearchChannel(null, "a", "history"), /not found/);
  assert.throws(() => assertResearchChannel({ ownerId: "b", identity: { niche: "history" } }, "a", "history"), /not found/);
  assert.throws(() => assertResearchChannel({ ownerId: "a", identity: { niche: "changed" } }, "a", "history"), /niche changed/);

  let writes = 0;
  const args = { ownerId: "a", niche: "history", channelId: "foreign", titleTemplates: [], tagClusters: [], thumbnailRules: [], hookPatterns: [], competitorGaps: [] };
  const context = { auth: { getUserIdentity: async () => ({ role: "service", owner_id: "a", subject: "service:a" }) }, db: {
    normalizeId: (_table: string, id: string) => id,
    get: async () => ({ ownerId: "b" }),
    insert: async () => { writes++; }, patch: async () => { writes++; },
  } };
  const invoke = (upsertDatabank as unknown as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })._handler;
  await assert.rejects(invoke(context, args), /access denied|channel not found/);
  assert.equal(writes, 0);
  console.log("Research admission passed: bounded input, owner and niche checks, cross-owner databank rejection without writes");
}
void main();
