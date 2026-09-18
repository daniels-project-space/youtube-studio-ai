import assert from "node:assert/strict";

import {
  assertMusicProgramQualityReceipt,
  ChannelMusicProgramSchema,
  createChannelMusicProgram,
  createMusicProgramQualityReceipt,
  instrumentalLyricsControl,
  musicRoleForRoute,
} from "@/engine/channelMusicProgram";

const sha = (value: string) => value.repeat(64);

assert.equal(musicRoleForRoute("music_loop", "music_loop"), "primary_music");
assert.equal(musicRoleForRoute("sleep", "ambient_guided"), "meditation_bed");
assert.equal(musicRoleForRoute("quiz_year", "quiz_short"), "short_form_bed");
assert.equal(musicRoleForRoute("narrated", "documentary"), "narration_bed");

const history = createChannelMusicProgram({
  channelId: "channel-stoic-history",
  channelIdentityFingerprint: sha("a"),
  family: "narrated",
  contentLaneKey: "documentary",
  topic: "The failed winter crossing",
  providerPreference: "minimax_music3",
  genre: "restrained chamber documentary score",
  instrumentation: ["felt piano", "low strings", "soft frame drum"],
  textures: ["dry close room", "subtle analogue warmth"],
  bpmRange: [58, 72],
  moodArc: "quiet uncertainty, restrained danger, then sober resolution",
  composerDirection: "Never sentimentalize the loss; support narration with calm gravity.",
  targetLufs: -18,
  bodyMusicVol: 0.08,
  durationSec: 120,
});

assert.equal(history.role, "narration_bed");
assert.equal(history.mix.narrationPriority, true);
assert.equal(history.mix.bodyMusicVol, 0.08);
assert.match(history.generation.structuredCaption, /^### Global Metadata/mu);
assert.match(history.generation.structuredCaption, /### Vocal Details/mu);
assert.match(history.generation.structuredCaption, /### Arrangement/mu);
assert.match(history.generation.structuredCaption, /Never sentimentalize the loss/u);
assert.equal(
  history.generation.lyricsControl,
  "[Intro]\n[Instrumental]\n[Verse]\n[Bridge]\n[Chorus]\n[Outro]",
  "Music3 lyrics control must state its native instrumental mode while keeping structural tags; arrangement prose belongs in the structured caption",
);
assert.doesNotMatch(history.generation.lyricsControl, /Establish|Keep the|vocals|spoken/u);
for (const role of ["primary_music", "narration_bed", "meditation_bed", "short_form_bed"] as const) {
  assert.match(
    instrumentalLyricsControl(role),
    /\[Instrumental\]/u,
    `${role} must send Music3's native instrumental control as well as the prose-free caption constraint`,
  );
}
assert.equal(history.minimaxLicense.uiAttribution, "MiniMax-Music3");
assert.equal(history.minimaxLicense.generatedContentDisclosureRequired, true);

const lofi = createChannelMusicProgram({
  channelId: "channel-rain",
  channelIdentityFingerprint: sha("b"),
  family: "music_loop",
  contentLaneKey: "music_loop",
  topic: "Late tram through warm rain",
  genre: "rainy late-night lo-fi hip-hop",
  instrumentation: ["Rhodes piano", "upright bass", "soft boom-bap drums"],
  textures: ["vinyl grain", "tape warmth"],
  bpmRange: [70, 78],
  targetLufs: -16,
  bodyMusicVol: 0.1,
  durationSec: 300,
});
assert.equal(lofi.role, "primary_music");
assert.equal(lofi.mix.bodyMusicVol, 1, "music-first channels cannot be accidentally ducked by a narrated preset");
assert.equal(lofi.generation.sections.length, 6);
assert.equal(lofi.generation.sections[0]?.startFraction, 0);
assert.equal(lofi.generation.sections.at(-1)?.endFraction, 1);
assert.equal(
  lofi.generation.lyricsControl,
  "[Intro]\n[Instrumental]\n[Verse]\n[Chorus]\n[Instrumental]\n[Bridge]\n[Chorus]\n[Outro]",
  "music-first programs must expose a complete form while explicitly preserving Music3 instrumental generation",
);
assert.match(
  lofi.generation.structuredCaption,
  /two-bar lead motif[\s\S]*call-and-response[\s\S]*counterline[\s\S]*different rhythmic placement[\s\S]*opening harmony/u,
  "the primary-music prompt must describe a real arrangement progression, not a stack of generic depth adjectives",
);
assert.match(
  history.generation.structuredCaption,
  /two-note pulse[\s\S]*low answer[\s\S]*withdraw one layer[\s\S]*opening texture/u,
  "a narration bed must retain narrative musical causality while protecting speech",
);

const receiptInput = {
  output: {
    contentSha256: sha("c"),
    byteLength: 38_400_044,
    durationSec: 300,
    sampleRate: 32_000,
    channels: 2,
    codec: "pcm_s16le",
  },
  measurements: {
    integratedLufs: -16,
    truePeakDbtp: -1.4,
    lraLu: 4.2,
    crestDb: 10.5,
    clippedSamples: 0,
    maximumConsecutiveCeilingSamples: 1,
    dcOffsetAbsolute: 0.0002,
    silenceFraction: 0.002,
    mechanicalArtifactScore: 0.04,
    openingHighBandDropDb: 1.2,
  },
  sectionReviews: lofi.generation.sections.map((section) => ({
    sectionId: section.id,
    score: 0.9,
    evidence: `${section.label} has an audible musical job, coherent entrances/exits, and preserves the channel instrumentation.`,
  })),
  audition: {
    reviewerId: "reviewer-daniel",
    reviewReceiptFingerprint: sha("d"),
    emotionalDepthScore: 0.88,
    arrangementDepthScore: 0.9,
    hollowOrGeneric: false,
    verdict: "pass",
    notes: "Auditioned the complete native WAV and every section transition; the track has depth, groove, melody, and an earned return.",
  },
};
const quality = createMusicProgramQualityReceipt({ program: lofi, ...receiptInput });
assert.equal(quality.programFingerprint, lofi.fingerprint);
assert.equal(
  assertMusicProgramQualityReceipt({ program: lofi, receipt: quality }).fingerprint,
  quality.fingerprint,
  "durable release admission must reapply the sealed program's quality thresholds",
);
assert.throws(
  () => assertMusicProgramQualityReceipt({
    program: history,
    receipt: quality,
  }),
  /different channel music program/u,
  "a passing music receipt cannot be borrowed by another channel or episode",
);

assert.throws(
  () => createMusicProgramQualityReceipt({
    program: lofi,
    ...receiptInput,
    measurements: { ...receiptInput.measurements, lraLu: 0.8, crestDb: 4.2 },
    audition: { ...receiptInput.audition, hollowOrGeneric: true },
  }),
  /loudness range.*crest factor.*hollow or generic/iu,
  "a technically decodable but flat/hollow song must not qualify",
);

assert.throws(
  () => createMusicProgramQualityReceipt({
    program: lofi,
    ...receiptInput,
    measurements: { ...receiptInput.measurements, openingHighBandDropDb: 26, mechanicalArtifactScore: 0.4 },
  }),
  /opening-to-post-opening high-band energy collapsed/u,
  "a take with the known post-opening Music3 spectral collapse must never qualify",
);

const tampered = structuredClone(history);
tampered.identity.genre = "generic cinematic";
assert.throws(
  () => ChannelMusicProgramSchema.parse(tampered),
  /fingerprint is invalid/i,
  "channel sound identity is fingerprint-bound",
);

console.log("CHANNEL MUSIC PROGRAM PASS: role-specific structure, mix, licensing, and listened quality gate");
