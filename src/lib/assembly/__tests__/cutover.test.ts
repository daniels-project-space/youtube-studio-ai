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
import { buildPlanInput, quoteSpecsToOverlays, paramsToAssemble } from "../cutover";
import { overlaysToCuesAndSpecs } from "../overlays";
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
  assert.equal(pi.overlays?.length, 2, "quoteOverlays + insertOverlays → 2 Overlay[]");
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

console.log("\nALL CUTOVER TESTS PASSED");
