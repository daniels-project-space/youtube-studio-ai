/**
 * A/B render — same stoic channel + same topic, 2-minute video, footage path
 * toggled: OLD (legacyFootage: Pexels 1080p, single-frame gate, sequential) vs
 * NEW (footagecraft: federated 4K, multi-frame gate, concurrent). Everything
 * else identical. Renders run on Trigger cloud → R2 (nothing local).
 */
const TRIGGER = "https://api.trigger.dev";
const SECRET = process.env.TRIGGER_SECRET_KEY;
const CONVEX = (process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL ?? "https://astute-camel-689.convex.cloud").replace(/\/$/, "");
const OWNER = "owner_daniel";
const CHANNEL_ID = "j97ax079vqhn58tkhg2yhdty9x87xaj5"; // The Quiet Stoic
const SLUG = "the-quiet-stoic-1780409262742";
const TOPIC = "Marcus Aurelius and the discipline of beginning a hard day";
if (!SECRET) { console.error("TRIGGER_SECRET_KEY required"); process.exit(1); }

const KEEP = new Set([
  "topic_select", "script_gen", "narration_tts",
  "stock_footage", "entity_imagery", "music", "intro_card", "quote_overlays",
  "timeline_assemble", "length_check",
]);

async function convexQuery(path, args) {
  const r = await fetch(`${CONVEX}/api/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, args, format: "json" }) });
  const j = await r.json();
  if (j.status !== "success") throw new Error(`convex ${path}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.value;
}
async function convexMutation(path, args) {
  const r = await fetch(`${CONVEX}/api/mutation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, args, format: "json" }) });
  const j = await r.json();
  if (j.status !== "success") throw new Error(`convex ${path}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.value;
}
async function triggerRun(payload, concurrencyKey) {
  const r = await fetch(`${TRIGGER}/api/v1/tasks/run-pipeline/trigger`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ payload, options: { concurrencyKey, ttl: "3600s" } }),
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(`trigger failed: HTTP ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j.id;
}

function buildOverride(pipe, legacy) {
  return pipe
    .filter((e) => KEEP.has(e.block))
    .map((e) => {
      const p = { ...(e.params ?? {}) };
      if (e.block === "script_gen") { p.maxSeconds = 120; p.endWithSummary = false; }
      if (e.block === "length_check") { p.minSeconds = 60; p.maxSeconds = 200; }
      if (e.block === "music") { p.trackCount = 1; }
      if (e.block === "stock_footage") { p.signatureGenClips = 0; if (legacy) p.legacyFootage = true; }
      if (e.block === "quote_overlays") { p.maxQuotes = 1; }
      return { block: e.block, params: Object.keys(p).length ? p : undefined };
    });
}

const main = async () => {
  const ch = await convexQuery("channels:getChannel", { channelId: CHANNEL_ID });
  const pipe = ch.pipeline ?? [];
  const variants = [
    { tag: "NEW", legacy: false },
    { tag: "OLD", legacy: true },
  ];
  const out = [];
  for (const v of variants) {
    const runId = await convexMutation("runs:createRun", { ownerId: OWNER, channelId: CHANNEL_ID });
    const override = buildOverride(pipe, v.legacy);
    const triggerId = await triggerRun(
      { channelId: CHANNEL_ID, runId, pipelineOverride: override, reuse: { topic: TOPIC } },
      `${CHANNEL_ID}-${v.tag.toLowerCase()}`,
    );
    const videoKey = `owner/${OWNER}/channel/${SLUG}/runs/${runId}/final.mp4`;
    out.push({ tag: v.tag, runId, triggerId, videoKey });
    console.log(`${v.tag}: runId=${runId} trigger=${triggerId}`);
    console.log(`     videoKey=${videoKey}`);
  }
  console.log("\nJSON " + JSON.stringify(out));
};
main().catch((e) => { console.error("ab-render failed:", e); process.exit(1); });
