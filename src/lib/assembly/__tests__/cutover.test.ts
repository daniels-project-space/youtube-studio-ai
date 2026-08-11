/**
 * cutover adapter test (tsx) — pure mapping, no ffmpeg/Convex/R2.
 *
 *   ./node_modules/.bin/tsx src/lib/assembly/__tests__/cutover.test.ts
 *
 * Proves `buildPlanInput` maps the god-block's `ctx.store` shape → `PlanInput`
 * faithfully, and that `quoteOverlays` + `insertOverlays` (QuoteOverlaySpec[]) round-trip
 * into the typed EDL `Overlay[]` (and back through the renderer's overlaysToCuesAndSpecs
 * into the SAME specs — the inverse-of-inverse parity that lets the EDL path reproduce
 * the god-block's quotesApplied / insertsApplied).
 */
import assert from "node:assert/strict";
import {
  buildPlanInput,
  quoteSpecsToOverlays,
  paramsToAssemble,
  deriveProducesExtras,
  assembleViaEdl,
  type AssembleProduces,
} from "../cutover";
import { overlaysToCuesAndSpecs } from "../overlays";
import { TimelineSchema, ReceiptSchema, type Timeline, type Receipt, type Overlay, type Segment } from "../timeline";
import { preOverlayCacheKey, type RenderBackend } from "../renderTimeline";
import type { QuoteOverlaySpec } from "@/lib/ffmpeg";

/* ---------- 1. store → PlanInput field-by-field ---------- */
{
  const store: Record<string, unknown> = {
    footageClips: ["f0.mp4", "f1.mp4"],
    entityClips: ["e0.jpg"],
    narrationLocalPath: "narr.wav",
    narrationDurationSec: 120,
    introCardPath: "intro.mp4",
    introSec: 5,
    musicKey: "music/mix.mp3",
    musicUrl: "https://cdn/legacy.mp3", // musicKey wins
    sentenceTimings: [{ text: "A.", start: 0, end: 4 }, { text: "B.", start: 4, end: 9 }],
    cutSheet: { sections: [{ name: "body", cutsPerMin: 6 }] },
    chapterPlan: [{ kind: "card", durSec: 6, heading: "Part Two" }],
    channelName: "Investory",
    channelAvatarKey: "brand/avatar.png",
    script: { closingLine: "Stay curious." },
    quoteOverlays: [{ path: "q0.webm", startSec: 20, durSec: 6, text: "A quote." }],
    insertOverlays: [{ path: "i0.webm", startSec: 60, durSec: 8 }],
  };

  const pi = buildPlanInput(store, {});
  assert.deepEqual(pi.footageClips, ["f0.mp4", "f1.mp4"], "footageClips passthrough");
  assert.deepEqual(pi.entityClips, ["e0.jpg"], "entityClips passthrough");
  assert.equal(pi.narrationSrc, "narr.wav", "narrationLocalPath → narrationSrc");
  assert.equal(pi.narrationDurationSec, 120, "narrationDurationSec passthrough");
  assert.equal(pi.musicSrc, "music/mix.mp3", "musicKey wins over musicUrl");
  assert.equal(pi.introCardSrc, "intro.mp4", "introCardPath → introCardSrc");
  assert.deepEqual(pi.sentenceTimings, [{ end: 4 }, { end: 9 }], "sentenceTimings → {end} (drives onBeat)");
  assert.equal(pi.cutSheet?.sections?.[0]?.cutsPerMin, 6, "cutSheet passthrough");
  assert.equal(pi.chapterPlan?.[0]?.heading, "Part Two", "chapterPlan passthrough");
  assert.equal(pi.closingLine, "Stay curious.", "script.closingLine → closingLine");
  assert.equal(pi.channelName, "Investory", "channelName passthrough");
  assert.equal(pi.cardBgSrc, "brand/avatar.png", "channelAvatarKey → cardBgSrc");
  const overlays = pi.overlays ?? [];
  assert.equal(overlays.length, 3, "quote + insert + unblocked caption → 3 Overlay[]");
  assert.equal(overlays.filter((overlay) => overlay.kind === "quote").length, 1, "quote overlay preserved");
  assert.equal(overlays.filter((overlay) => overlay.kind === "insert").length, 1, "insert overlay preserved");
  assert.equal(
    overlays.filter((overlay) => overlay.kind === "caption").length,
    1,
    "caption mapping stays active while the chapter-window caption is suppressed",
  );
  console.log("STORE→PLANINPUT PASS: every god-block store key mapped");
}

