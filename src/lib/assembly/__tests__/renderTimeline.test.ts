/**
 * renderTimeline orchestration test (tsx) — fake backend, no real ffmpeg.
 *
 * Proves the deterministic orchestration contract:
 *   - validate-before-spend (invalid plan throws BEFORE any backend call)
 *   - full render issues the ops in the right order + a correct Receipt
 *   - whole-video idempotency (final cached → 0 render calls)
 *   - heal from the pre-overlay checkpoint (skips body/compose, re-finishes overlays)
 *   - no silent skips (backend overlay warnings surface in the Receipt)
 */
import assert from "node:assert/strict";
import { renderTimeline, hashTimeline, type RenderBackend } from "../renderTimeline";
import { planTimeline, type PlanInput } from "../planTimeline";
import type { Timeline } from "../timeline";

function plan(): Timeline {
  const input: PlanInput = {
    footageClips: ["f0.mp4", "f1.mp4", "f2.mp4"],
    entityClips: ["e0.jpg"],
    narrationSrc: "n.wav",
    narrationDurationSec: 120,
    musicSrc: "m.mp3",
    introCardSrc: "intro.mp4",
    closingLine: "Stay sharp.",
    channelName: "Test",
    overlays: [
      { kind: "caption", startSec: 5, endSec: 60 },
      { kind: "quote", startSec: 62, endSec: 70 },
      { kind: "insert", startSec: 80, endSec: 95 }, // 3 overlays → fake emits a warning
    ],
  };
  return planTimeline(input);
}

function fake(seed: Record<string, string> = {}) {
  const calls: string[] = [];
  const cache = new Map<string, string>(Object.entries(seed));
  const be: RenderBackend = {
    async renderCard(c) { calls.push(`renderCard:${c.role}`); return `card_${c.role}.mp4`; },
    async buildBody(m) { calls.push(`buildBody:${m.length}`); return "body.mp4"; },
    async composeIntro() { calls.push("composeIntro"); return "composed.mp4"; },
    async patchOutro() { calls.push("patchOutro"); return "withOutro.mp4"; },
    async applyOverlays(_b, ov) { calls.push(`applyOverlays:${ov.length}`); return { path: "final.mp4", applied: ov.length, warnings: ov.length > 2 ? ["dropped insert (no template)"] : [] }; },
    async probe() { return 128; },
    async cacheGet(k) { return cache.get(k) ?? null; },
    async cachePut(k, p) { cache.set(k, p); },
    async publish() { calls.push("publish"); return "render/published.mp4"; },
  };
  return { be, calls, cache };
}

async function fullRender(): Promise<void> {
  const t = plan();
  const { be, calls } = fake();
  const r = await renderTimeline(t, be);
  // ops issued in the right order
  assert.deepEqual(
    calls.filter((c) => !c.startsWith("buildBody") && !c.startsWith("applyOverlays")),
    ["renderCard:intro", "composeIntro", "renderCard:outro", "patchOutro", "publish"],
    "render pipeline runs cards → compose → outro → publish in order",
  );
  assert.ok(calls.some((c) => c.startsWith("buildBody")), "body was built");
  assert.equal(r.healedFrom, "full", "full render path");
  assert.equal(r.overlaysApplied, 3, "all 3 overlays applied");
  assert.ok(r.cardsRendered >= 2, "intro + outro cards rendered");
  assert.equal(r.segmentsRendered, t.segments.filter((s) => s.kind !== "card").length, "clip count reported");
  assert.ok(r.videoKey.length > 0 && r.durationSec === 128, "receipt has a key + duration");
  console.log("FULL RENDER PASS: ordered ops + correct receipt");
}

async function validateBeforeSpend(): Promise<void> {
  const t = plan();
  // corrupt the plan: overlay past runtime
  (t.overlays as { endSec: number }[])[0].endSec = 9999;
  const { be, calls } = fake();
  await assert.rejects(() => renderTimeline(t, be), /invalid plan/, "invalid plan must throw");
  assert.equal(calls.length, 0, "NOTHING rendered when the plan is invalid (validate before spend)");
  console.log("VALIDATE-BEFORE-SPEND PASS: invalid plan throws before any backend call");
}

async function idempotency(): Promise<void> {
  const t = plan();
  const finalKey = `render/${hashTimeline(t, "v1")}.mp4`;
  const { be, calls } = fake({ [finalKey]: "cached_final.mp4" });
  const r = await renderTimeline(t, be);
  assert.equal(r.cacheHits, 1, "final cache hit");
  assert.equal(r.videoLocalPath, "cached_final.mp4", "returns the cached video");
  assert.equal(calls.length, 0, "no render calls on a cache hit (idempotent)");
  console.log("IDEMPOTENCY PASS: already-rendered plan short-circuits with 0 work");
}

async function healFromCheckpoint(): Promise<void> {
  const t = plan();
  const preKey = `render/${hashTimeline(t, "v1:preoverlay")}.mp4`;
  const { be, calls } = fake({ [preKey]: "pre_overlay.mp4" });
  const r = await renderTimeline(t, be);
  assert.equal(r.healedFrom, "preOverlay", "re-finished from the pre-overlay checkpoint");
  assert.ok(!calls.some((c) => c.startsWith("buildBody") || c === "composeIntro"), "body/compose SKIPPED on heal");
  assert.ok(calls.some((c) => c.startsWith("applyOverlays")), "overlays re-applied on heal");
  console.log("HEAL PASS: pre-overlay checkpoint skips rebuild, re-finishes overlays");
}

async function noSilentSkips(): Promise<void> {
  const r = await renderTimeline(plan(), fake().be);
  assert.ok(r.warnings.some((w) => /dropped insert/.test(w)), "a dropped overlay surfaces as a typed warning");
  console.log("NO-SILENT-SKIPS PASS: backend warnings surface on the receipt");
}

async function main(): Promise<void> {
  await fullRender();
  await validateBeforeSpend();
  await idempotency();
  await healFromCheckpoint();
  await noSilentSkips();
  console.log("\nALL RENDERTIMELINE TESTS PASSED");
}

main().catch((e) => { console.error("RENDERTIMELINE TEST FAILED:", e); process.exit(1); });
