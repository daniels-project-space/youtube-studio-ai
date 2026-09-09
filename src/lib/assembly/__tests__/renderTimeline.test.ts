/**
 * renderTimeline orchestration test (tsx) — fake backend by default.
 * EDL_RETAINED_MASTER=/absolute/existing.mp4 also runs read-only FFprobe proof.
 *
 * Proves the deterministic orchestration contract:
 *   - validate-before-spend (invalid plan throws BEFORE any backend call)
 *   - full render issues the ops in the right order + a correct Receipt
 *   - whole-video idempotency (final cached → 0 render calls)
 *   - heal from the pre-overlay checkpoint (skips body/compose, re-finishes overlays)
 *   - no silent skips (backend overlay warnings surface in the Receipt)
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderTimeline,
  hashTimeline,
  preOverlayCacheKey,
  type RenderBackend,
} from "../renderTimeline";
import { planTimeline, type PlanInput } from "../planTimeline";
import { projectedDurationSec, type Timeline } from "../timeline";

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

function fake(seed: Record<string, string> = {}, probeResult: number | Error = 128) {
  const calls: string[] = [];
  const probes: string[] = [];
  const cacheReads: string[] = [];
  const cacheWrites: string[] = [];
  const events: string[] = [];
  const cache = new Map<string, string>(Object.entries(seed));
  const be: RenderBackend = {
    async renderCard(c) { calls.push(`renderCard:${c.role}`); return `card_${c.role}.mp4`; },
    async buildBody(m) { calls.push(`buildBody:${m.length}`); return "body.mp4"; },
    async composeIntro() { calls.push("composeIntro"); return "composed.mp4"; },
    async patchOutro() { calls.push("patchOutro"); return "withOutro.mp4"; },
    async applyOverlays(_b, ov) { calls.push(`applyOverlays:${ov.length}`); return { path: "final.mp4", applied: ov.length, warnings: ov.length > 2 ? ["dropped insert (no template)"] : [] }; },
    async probe(path) {
      probes.push(path); events.push(`probe:${path}`);
      if (probeResult instanceof Error) throw probeResult;
      return probeResult;
    },
    async cacheGet(k) { cacheReads.push(k); return cache.get(k) ?? null; },
    async cachePut(k, p) { cacheWrites.push(k); events.push(`cachePut:${k}`); cache.set(k, p); },
    async publish(path) { calls.push("publish"); events.push(`publish:${path}`); return "render/published.mp4"; },
  };
  return { be, calls, probes, cacheReads, cacheWrites, events, cache };
}

async function fullRender(): Promise<void> {
  const t = plan();
  const { be, calls } = fake();
  const r = await renderTimeline(t, be);
  // ops issued in the right order
  // BOTH cards render BEFORE the compose, and the outro is FOLDED INTO that
  // single compose graph — the god-block's order/method (narratedBlocks.ts:
  // 2152-2202). The old order ended in a separate `patchOutro` pass: an entire
  // extra full-video x264 encode for a 3-second change, which the god-block's
  // own comment says was deliberately removed for cost (and which produced a
  // measured non-CFR frame-count mismatch).
  assert.deepEqual(
    calls.filter((c) => !c.startsWith("buildBody") && !c.startsWith("applyOverlays")),
    ["renderCard:intro", "renderCard:outro", "composeIntro", "publish"],
    "render pipeline renders both cards, folds the outro into ONE compose, then publishes",
  );
  assert.ok(!calls.includes("patchOutro"), "outro must NOT cost a second full-video encode");
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
  const original = structuredClone(t);
  const expected = projectedDurationSec(t);
  const finalKey = `render/${hashTimeline(t, "v1")}.mp4`;
  const { be, calls, probes, cacheReads, cacheWrites, cache } = fake({ [finalKey]: "cached_final.mp4" }, 127.551);
  const originalCache = new Map(cache);
  const r = await renderTimeline(t, be);
  assert.equal(r.cacheHits, 1, "final cache hit");
  assert.equal(r.videoKey, finalKey, "cached storage identity is unchanged");
  assert.equal(r.videoLocalPath, "cached_final.mp4", "returns the cached video");
  assert.equal(r.durationSec, 127.551, "cached receipt must carry fractional measured duration, not the plan");
  assert.notEqual(r.durationSec, expected);
  assert.deepEqual(t, original, "independent authored expectation is unchanged");
  assert.deepEqual(probes, ["cached_final.mp4"], "inspect the exact cached final file once");
  assert.deepEqual(cacheReads, [finalKey], "do not fall through to the pre-overlay checkpoint");
  assert.deepEqual(cacheWrites, [], "successful inspection does not overwrite any cache");
  assert.deepEqual(cache, originalCache);
  assert.deepEqual(calls, [], "no render, finishing or publish work on a cache hit");
  console.log("IDEMPOTENCY PASS: cached final measured once, fractional seconds preserved, zero render/cache-write/publish work");
}

async function invalidCachedDuration(): Promise<void> {
  for (const value of [0, -1, NaN, Infinity, -Infinity, new Error("fixture final probe failed")]) {
    const t = plan();
    const finalKey = `render/${hashTimeline(t, "v1")}.mp4`;
    const seed = { [finalKey]: "cached_final.mp4", [preOverlayCacheKey(t)]: "pre_overlay.mp4" };
    const { be, calls, probes, cacheReads, cacheWrites, cache } = fake(seed, value);
    await assert.rejects(() => renderTimeline(t, be), value instanceof Error ? /fixture final probe failed/ : /final master duration/);
    assert.deepEqual(probes, ["cached_final.mp4"]);
    assert.deepEqual(cacheReads, [finalKey], "bad final cache must not fall back to a pre-overlay heal or full render");
    assert.deepEqual(calls, [], "failed cached inspection starts no rendering, finishing or publishing");
    assert.deepEqual(cacheWrites, [], "failed cached inspection must not overwrite or evict cached artifacts");
    assert.deepEqual(cache, new Map(Object.entries(seed)));
  }
  console.log("CACHED REFUSAL PASS: zero/negative/non-finite/failed probes fail closed without render or cache mutation");
}

async function finalProbeContract(): Promise<void> {
  for (const healed of [false, true]) {
    for (const value of [128.123, 0, -1, NaN, Infinity, -Infinity, new Error("fixture final probe failed")]) {
      const t = plan();
      t.audio.targetLufs = -14;
      const original = structuredClone(t);
      const finalKey = `render/${hashTimeline(t, "v1")}.mp4`;
      const preKey = preOverlayCacheKey(t);
      const seed = healed ? { [preKey]: "pre_overlay.mp4" } : {};
      const { be, calls, probes, cacheWrites, events, cache } = fake(seed, value);
      // These local transport operations ensure the final probe follows the
      // existing finishing order; they never invoke an encoder or provider.
      be.normalizeLoudness = async (path) => {
        calls.push("normalizeLoudness"); events.push(`normalize:${path}`);
        return { path: "normalized_final.mp4", warnings: [] };
      };
      const success = typeof value === "number" && Number.isFinite(value) && value > 0;
      if (success) {
        const r = await renderTimeline(t, be);
        assert.equal(r.durationSec, value);
        assert.equal(r.healedFrom, healed ? "preOverlay" : "full");
        assert.ok(events.indexOf("normalize:final.mp4") < events.indexOf("probe:normalized_final.mp4"));
        assert.ok(events.indexOf("probe:normalized_final.mp4") < events.indexOf(`cachePut:${finalKey}`));
        assert.ok(events.indexOf(`cachePut:${finalKey}`) < events.indexOf("publish:normalized_final.mp4"));
      } else {
        await assert.rejects(() => renderTimeline(t, be), value instanceof Error ? /fixture final probe failed/ : /final master duration/);
        assert.ok(!calls.includes("publish"), "invalid fresh/healed final must not publish");
        assert.ok(!cache.has(finalKey), "invalid fresh/healed final must not enter final cache");
        assert.deepEqual(cacheWrites, healed ? [] : [preKey], "only the existing fresh pre-overlay checkpoint may be written");
      }
      assert.deepEqual(probes, ["normalized_final.mp4"], "fresh/heal inspect only the final post-normalization file once");
      assert.deepEqual(t, original, "measurement never mutates the independent authored plan");
      if (healed) assert.ok(!calls.some((call) => call.startsWith("renderCard") || call.startsWith("buildBody") || call === "composeIntro"));
    }
  }
  console.log("FINAL PROBE PASS: fresh and pre-overlay heal preserve fractional measurements and reject invalid finals before final cache/publish");
}

async function healFromCheckpoint(): Promise<void> {
  const t = plan();
  const preKey = preOverlayCacheKey(t);
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

async function retainedMasterProbe(): Promise<void> {
  const path = process.env.EDL_RETAINED_MASTER;
  if (!path) return; // Explicit integration mode; the normal suite is transport-only.
  assert.ok(isAbsolute(path), "retained integration requires an explicit absolute local file");
  const { probe } = await import("@/lib/ffmpeg");
  const digest = () => createHash("sha256").update(readFileSync(path)).digest("hex");
  const before = digest();
  const measured = await probe(path);
  const t = plan();
  const original = structuredClone(t);
  const finalKey = `render/${hashTimeline(t, "v1")}.mp4`;
  const { be, calls, probes, cacheReads, cacheWrites, cache } = fake({ [finalKey]: path });
  be.probe = async (file) => { probes.push(file); return (await probe(file)).durationSec; };
  const receipt = await renderTimeline(t, be);
  assert.equal(receipt.durationSec, measured.durationSec);
  assert.deepEqual(probes, [path]);
  assert.deepEqual(cacheReads, [finalKey]);
  assert.deepEqual(calls, []);
  assert.deepEqual(cacheWrites, []);
  assert.deepEqual(cache, new Map([[finalKey, path]]));
  assert.deepEqual(t, original);
  assert.equal(digest(), before, "retained master bytes must remain untouched");
  console.log(JSON.stringify({ proof: "retained-master-ffprobe", path, sha256: before,
    expectedPlanSec: projectedDurationSec(t), measuredSec: measured.durationSec,
    returnedSec: receipt.durationSec, backendProbeCalls: probes.length, writes: 0 }));

  // A real FFprobe process must reject a retained non-media file without
  // invoking any render or write operation on the failed cache path.
  const nonMedia = fileURLToPath(import.meta.url);
  const invalid = fake({ [finalKey]: nonMedia });
  invalid.be.probe = async (file) => { invalid.probes.push(file); return (await probe(file)).durationSec; };
  await assert.rejects(() => renderTimeline(t, invalid.be), /ffprobe|Invalid data|failed/i);
  assert.deepEqual(invalid.probes, [nonMedia]);
  assert.deepEqual(invalid.calls, []);
  assert.deepEqual(invalid.cacheReads, [finalKey]);
  assert.deepEqual(invalid.cacheWrites, []);
  assert.deepEqual(invalid.cache, new Map([[finalKey, nonMedia]]));
  console.log("RETAINED FFPROBE PASS: measured existing master and refused non-media cache; no render, download, publish or cache mutation");
}

async function main(): Promise<void> {
  await fullRender();
  await validateBeforeSpend();
  await idempotency();
  await invalidCachedDuration();
  await finalProbeContract();
  await healFromCheckpoint();
  await noSilentSkips();
  await retainedMasterProbe();
  console.log("\nALL RENDERTIMELINE TESTS PASSED");
}

main().catch((e) => { console.error("RENDERTIMELINE TEST FAILED:", e); process.exit(1); });