/* ---------- 2. musicUrl fallback when no musicKey ---------- */
{
  const pi = buildPlanInput({ footageClips: ["f.mp4"], narrationDurationSec: 30, musicUrl: "https://cdn/m.mp3" }, {});
  assert.equal(pi.musicSrc, "https://cdn/m.mp3", "musicUrl is the fallback when musicKey absent");
  console.log("MUSIC FALLBACK PASS: musicKey ?? musicUrl");
}

/* ---------- 3. introCardPath "" ⇒ no intro card src ---------- */
{
  const pi = buildPlanInput({ footageClips: ["f.mp4"], narrationDurationSec: 30, introCardPath: "" }, {});
  assert.equal(pi.introCardSrc, undefined, "empty introCardPath ⇒ undefined (introSec collapses to 0 in plan)");
  console.log("COLD-OPEN PASS: blank introCardPath ⇒ no intro card");
}

/* ---------- 4. narrationDurationSec default (0/missing ⇒ 60) ---------- */
{
  const pi = buildPlanInput({ footageClips: ["f.mp4"] } as Record<string, unknown>, {});
  assert.equal(pi.narrationDurationSec, 60, "missing narrationDurationSec ⇒ god-block default 60");
  console.log("NARRATION DEFAULT PASS: missing ⇒ 60s");
}

/* ---------- 5. quoteOverlays + insertOverlays → Overlay[] (with kinds + round-trip) ---------- */
{
  const quotes: QuoteOverlaySpec[] = [
    { path: "q0.webm", startSec: 10, durSec: 6, text: "Quote A", highlights: ["A"], width: 1920, height: 1080, noBlur: false },
    { path: "q1.webm", startSec: 30, durSec: 5 },
  ];
  const inserts: QuoteOverlaySpec[] = [{ path: "i0.webm", startSec: 50, durSec: 8, noBlur: true }];

  const qOv = quoteSpecsToOverlays(quotes, "quote");
  const iOv = quoteSpecsToOverlays(inserts, "insert");
  assert.equal(qOv.length, 2, "2 quote overlays");
  assert.equal(iOv.length, 1, "1 insert overlay");
  assert.ok(qOv.every((o) => o.kind === "quote"), "quote kind tagged");
  assert.ok(iOv.every((o) => o.kind === "insert"), "insert kind tagged");
  assert.equal(qOv[0].startSec, 10, "startSec preserved");
  assert.equal(qOv[0].endSec, 16, "endSec = startSec + durSec");
  assert.equal(qOv[0].src, "q0.webm", "src = the rendered alpha card path");
  assert.deepEqual(qOv[0].data?.highlights, ["A"], "highlights carried in data");
  assert.equal(qOv[0].data?.width, 1920, "width carried in data");

  // INVERSE-OF-INVERSE: feed the Overlay[] through the renderer's mapper and prove
  // we get the SAME QuoteOverlaySpec back (path/start/dur/text/highlights/width/height/noBlur).
  const back = overlaysToCuesAndSpecs([...qOv, ...iOv]);
  assert.equal(back.specs.length, 3, "all 3 quote/insert specs round-trip (no drops)");
  assert.equal(back.cues.length, 0, "no caption cues from quote/insert overlays");
  const r0 = back.specs[0];
  assert.equal(r0.path, "q0.webm", "round-trip path");
  assert.equal(r0.startSec, 10, "round-trip startSec");
  assert.equal(r0.durSec, 6, "round-trip durSec");
  assert.equal(r0.text, "Quote A", "round-trip text");
  assert.deepEqual(r0.highlights, ["A"], "round-trip highlights");
  assert.equal(r0.width, 1920, "round-trip width");
  assert.equal(back.specs[2].noBlur, true, "round-trip noBlur on the insert");
  console.log("OVERLAY ROUND-TRIP PASS: QuoteOverlaySpec[] → Overlay[] → QuoteOverlaySpec[] is lossless");
}

