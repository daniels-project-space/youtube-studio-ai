import assert from "node:assert/strict";

import {
  assertMusicProgramQualityReceipt,
  ChannelMusicProgramSchema,
  createChannelMusicProgram,
  createMusicProgramQualityReceipt,
  instrumentalLyricsControl,
  MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MIN_WORDS,
  MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MAX_WORDS,
  music3StructuredCaptionWordCount,
  musicRoleForRoute,
} from "@/engine/channelMusicProgram";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

const sha = (value: string) => value.repeat(64);

assert.equal(musicRoleForRoute("music_loop", "music_loop"), "primary_music");
assert.equal(musicRoleForRoute("sleep", "ambient_guided"), "sleep_sound_bed");
assert.equal(musicRoleForRoute("sleep", "music_loop"), "sleep_sound_bed");
assert.equal(musicRoleForRoute("music_loop", "sleep"), "sleep_sound_bed");
assert.equal(musicRoleForRoute("music_loop", "meditation"), "meditation_bed");
assert.equal(musicRoleForRoute("music_loop", "quiz_short"), "short_form_bed");
assert.equal(musicRoleForRoute("quiz_year", "quiz_short"), "short_form_bed");
assert.equal(musicRoleForRoute("narrated", "documentary"), "narration_bed");

const unclassified = createChannelMusicProgram({
  channelId: "channel-unclassified",
  channelIdentityFingerprint: sha("d"),
  topic: "A quiet reflection",
});
assert.equal(unclassified.family, "unclassified");
assert.equal(unclassified.contentLaneKey, "unclassified");
assert.equal(unclassified.role, "narration_bed");
assert.equal(unclassified.mix.narrationPriority, true);
assert.equal(unclassified.mix.bodyMusicVol, 0.1026,
  "an unknown route must not be mislabeled as a full-volume music-loop program");

const meditation = createChannelMusicProgram({
  channelId: "channel-meditation",
  channelIdentityFingerprint: sha("c"),
  family: "music_loop",
  contentLaneKey: "meditation",
  topic: "A slow return to steady breathing",
});
assert.equal(meditation.role, "meditation_bed");
assert.equal(meditation.mix.bodyMusicVol, 0.25,
  "a specific meditation lane must not inherit primary-music full volume from its broad family");
