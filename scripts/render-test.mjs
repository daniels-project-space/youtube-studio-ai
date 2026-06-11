/**
 * Render test harness (Phase 2+) — runs the REAL render pipeline in the cloud and
 * verifies the Style DNA actually drove generation.
 *
 * Flow: design a DNA-grounded channel (or reuse CHANNEL_ID) → createRun →
 * trigger run-pipeline → poll → pull run logs and confirm the scene + music were
 * DNA-grounded → report the output video.
 *
 * Env: TRIGGER_SECRET_KEY, CONVEX_URL, OWNER, NICHE_KEY, FAMILY, CHANNEL_ID?(reuse)
 */
const TRIGGER = "https://api.trigger.dev";
const SECRET = process.env.TRIGGER_SECRET_KEY;
const CONVEX = (process.env.CONVEX_URL ?? "https://astute-camel-689.convex.cloud").replace(/\/$/, "");
const OWNER = process.env.OWNER ?? "owner_daniel";
const NICHE_KEY = process.env.NICHE_KEY ?? "lofi";
const FAMILY = process.env.FAMILY ?? "music_loop";
if (!SECRET) { console.error("TRIGGER_SECRET_KEY required"); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function trigger(taskId, payload) {
  const r = await fetch(`${TRIGGER}/api/v1/tasks/${taskId}/trigger`, {
    method: "POST", headers: { Authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(`trigger ${taskId}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j.id;
}
async function poll(runId, label, maxMs = 900000) {
  const t0 = Date.now(); let last = "";
  while (Date.now() - t0 < maxMs) {
    const r = await fetch(`${TRIGGER}/api/v3/runs/${runId}`, { headers: { Authorization: `Bearer ${SECRET}` } });
    const j = await r.json(); const s = j.status ?? "?";
    if (s !== last) { console.log(`  [${label}] ${s} (+${Math.round((Date.now() - t0) / 1000)}s)`); last = s; }
    if (["COMPLETED", "FAILED", "CANCELED", "CRASHED", "TIMED_OUT", "INTERRUPTED", "SYSTEM_FAILURE"].includes(s)) return j;
    await sleep(8000);
  }
  throw new Error(`${label} timed out`);
}
async function cq(path, args) {
  const r = await fetch(`${CONVEX}/api/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, args, format: "json" }) });
  const j = await r.json(); if (j.status && j.status !== "success") throw new Error(`${path}: ${j.errorMessage ?? j.status}`); return j.value;
}
async function cm(path, args) {
  const r = await fetch(`${CONVEX}/api/mutation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, args, format: "json" }) });
  const j = await r.json(); if (j.status && j.status !== "success") throw new Error(`${path}: ${j.errorMessage ?? j.status}`); return j.value;
}

(async () => {
  let channelId = process.env.CHANNEL_ID;
  if (!channelId) {
    console.log(`[1/4] design-channel (DNA-grounded) — ${FAMILY}/${NICHE_KEY}`);
    const did = await trigger("design-channel", { ownerId: OWNER, family: FAMILY, nicheKey: NICHE_KEY, autoYoutube: false, budget: 5 });
    const d = await poll(did, "design");
    if (d.status !== "COMPLETED") { console.log("design failed:", JSON.stringify(d.output ?? d.error).slice(0, 400)); process.exit(2); }
    channelId = d.output?.channelId;
    console.log(`  channel=${channelId} "${d.output?.name}"`);
  } else console.log(`[1/4] reusing channel ${channelId}`);

  const dna = (await cq("channels:getChannel", { channelId }))?.styleDNA;
  console.log(`  DNA subject: ${dna?.recurringSubject?.slice(0, 60) || "(none)"}  conf=${dna?.confidence}`);

  console.log(`[2/4] createRun + trigger run-pipeline`);
  const runId = await cm("runs:createRun", { ownerId: OWNER, channelId });
  const rid = await trigger("run-pipeline", { channelId, runId });
  console.log(`  runId=${runId} triggerRun=${rid}`);

  console.log(`[3/4] rendering…`);
  const r = await poll(rid, "render");

  console.log(`[4/4] verify DNA drove generation`);
  const logs = await cq("runLogs:listRunLogs", { runId });
  const lines = (logs ?? []).map((l) => l.message ?? l.line ?? "").filter(Boolean);
  const find = (re) => lines.find((m) => re.test(m));
  console.log("  scene_planner:", find(/scene_planner:/)?.slice(0, 140) || "(not found)");
  console.log("  music:        ", find(/music: prompt source/)?.slice(0, 100) || "(not found)");
  const dnaGrounded = !!find(/DNA-grounded/);
  const musicDNA = !!find(/prompt source = style DNA/);
  const vids = await cq("videos:listVideos", { ownerId: OWNER });
  const mine = (vids ?? []).filter((v) => v.channelId === channelId).sort((a, b) => (b._creationTime || 0) - (a._creationTime || 0))[0];

  console.log("\n===== RENDER VERDICT =====");
  console.log(`render status:   ${r.status}`);
  console.log(`scene DNA-grounded: ${dnaGrounded ? "YES ✅" : "NO ⚠️"}`);
  console.log(`music from DNA:     ${musicDNA ? "YES ✅" : "NO ⚠️"}`);
  console.log(`output video:    ${mine ? `${mine.r2Key || mine.youtubeVideoId || mine._id} (status=${mine.status})` : "(none yet)"}`);
  if (r.status !== "COMPLETED") {
    const errs = lines.filter((m) => /error|fail|throw/i.test(m)).slice(-6);
    console.log("recent errors:\n  " + (errs.join("\n  ") || "(none in logs)"));
  }
  console.log(`\n${r.status === "COMPLETED" && dnaGrounded && musicDNA ? "✅ DNA CONSUMPTION VALIDATED IN A REAL RENDER" : "⚠️ REVIEW"}`);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