/* ---------- 6. specs with a blank path are dropped (never faked) ---------- */
{
  const ov = quoteSpecsToOverlays([{ path: "", startSec: 1, durSec: 2 } as QuoteOverlaySpec], "quote");
  assert.equal(ov.length, 0, "a QuoteOverlaySpec with no media path is dropped (no invented card)");
  console.log("NO-FAKE PASS: blank-path spec dropped");
}

/* ---------- 7. paramsToAssemble mirrors the god-block param reads ---------- */
{
  const p = paramsToAssemble({ aspect: "9:16", tailSec: 2, minSeconds: 15, maxSeconds: 90, burnCaptions: false });
  assert.equal(p.aspect, "9:16", "aspect read");
  assert.equal(p.tailSec, 2, "tailSec read");
  assert.equal(p.minSeconds, 15, "minSeconds read");
  assert.equal(p.maxSeconds, 90, "maxSeconds read");
  assert.equal(p.captions, false, "burnCaptions:false ⇒ captions off");
  // defaults preserved where not overridden
  assert.equal(p.introMusicVol, 0.513, "introMusicVol default preserved");
  assert.equal(p.bodyMusicVol, 0.1026, "bodyMusicVol default preserved");
  const d = paramsToAssemble({});
  assert.equal(d.aspect, "16:9", "default aspect 16:9");
  assert.equal(d.tailSec, 3, "default tailSec 3");
  assert.equal(d.captions, true, "captions default ON (burnCaptions !== false)");
  console.log("PARAMS PASS: ctx.params → AssembleParams mirrors god-block reads");
}

/* ================================================================== *
 * PRODUCED-KEY CONTRACT — all 11 keys `timelineAssemble.produces`
 * declares (narratedBlocks.ts:1376-1388). A missing key lands as
 * `undefined` in ctx.store and silently voids the verify-stage gates
 * at narratedBlocks.ts:2170, 2365-2366, 2375-2376.
 * ================================================================== */

/** The exact 11 keys the live block declares, in declaration order. */
const PRODUCES_KEYS = [
  "videoKey",
  "videoLocalPath",
  "videoDurationSec",
  "quotesApplied",
  "insertsApplied",
  "captionsApplied",
  "captionCues",
  "outroApplied",
  "overlaysDropped",
  "preOverlayKey",
  "preOverlayLocalPath",
] as const;

/** Minimal VALID Timeline (zod-parsed so declared defaults are filled). */
function mkTimeline(o: { overlays?: Overlay[]; withOutro?: boolean; captionStyle?: "none" | "bold" } = {}): Timeline {
  const segments: Segment[] = [
    { kind: "card", role: "intro", durSec: 5, title: "T" },
    { kind: "footage", src: "f0.mp4", durSec: 40 },
    { kind: "footage", src: "f1.mp4", durSec: 25 },
  ];
  if (o.withOutro !== false) segments.push({ kind: "card", role: "outro", durSec: 3, title: "Thanks" });
  return TimelineSchema.parse({
    format: { w: 1920, h: 1080, fps: 30 },
    segments,
    audio: { introSec: 5, bodySec: 60, tailSec: 3, narrationSrc: "n.wav" },
    overlays: o.overlays ?? [],
    ...(o.captionStyle ? { renderHints: { captionStyle: o.captionStyle } } : {}),
  });
}