assert.equal(meditation.mix.narrationPriority, false);
assert.equal(meditation.quality.minimumLraLu, 2);
assert.throws(() => createChannelMusicProgram({
  channelId: "channel-meditation-conflict",
  channelIdentityFingerprint: sha("d"),
  family: "music_loop",
  contentLaneKey: "meditation",
  topic: "A slow return to steady breathing",
  role: "primary_music",
}), /conflicts with specialized route role meditation_bed/u);

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
assert.match(history.generation.structuredCaption, /^### Creative Foundation/mu);
assert.match(
  history.generation.structuredCaption,
  /A quiet uncertainty, restrained danger, then sober resolution restrained chamber documentary score instrumental at 65 BPM: “The failed winter crossing”\./u,
  "Music3 captions must begin with a scene-led creative brief instead of a metadata/tag pile",
);
assert.match(
  history.generation.structuredCaption,
  /Feature felt piano, low strings, and soft frame drum\./u,
  "the creative foundation must hold the featured palette to a listenable three-instrument focus",
);
assert.match(history.generation.structuredCaption, /^### Global Metadata/mu);
assert.match(history.generation.structuredCaption, /Key\/scale: [A-G](?:-flat)? (?:minor|major);/u);
const historyTonalCenter = history.generation.structuredCaption.match(/Key\/scale: ([^;]+);/u)?.[1];
const nextHistoryEpisode = createChannelMusicProgram({
  channelId: "channel-stoic-history",
  channelIdentityFingerprint: sha("a"),
  family: "narrated",
  contentLaneKey: "documentary",
  topic: "The thaw after the long winter",
  providerPreference: "minimax_music3",
  genre: "restrained chamber documentary score",
  instrumentation: ["felt piano", "low strings", "soft frame drum"],
  textures: ["dry close room", "subtle analogue warmth"],
  bpmRange: [58, 72],
  moodArc: "measured relief gradually replaces uncertainty and resolves with quiet dignity",
});
assert.equal(
  nextHistoryEpisode.generation.structuredCaption.match(/Key\/scale: ([^;]+);/u)?.[1],
  historyTonalCenter,
  "episode-specific topic and mood changes must not change the channel's stable tonal center",
);
assert.match(history.generation.structuredCaption, /scenario: a paced narrated story/u);
assert.match(history.generation.structuredCaption, /### Vocal Details/mu);
assert.match(history.generation.structuredCaption, /### Arrangement/mu);
assert.match(history.generation.structuredCaption, /Never sentimentalize the loss/u);
assert.equal(
  history.generation.lyricsControl,
  "[Intro]\n[Instrumental]\n[Verse]\n[Bridge]\n[Chorus]\n[Outro]",
  "Music3 lyrics control must state its native instrumental mode while keeping structural tags; arrangement prose belongs in the structured caption",
);
assert.doesNotMatch(history.generation.lyricsControl, /Establish|Keep the|vocals|spoken/u);
for (const role of ["primary_music", "narration_bed", "meditation_bed", "sleep_sound_bed", "short_form_bed"] as const) {
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
assert.equal(lofi.mix.targetLufs, -16, "music-forward programs retain their role default target");
assert.equal(lofi.generation.sections.length, 8, "a long Music3 form must map every extended passage to a reviewable arrangement job");
assert.equal(lofi.generation.sections[0]?.startFraction, 0);
assert.equal(lofi.generation.sections.at(-1)?.endFraction, 1);
assert.equal(
  lofi.generation.lyricsControl,
  "[Intro]\n[Instrumental]\n[Verse]\n[Chorus]\n[Instrumental]\n[Bridge]\n[Chorus]\n[Instrumental]\n[Verse]\n[Chorus]\n[Instrumental]\n[Verse]\n[Chorus]\n[Instrumental]\n[Verse]\n[Chorus]\n[Outro]",
  "a five-minute music-first program must carry an extended, tag-only Music3 form instead of ending from the short-form map",
);
assert.equal(
  instrumentalLyricsControl("primary_music", 120),
  "[Intro]\n[Instrumental]\n[Verse]\n[Chorus]\n[Instrumental]\n[Bridge]\n[Chorus]\n[Outro]",
  "normal-duration programs retain the compact proven form",
);
assert.match(
  instrumentalLyricsControl("meditation_bed", 300),
  /^(?:\[(?:Intro|Instrumental|Verse|Bridge|Outro)\]\n?)+$/u,
  "long-form Music3 controls must remain entirely tag-only so no arrangement prose can become a vocal",
);
assert.match(
  lofi.generation.structuredCaption,
  /two-bar lead motif[\s\S]*call-and-response[\s\S]*counterline[\s\S]*different rhythmic placement[\s\S]*genuine contrast passage[\s\S]*Reintroduce the groove[\s\S]*opening harmony/u,
  "the long primary-music prompt must attach its extra Music3 form to distinct arrangement functions, not a stack of generic depth adjectives",
);

const sleep = createChannelMusicProgram({
  channelId: "channel-sleep",
  channelIdentityFingerprint: sha("c"),
  family: "sleep",
  contentLaneKey: "music_loop",
  topic: "Steady rain through a quiet night",
  bpmRange: [100, 100],
  composerDirection: "Use a strong four-on-the-floor groove in G major at 100 BPM.",
  durationSec: 300,
});
assert.equal(sleep.role, "sleep_sound_bed", "sleep intent takes precedence over a generic loop lane");
assert.equal(sleep.identity.bpmRange, null,
  "sleep programs must not retain a contradictory BPM range from channel DNA or composer direction");
assert.equal(sleep.mix.narrationPriority, false);
assert.equal(sleep.mix.bodyMusicVol, 1, "sleep sound is a primary listening program, not a ducked narration bed");
assert.equal(sleep.mix.targetLufs, -20, "sleep sound uses its quieter standalone target by default");
assert.equal(sleep.quality.minimumLraLu, 1, "sleep sound permits a deliberately stable dynamic range");
assert.equal(sleep.generation.sections.length, 4);
assert.deepEqual(
  sleep.generation.sections.map((section) => section.energy),
  [0.12, 0.12, 0.12, 0.12],
  "sleep sound must not encode an energy rise or fall after declaring stable loudness",
);
assert.match(sleep.generation.structuredCaption, /unattended overnight listening/u);
assert.match(sleep.generation.structuredCaption, /no pulse, melodic arrival/u);
assert.match(sleep.generation.structuredCaption, /unmetered and beatless/u);
assert.match(sleep.generation.structuredCaption, /diffuse, sustained background texture/u);
assert.doesNotMatch(sleep.generation.structuredCaption, /The melodic lead belongs/u);
assert.match(sleep.generation.structuredCaption, /override any conflicting channel or composer direction/u);
assert.doesNotMatch(
  sleep.generation.structuredCaption,
  /\b\d{2,3}(?:\s*[–-]\s*\d{2,3})?\s*BPM\b|Key\/scale:/u,
  "beatless sleep prompts must not simultaneously prescribe a tempo or tonal center, even when supplied by channel DNA/composer direction",
);
assert.doesNotMatch(sleep.generation.structuredCaption, /call-and-response|late lift|genuine contrast passage/u);
const { fingerprint: _sleepFingerprint, ...sleepBody } = sleep;
const legacySleepBody = {
  ...sleepBody,
  identity: { ...sleep.identity, bpmRange: [100, 100] as const },
};
const legacySleep = ChannelMusicProgramSchema.parse({
  ...legacySleepBody,
  fingerprint: sha256Hex(canonicalJson(legacySleepBody)),
});
assert.deepEqual(legacySleep.identity.bpmRange, [100, 100],
  "retained v1 sleep programs with the former tempo field remain readable during migration");
const guidedSleep = createChannelMusicProgram({
  channelId: "channel-guided-sleep",
  channelIdentityFingerprint: sha("9"),
  family: "sleep",
  contentLaneKey: "ambient_guided",
  topic: "A gentle body scan for rest",
});
assert.equal(guidedSleep.role, "sleep_sound_bed", "guided sleep keeps the beatless sleep-source contract");
assert.equal(guidedSleep.mix.narrationPriority, true, "guided sleep's narration retains foreground priority");
assert.equal(guidedSleep.mix.bodyMusicVol, 0.1026, "guided sleep defaults to the established narrated-bed gain");
assert.equal(sleep.mix.narrationPriority, false, "standalone sleep sound remains a primary listening program");
assert.equal(sleep.mix.bodyMusicVol, 1);
assert.ok(
  music3StructuredCaptionWordCount(lofi.generation.structuredCaption) >= MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MIN_WORDS
    && music3StructuredCaptionWordCount(lofi.generation.structuredCaption) <= MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MAX_WORDS,
  "a long Music3 program must stay within the official concise structured-caption guidance instead of repeating channel identity in every section",
);
assert.match(
  history.generation.structuredCaption,
  /two-note pulse[\s\S]*low answer[\s\S]*withdraw one layer[\s\S]*opening texture/u,
  "a narration bed must retain narrative musical causality while protecting speech",
);

const longMeditation = createChannelMusicProgram({
  channelId: "channel-calm-water",
  channelIdentityFingerprint: sha("e"),
  family: "meditation",
  contentLaneKey: "ambient_guided",
  topic: "Still water at midnight",
  durationSec: 300,
});
assert.deepEqual(
  longMeditation.generation.sections.map((section) => section.id),
  ["arrival", "settle", "open", "drift", "return", "release"],
  "long meditation programs must keep calm variation distinct from an unstructured repeated pad",
);
assert.equal(longMeditation.identity.genre, "slow spacious ambient meditation");
assert.equal(longMeditation.mix.targetLufs, -18, "meditation retains a distinct target from sleep and primary music");
assert.deepEqual(longMeditation.identity.instrumentation, ["warm sustained pad", "sparse felt piano", "soft breathy flute"]);
assert.match(longMeditation.identity.moodArc, /without a strong melodic arrival/u);
assert.match(longMeditation.generation.structuredCaption, /BPM;.*Key\/scale:/u);

const longNarration = createChannelMusicProgram({
  channelId: "channel-long-history",
  channelIdentityFingerprint: sha("f"),
  family: "narrated",
  contentLaneKey: "documentary",
  topic: "The bridge that changed the campaign",
  durationSec: 300,
});
assert.deepEqual(
  longNarration.generation.sections.map((section) => section.id),
  ["cold-open", "exposition", "complication", "reveal", "recovery", "resolution", "tail"],
  "long narration beds must preserve speech space through a distinct reveal-and-recovery passage",
);
assert.equal(longNarration.identity.genre, "restrained documentary underscore");
assert.equal(longNarration.mix.targetLufs, -18, "narration beds retain their role-aware loudness target");
assert.match(longNarration.identity.moodArc, /without competing with speech/u);

const shortForm = createChannelMusicProgram({
  channelId: "channel-quick-lessons",
  channelIdentityFingerprint: sha("7"),
  family: "shorts",
  contentLaneKey: "short_form",
  topic: "One useful idea",
});
assert.equal(shortForm.identity.genre, "concise modern instrumental underscore");
assert.match(shortForm.identity.moodArc, /before the cut/u);

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
  /opening-to-early-interior high-band energy collapsed/u,
  "a take with the known post-opening Music3 spectral collapse must never qualify",
);

const tampered = structuredClone(history);
tampered.identity.genre = "generic cinematic";
assert.throws(
  () => ChannelMusicProgramSchema.parse(tampered),
  /fingerprint is invalid/i,
  "channel sound identity is fingerprint-bound",
);

const tooShortCaption = structuredClone(history);
tooShortCaption.generation.structuredCaption = "A generic ambient track.";
assert.throws(
  () => ChannelMusicProgramSchema.parse(tooShortCaption),
  /structured caption must contain 250–450 words; received 4/u,
  "a MiniMax program cannot silently replace its creative brief with a weak one-line prompt",
);

console.log("CHANNEL MUSIC PROGRAM PASS: role-specific structure, mix, licensing, and listened quality gate");
