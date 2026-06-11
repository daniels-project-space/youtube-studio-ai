/**
 * Phase test harness — runs the REAL cloud pipeline "as if you pressed the
 * button", then inspects what it produced. Reused to validate each phase.
 *
 * Phase 1 (default): force-refresh a niche's research (so thumbnail vision runs),
 * trigger `design-channel` exactly like the New-Channel wizard, poll to done,
 * then pull the created channel's Style DNA + Quality Bar from Convex and print a
 * blunt verdict on whether it's genuinely grounded/iterated/custom (vs generic).
 *
 * Env: TRIGGER_SECRET_KEY (prod), CONVEX_URL, OWNER, NICHE, NICHE_KEY, FAMILY.
 */
const TRIGGER = "https://api.trigger.dev";
const SECRET = process.env.TRIGGER_SECRET_KEY;
const CONVEX = (process.env.CONVEX_URL ?? "https://astute-camel-689.convex.cloud").replace(/\/$/, "");
const OWNER = process.env.OWNER ?? "owner_daniel";
const NICHE = process.env.NICHE ?? "Lo-Fi Music";
const NICHE_KEY = process.env.NICHE_KEY ?? "lofi";
const FAMILY = process.env.FAMILY ?? "music_loop";
if (!SECRET) { console.error("TRIGGER_SECRET_KEY required"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function triggerTask(taskId, payload) {
  const r = await fetch(`${TRIGGER}/api/v1/tasks/${taskId}/trigger`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(`trigger ${taskId} failed: HTTP ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j.id;
}

async function pollRun(runId, label, maxMs = 540000) {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < maxMs) {
    const r = await fetch(`${TRIGGER}/api/v3/runs/${runId}`, { headers: { Authorization: `Bearer ${SECRET}` } });
    const j = await r.json();
    const s = j.status ?? "?";
    if (s !== last) { console.log(`  [${label}] ${s} (+${Math.round((Date.now() - t0) / 1000)}s)`); last = s; }
    if (["COMPLETED", "FAILED", "CANCELED", "CRASHED", "TIMED_OUT", "INTERRUPTED", "SYSTEM_FAILURE"].includes(s)) return j;
    await sleep(6000);
  }
  throw new Error(`${label} poll timed out`);
}

async function convexQuery(path, args) {
  const r = await fetch(`${CONVEX}/api/query`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  const j = await r.json();
  if (j.status && j.status !== "success") throw new Error(`convex ${path}: ${j.errorMessage ?? j.status}`);
  return j.value;
}

(async () => {
  // 1. Force fresh research so thumbnail VISION runs (grounds the visual DNA).
  console.log(`\n[1/3] refresh-niche-research (force) — "${NICHE}"`);
  try {
    const rid = await triggerTask("refresh-niche-research", { ownerId: OWNER, niche: NICHE, force: true });
    const r = await pollRun(rid, "research");
    console.log(`  research → ${r.status}`, JSON.stringify(r.output ?? {}).slice(0, 200));
  } catch (e) { console.log(`  research step skipped/failed (non-fatal): ${e.message}`); }

  // 2. Press the button: design-channel (skip the real YouTube channel creation).
  console.log(`\n[2/3] design-channel — family=${FAMILY} niche=${NICHE_KEY}`);
  const did = await triggerTask("design-channel", {
    ownerId: OWNER, family: FAMILY, nicheKey: NICHE_KEY, autoYoutube: false, budget: 5,
  });
  const d = await pollRun(did, "design");
  console.log(`  design → ${d.status}`);
  if (d.status !== "COMPLETED") { console.log("  output:", JSON.stringify(d.output ?? d.error ?? {}).slice(0, 500)); process.exit(2); }
  const channelId = d.output?.channelId;
  console.log(`  channelId=${channelId} slug=${d.output?.slug} name="${d.output?.name}"`);

  // 3. Inspect what Phase 1 produced.
  console.log(`\n[3/3] inspect Style DNA + Quality Bar`);
  const ch = await convexQuery("channels:getChannel", { channelId });
  const dna = ch?.styleDNA;
  const bar = ch?.qaRubric;
  if (!dna) { console.log("  ❌ NO styleDNA persisted — Phase 1 did not run."); process.exit(3); }

  console.log("\n===== STYLE DNA =====");
  console.log(JSON.stringify(dna, null, 2));
  console.log("\n===== QUALITY BAR =====");
  console.log(JSON.stringify(bar, null, 2));

  // Blunt verdict — is it genuinely grounded/specific, or generic?
  const gaps = dna.groundingGaps ?? [];
  const genericTells = ["recurring central subject", "on-brand", "calm, consistent", "clean cohesive", "high quality", "visually appealing"];
  const blob = JSON.stringify(dna).toLowerCase();
  const hitTells = genericTells.filter((t) => blob.includes(t));
  console.log("\n===== VERDICT =====");
  console.log(`source:           ${dna.source}`);
  console.log(`confidence:       ${dna.confidence}  (established ≥ 0.7)`);
  console.log(`recurringSubject: ${dna.recurringSubject || "(EMPTY ❌)"}`);
  console.log(`setting:          ${dna.setting || "(EMPTY ❌)"}`);
  console.log(`motifs:           ${(dna.motifs || []).length}`);
  console.log(`palette:          ${(dna.palette || []).join(" ")}`);
  console.log(`audio:            ${dna.audio?.genre} ${dna.audio?.bpmRange?.join("-")}BPM, ${dna.audio?.loudnessLufs}LUFS`);
  console.log(`groundingGaps:    ${gaps.length ? gaps.join(" | ") : "(none)"}`);
  console.log(`generic tells:    ${hitTells.length ? "⚠️ " + hitTells.join(", ") : "none ✅"}`);
  console.log(`quality dims:     ${(bar?.dimensions || []).map((x) => x.id).join(", ")}`);
  const ok = dna.recurringSubject && dna.setting && (dna.motifs || []).length >= 2 && hitTells.length === 0;
  console.log(`\n${ok ? "✅ GENUINELY SPECIFIC + CUSTOM" : "⚠️ REVIEW — looks thin/generic"}  (confidence ${dna.confidence})`);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