const cap = (startSec: number, text: string): Overlay => ({ kind: "caption", startSec, endSec: startSec + 2, text });
const quote = (startSec: number, src = "q.webm"): Overlay => ({ kind: "quote", startSec, endSec: startSec + 5, src });

function mkReceipt(o: { overlaysApplied: number; warnings?: string[] }): Receipt {
  return ReceiptSchema.parse({
    videoKey: "assembly/runs/r1/final.mp4",
    videoLocalPath: "/tmp/final.mp4",
    durationSec: 68,
    segmentsRendered: 2,
    cardsRendered: 2,
    overlaysApplied: o.overlaysApplied,
    warnings: o.warnings ?? [],
    cacheHits: 0,
    healedFrom: "full",
  });
}

/* ---------- 8. captions PRESENT and burned ---------- */
{
  const t = mkTimeline({ overlays: [cap(10, "Hello."), cap(14, "World."), quote(30)] });
  const x = deriveProducesExtras(t, mkReceipt({ overlaysApplied: 3 }));
  assert.equal(x.captionCues, 2, "2 caption overlays → 2 prepared cues");
  assert.equal(x.captionsApplied, true, "cues prepared + finishing pass composited ⇒ captionsApplied");
  assert.equal(x.overlaysDropped, 0, "nothing dropped when applied === planned");
  assert.equal(x.outroApplied, true, "outro card segment in the plan ⇒ outroApplied");
  console.log("CAPTIONS-PRESENT PASS: captionCues=2, captionsApplied=true, dropped=0");
}

/* ---------- 9. captions ABSENT (quote-only plan) ---------- */
{
  const t = mkTimeline({ overlays: [quote(30)] });
  const x = deriveProducesExtras(t, mkReceipt({ overlaysApplied: 1 }));
  assert.equal(x.captionCues, 0, "no caption overlays ⇒ 0 cues");
  assert.equal(x.captionsApplied, false, "no cues ⇒ captionsApplied false (and the 2365 gate stays quiet)");
  assert.equal(x.overlaysDropped, 0, "quote applied, nothing dropped");
  console.log("CAPTIONS-ABSENT PASS: captionCues=0 ⇒ captionsApplied=false, gate not tripped");
}

/* ---------- 10. a text-less caption is DROPPED (warning-derived count) ---------- */
{
  const t = mkTimeline({ overlays: [cap(10, "Kept."), { kind: "caption", startSec: 14, endSec: 16 }, quote(30)] });
  // overlaysToCuesAndSpecs drops the text-less caption and says so.
  const mapped = overlaysToCuesAndSpecs(t.overlays);
  assert.equal(mapped.cues.length, 1, "text-less caption never becomes a cue");
  assert.equal(mapped.warnings.length, 1, "the drop is surfaced as a warning, never silent");
  const x = deriveProducesExtras(t, mkReceipt({ overlaysApplied: 2, warnings: mapped.warnings }));
  assert.equal(x.captionCues, 1, "only the burnable caption counts");
  assert.equal(x.captionsApplied, true, "the surviving cue was burned");
  assert.equal(x.overlaysDropped, 1, "the text-less caption counts as exactly one drop");
  console.log("CAPTION-DROP PASS: overlaysDropped=1 from the typed warning");
}

/* ---------- 11. a media-less quote is DROPPED ---------- */
{
  const t = mkTimeline({ overlays: [cap(10, "Kept."), { kind: "quote", startSec: 30, endSec: 35 }] });
  const mapped = overlaysToCuesAndSpecs(t.overlays);
  assert.equal(mapped.specs.length, 0, "a quote with no renderable media is never faked");
  const x = deriveProducesExtras(t, mkReceipt({ overlaysApplied: 1, warnings: mapped.warnings }));
  assert.equal(x.overlaysDropped, 1, "media-less quote counted once");
  assert.equal(x.captionCues, 1, "the caption still burns");
  console.log("QUOTE-DROP PASS: media-less quote ⇒ overlaysDropped=1");
}

/* ---------- 12. TOTAL compositing failure — arithmetic floor catches it ---------- */
{
  // ffmpegBackend.ts:332-333 warns ONCE and returns applied:0 with the clean video.
  // A warnings-only count would under-report 1; the planned−applied floor reports all 3.
  const t = mkTimeline({ overlays: [cap(10, "A."), cap(14, "B."), quote(30)] });
  const x = deriveProducesExtras(
    t,
    mkReceipt({ overlaysApplied: 0, warnings: ["overlay compositing FAILED (clean video kept): ffmpeg exit 1"] }),
  );
  assert.equal(x.overlaysDropped, 3, "every planned overlay is reported dropped, not just the 1 warning");
  assert.equal(x.captionsApplied, false, "nothing composited ⇒ captionsApplied false");
  assert.equal(x.captionCues, 2, "cues were still PREPARED — captionCues>0 + applied=false is exactly the 2365 gate");
  console.log("TOTAL-FAILURE PASS: dropped=3 (arithmetic floor beats the single warning)");
}

/* ---------- 13. captionStyle:'none' — intentional suppression, not a gate trip ---------- */
{
  const t = mkTimeline({ overlays: [cap(10, "A."), cap(14, "B."), quote(30)], captionStyle: "none" });
  const x = deriveProducesExtras(
    t,
    mkReceipt({ overlaysApplied: 1, warnings: ["captionStyle=none — 2 caption(s) suppressed (not burned)"] }),
  );
  assert.equal(x.captionCues, 0, "style 'none' ⇒ 0 prepared cues (parity with the god-block's burnCaptions:false)");
  assert.equal(x.captionsApplied, false, "nothing burned");
  // capCues === 0 ⇒ narratedBlocks.ts:2366 (`capCues > 0 && captionsApplied === false`) does NOT fire.
  assert.ok(!(x.captionCues > 0 && x.captionsApplied === false), "an intentional style choice must not raise a critical");
  assert.equal(x.overlaysDropped, 2, "the 2 suppressed captions are still counted once (no double-count)");
  console.log("CAPTIONSTYLE-NONE PASS: cues=0, no false critical, dropped=2 counted once");
}

/* ---------- 14. no outro card in the plan ---------- */
{
  const t = mkTimeline({ withOutro: false, overlays: [] });
  const x = deriveProducesExtras(t, mkReceipt({ overlaysApplied: 0 }));
  assert.equal(x.outroApplied, false, "no outro card segment ⇒ outroApplied false");
  assert.equal(x.overlaysDropped, 0, "zero planned overlays ⇒ zero dropped (not a false positive)");
  assert.equal(x.captionsApplied, false, "no cues ⇒ false");
  console.log("NO-OUTRO PASS: outroApplied=false, dropped=0");
}

/* ================================================================== *
 * 15-17. END-TO-END assembleViaEdl through a FAKE RenderBackend.
 * Pins all 11 produced keys + the run-scoped pre-overlay checkpoint.
 * ================================================================== */

function fakeBackend(o: { applied?: (n: number) => number; warnings?: string[]; failCachePut?: string } = {}) {
  const cache = new Map<string, string>();
  const puts: string[] = [];
  const be: RenderBackend = {
    async renderCard(c) { return `card_${c.role}.mp4`; },
    async buildBody() { return "body.mp4"; },
    async composeIntro() { return "composed.mp4"; },
    async patchOutro() { return "withOutro.mp4"; },
    async applyOverlays(_b, ov) {
      return { path: "finished.mp4", applied: o.applied ? o.applied(ov.length) : ov.length, warnings: o.warnings ?? [] };
    },
    async probe() { return 128; },
    async cacheGet(k) { return cache.get(k) ?? null; },
    async cachePut(k, p) {
      if (o.failCachePut && k === o.failCachePut) throw new Error("R2 write refused");
      puts.push(k);
      cache.set(k, p);
    },
    async publish() { return "assembly/runs/r1/final.mp4"; },
  };
  return { be, cache, puts };
}

/** The god-block store shape, sized so planTimeline emits a coverage-valid plan. */
const e2eStore: Record<string, unknown> = {
  footageClips: ["f0.mp4", "f1.mp4", "f2.mp4", "f3.mp4", "f4.mp4", "f5.mp4"],
  entityClips: [],
  narrationLocalPath: "narr.wav",
  narrationDurationSec: 120,
  introCardPath: "intro.mp4",
  introSec: 5,
  musicKey: "music/mix.mp3",
  sentenceTimings: [
    { text: "One.", start: 0, end: 4 },
    { text: "Two.", start: 4, end: 9 },
    { text: "Three.", start: 9, end: 15 },
  ],
  channelName: "Investory",
  script: { closingLine: "Stay curious." },
  quoteOverlays: [{ path: "q0.webm", startSec: 40, durSec: 6, text: "A quote." }],
  insertOverlays: [{ path: "i0.webm", startSec: 70, durSec: 8 }],
};

/* ---------- 15. every produced key is present, typed, and non-blank ---------- */
async function producedKeyContract(): Promise<void> {
  const { be, puts } = fakeBackend();
  const out: AssembleProduces = await assembleViaEdl({
    store: e2eStore,
    params: { tailSec: 3 },
    runId: "r1",
    keyPrefix: "assembly/",
    backend: be,
  });

  for (const k of PRODUCES_KEYS) {
    assert.ok(k in out, `produces key "${k}" is emitted (undefined would void its verify gate)`);
    assert.notEqual((out as unknown as Record<string, unknown>)[k], undefined, `produces key "${k}" is not undefined`);
  }
  assert.equal(Object.keys(out).length, PRODUCES_KEYS.length, "exactly the 11 declared keys — no more, no fewer");

  assert.equal(typeof out.captionsApplied, "boolean", "captionsApplied is a boolean (gate compares === false)");
  assert.equal(typeof out.captionCues, "number", "captionCues is a number (gate does Number(...) > 0)");
  assert.equal(typeof out.outroApplied, "boolean", "outroApplied is a boolean (gate compares === true/false)");
  assert.equal(typeof out.overlaysDropped, "number", "overlaysDropped is a number");

  assert.equal(out.quotesApplied, 1, "the quote overlay composited");
  assert.equal(out.insertsApplied, 1, "the insert overlay composited");
  assert.ok(out.captionCues > 0, "captions were planned from sentenceTimings and prepared");
  assert.equal(out.captionsApplied, true, "…and burned");
  assert.equal(out.overlaysDropped, 0, "clean render drops nothing");
  assert.equal(out.outroApplied, true, "tailSec 3 ⇒ an outro card is planned and rendered");

  // THE CHECKPOINT FIX: preOverlayKey is now the god-block's run-scoped key, not "".
  assert.equal(
    out.preOverlayKey,
    "assembly/runs/r1/pre_overlay.mp4",
    "preOverlayKey matches narratedBlocks.ts:1874 `${keyPrefix}runs/${runId}/pre_overlay.mp4` exactly",
  );
  assert.notEqual(out.preOverlayLocalPath, "", "preOverlayLocalPath points at the composed pre-overlay video");
  assert.ok(
    puts.includes("runs/r1/pre_overlay.mp4"),
    "the checkpoint was actually WRITTEN to that key — never advertise an object that does not exist",
  );
  console.log("E2E CONTRACT PASS: all 11 keys emitted; preOverlayKey non-blank and backed by a real write");
}

/* ---------- 16. the advertised key holds the SAME artifact as the content-addressed checkpoint ---------- */
async function checkpointIdentity(): Promise<void> {
  const { be, cache } = fakeBackend();
  const out = await assembleViaEdl({
    store: e2eStore,
    params: { tailSec: 3 },
    runId: "r1",
    keyPrefix: "assembly/",
    backend: be,
  });
  // renderTimeline wrote TWO render/* keys: the pre-overlay checkpoint and the final.
  // The run-scoped copy must be the PRE-OVERLAY one (the composed body+outro the heal
  // re-finishes from), NOT the finished video — copying the wrong one would make a
  // heal re-burn overlays onto an already-overlaid video.
  const runScoped = cache.get("runs/r1/pre_overlay.mp4");
  assert.ok(runScoped, "the run-scoped key exists in the cache");
  assert.equal(runScoped, "withOutro.mp4", "it is the composed body INCLUDING the outro, pre-overlay");
  assert.notEqual(runScoped, "finished.mp4", "it is NOT the finished (overlaid) video");
  assert.equal(
    out.preOverlayLocalPath,
    runScoped,
    "the returned local path is the composed checkpoint the heal re-finishes from",
  );
  // And it was published under exactly the content-addressed checkpoint's contents.
  const contentKeys = [...cache.keys()].filter((k) => k.startsWith("render/"));
  assert.ok(contentKeys.length >= 2, "content-addressed checkpoint + final key both written");
  assert.ok(
    contentKeys.some((k) => cache.get(k) === runScoped),
    "the run-scoped copy mirrors a real content-addressed entry (not an invented artifact)",
  );
  console.log("CHECKPOINT-IDENTITY PASS: run-scoped key holds the PRE-OVERLAY composed video");
}

/* ---------- 17. checkpoint publish FAILS ⇒ fail-soft blank, never a dangling key ---------- */
async function checkpointFailSoft(): Promise<void> {
  const { be } = fakeBackend({ failCachePut: "runs/r1/pre_overlay.mp4" });
  const out = await assembleViaEdl({
    store: e2eStore,
    params: { tailSec: 3 },
    runId: "r1",
    keyPrefix: "assembly/",
    backend: be,
  });
  assert.equal(out.preOverlayKey, "", "a failed checkpoint upload degrades to blank (god-block parity, :1877-1881)");
  assert.equal(out.preOverlayLocalPath, "", "…and blanks the local path with it");
  // The rest of the contract must survive the degrade.
  assert.equal(Object.keys(out).length, PRODUCES_KEYS.length, "still all 11 keys");
  assert.ok(out.videoKey.length > 0, "the video itself still published");
  assert.equal(out.outroApplied, true, "unrelated keys unaffected by the checkpoint degrade");
  console.log("CHECKPOINT-FAILSOFT PASS: blank pointers, never a dangling key, contract intact");
}

/* ---------- 18. a real drop end-to-end lands in overlaysDropped ---------- */
async function e2eDrop(): Promise<void> {
  const { be } = fakeBackend({
    applied: (n) => n - 1,
    warnings: ["overlay[2] (quote): no renderable media path (needs src or data.path — a Remotion-rendered alpha card) — skipped"],
  });
  const out = await assembleViaEdl({
    store: e2eStore,
    params: { tailSec: 3 },
    runId: "r1",
    keyPrefix: "assembly/",
    backend: be,
  });
  assert.equal(out.overlaysDropped, 1, "one dropped overlay is reported, not swallowed");
  assert.equal(out.captionsApplied, true, "the rest still composited");
  console.log("E2E DROP PASS: overlaysDropped=1 surfaced through the adapter");
}

async function main(): Promise<void> {
  await producedKeyContract();
  await checkpointIdentity();
  await checkpointFailSoft();
  await e2eDrop();
  console.log("\nALL CUTOVER TESTS PASSED");
}

main().catch((e) => { console.error("CUTOVER TEST FAILED:", e); process.exit(1); });
