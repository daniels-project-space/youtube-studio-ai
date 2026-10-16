import assert from "node:assert/strict";

import {
  assertMusicProgramQualityReceipt,
  ChannelMusicProgramSchema,
  createChannelMusicProgram,
  createMusicProgramQualityReceipt,
  musicProgramTechnicalQualityFailures,
  instrumentalLyricsControl,
  MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MIN_WORDS,
  MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MAX_WORDS,
  music3StructuredCaptionWordCount,
  musicFallbackProfileForRole,
  musicProviderPromptForProgram,
  musicRoleForRoute,
  resolveMusicModuleBodyMusicVol,
  musicSoundProfileFingerprint,
  primaryMusicFallbackProfile,
} from "@/engine/channelMusicProgram";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

const sha = (value: string) => value.repeat(64);

assert.equal(resolveMusicModuleBodyMusicVol(0.28, 0.16), 0.28,
  "an explicit Music-module mix level overrides the channel DNA default");
assert.equal(resolveMusicModuleBodyMusicVol(undefined, 0.16), 0.16,
  "existing channels keep their channel DNA mix level until they opt into a module override");
for (const invalid of [null, "0.2", Number.NaN, 0, 1.01]) {
  assert.throws(() => resolveMusicModuleBodyMusicVol(invalid), /bodyMusicVol must be a finite number/u,
    "invalid persisted Music-module gain must fail closed");
}

assert.equal(musicRoleForRoute("music_loop", "music_loop"), "primary_music");
assert.equal(musicRoleForRoute("sleep", "ambient_guided"), "sleep_sound_bed");
assert.equal(musicRoleForRoute("sleep", "music_loop"), "sleep_sound_bed");
assert.equal(musicRoleForRoute("music_loop", "sleep"), "sleep_sound_bed");
assert.equal(musicRoleForRoute("music_loop", "meditation"), "meditation_bed");
assert.equal(musicRoleForRoute("music_loop", "quiz_short"), "short_form_bed");
assert.equal(musicRoleForRoute("quiz_year", "quiz_short"), "short_form_bed");
assert.equal(musicRoleForRoute("narrated", "documentary"), "narration_bed");
assert.equal(musicRoleForRoute("cinematic", "music_video"), "primary_music");

const generalPrimaryProfiles = ["Investory", "Chalk & Compound", "Stoic Truths", "Seaside Ghibli", "Drawn Past"]
  .map((channelIdentity) => primaryMusicFallbackProfile({
    family: "cinematic",
    contentLaneKey: "music_video",
    channelIdentitySeed: channelIdentity,
  }));
assert.ok(new Set(generalPrimaryProfiles.map((profile) => profile.genre)).size >= 3,
  "unconfigured primary-music channels should get deterministic but meaningfully varied sound identities");
assert.ok(generalPrimaryProfiles.every((profile) => !/lo-fi|lofi|underscore/iu.test(profile.genre)),
  "non-Lo-Fi primary routes must not inherit the Lo-Fi sound or a narration-bed genre");
const lofiFallbackProfiles = ["Investory", "Chalk & Compound", "Stoic Truths", "Seaside Ghibli", "Drawn Past"]
  .map((channelIdentitySeed) => primaryMusicFallbackProfile({
    family: "music_loop",
    contentLaneKey: "music_loop",
    channelIdentitySeed,
  }));
assert.ok(new Set(lofiFallbackProfiles.map((profile) => profile.genre)).size >= 3,
  "unconfigured Lo-Fi channels should receive stable but distinct Lo-Fi sound identities");
assert.ok(lofiFallbackProfiles.every((profile) => /lo-fi/iu.test(profile.genre)),
  "channel-specific Lo-Fi fallbacks must preserve the music-loop family identity");
assert.equal(
  primaryMusicFallbackProfile({ family: "music_loop", contentLaneKey: "music_loop", channelIdentitySeed: "Seaside Ghibli" }).genre,
  primaryMusicFallbackProfile({ family: "music_loop", contentLaneKey: "music_loop", channelIdentitySeed: "Seaside Ghibli" }).genre,
  "the same channel identity must resolve to the same fallback on every run",
);
const lofiFallbackPrograms = ["Investory", "Chalk & Compound", "Stoic Truths", "Seaside Ghibli", "Drawn Past"]
  .map((channelName) => createChannelMusicProgram({
    channelId: channelName,
    channelIdentityFingerprint: sha256Hex(channelName),
    family: "music_loop",
    contentLaneKey: "music_loop",
    topic: "Evening session with its sealed recurring sound identity",
    composerDirection: "Preserve a recurring melodic motif with changing phrases and restrained dynamics.",
    durationSec: 300,
  }));
assert.ok(lofiFallbackPrograms.every((program) =>
  program.role === "primary_music" && program.mix.bodyMusicVol === 1 &&
  music3StructuredCaptionWordCount(program.generation.structuredCaption) <= MUSIC3_STRUCTURED_CAPTION_RECOMMENDED_MAX_WORDS,
), "every channel-specific Lo-Fi fallback must stay music-forward and inside the Music3 caption ceiling");
const sameIdentityDifferentEpisode = createChannelMusicProgram({
  channelId: "Investory",
  channelIdentityFingerprint: sha256Hex("Investory"),
  family: "music_loop",
  contentLaneKey: "music_loop",
  topic: "Another evening session",
  composerDirection: "Preserve a recurring melodic motif with changing phrases and restrained dynamics.",
  durationSec: 300,
});
assert.equal(musicSoundProfileFingerprint(lofiFallbackPrograms[0]!), musicSoundProfileFingerprint(sameIdentityDifferentEpisode),
  "episode topic changes must not reshuffle a channel's fallback sound identity");

const soundscapeChannels = ["Investory", "Chalk & Compound", "Stoic Truths", "Seaside Ghibli", "Drawn Past"];
const narrationFallbackPrograms = soundscapeChannels.map((channelName) => createChannelMusicProgram({
  channelId: channelName,
  channelIdentityFingerprint: sha256Hex(channelName),
  family: "narrated",
  contentLaneKey: "documentary",
  topic: "A measured account of the expedition",
  providerPreference: "suno",
}));
assert.ok(new Set(narrationFallbackPrograms.map((program) => program.identity.genre)).size >= 3,
  "unconfigured narration channels should seal distinct fallback identities");
const narrationProgram = narrationFallbackPrograms[0]!;
const narrationProviderPrompt = musicProviderPromptForProgram(
  narrationProgram,
  "Keep the episode direction subordinate to the channel identity.",
);
assert.ok(narrationProviderPrompt.length <= 900);
assert.ok(narrationProviderPrompt.includes(narrationProgram.identity.genre));
assert.ok(narrationProgram.identity.instrumentation.some((instrument) => narrationProviderPrompt.includes(instrument)));
assert.ok(narrationProviderPrompt.includes(narrationProgram.topic));
assert.ok(narrationProviderPrompt.includes("Episode direction:"));
const meditationFallbackPrograms = soundscapeChannels.map((channelName) => createChannelMusicProgram({
  channelId: channelName,
  channelIdentityFingerprint: sha256Hex(channelName),
  family: "meditation",
  contentLaneKey: "ambient_guided",
  topic: "A quiet return to the breath",
}));
assert.ok(new Set(meditationFallbackPrograms.map((program) => program.identity.genre)).size >= 3,
  "unconfigured meditation channels should receive distinct but stable ambient identities");
const meditationFallbackSibling = createChannelMusicProgram({
  channelId: "Investory",
  channelIdentityFingerprint: sha256Hex("Investory"),
  family: "meditation",
  contentLaneKey: "ambient_guided",
  topic: "A different guided meditation",
});
assert.equal(musicSoundProfileFingerprint(meditationFallbackPrograms[0]!), musicSoundProfileFingerprint(meditationFallbackSibling),
  "episode topics must not reshuffle an unconfigured meditation channel's sound identity");
assert.ok(meditationFallbackPrograms.every((program) =>
  program.role === "meditation_bed" && program.mix.targetLufs === -18 && program.mix.narrationPriority,
), "personalized meditation profiles must preserve guided-meditation role and mix controls");

const sleepFallbackPrograms = soundscapeChannels.map((channelName) => createChannelMusicProgram({
  channelId: channelName,
  channelIdentityFingerprint: sha256Hex(channelName),
  family: "sleep",
  contentLaneKey: "ambient_guided",
  topic: "A steady soundscape for rest",
}));
assert.ok(new Set(sleepFallbackPrograms.map((program) => program.identity.genre)).size >= 3,
  "unconfigured sleep channels should receive distinct but stable soundscape identities");
assert.ok(sleepFallbackPrograms.every((program) =>
  program.role === "sleep_sound_bed" && program.identity.bpmRange === null &&
  program.mix.targetLufs === -20 && program.mix.bodyMusicVol === 0.1026 && program.mix.narrationPriority,
), "personalized sleep soundscapes must remain beatless and retain the narrated-sleep mix contract");
const sleepProviderPrompt = musicProviderPromptForProgram(sleepFallbackPrograms[0]!);
assert.match(sleepProviderPrompt, /Beatless, no pulse or tempo/u);
assert.doesNotMatch(sleepProviderPrompt, /\btempo\s+\d|\bBPM\b/iu);
const sleepFallbackSibling = createChannelMusicProgram({
  channelId: "Investory",
  channelIdentityFingerprint: sha256Hex("Investory"),
  family: "sleep",
  contentLaneKey: "ambient_guided",
  topic: "Another sleep episode",
});
assert.equal(musicSoundProfileFingerprint(sleepFallbackPrograms[0]!), musicSoundProfileFingerprint(sleepFallbackSibling),
  "episode topics must not reshuffle an unconfigured sleep channel's sound identity");

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
assert.throws(() => createChannelMusicProgram({
  channelId: "channel-narrated-primary-music",
  channelIdentityFingerprint: sha("e"),
  family: "narrated",
  contentLaneKey: "documentary",
  role: "primary_music",
  topic: "A source-led documentary episode",
}), /primary_music conflicts with narration route role narration_bed/u,
"spoken routes must not let channel or composer configuration turn their supporting score into a full-volume music lead");

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
assert.deepEqual(meditation.identity.bpmRange, [48, 64],
  "legacy meditation arrangements without tempoMode retain the metered default");
const unmeteredMeditation = createChannelMusicProgram({
  channelId: "channel-unmetered-meditation",
  channelIdentityFingerprint: sha("d"),
  family: "music_loop",
  contentLaneKey: "meditation",
  role: "meditation_bed",
  tempoMode: "unmetered",
  topic: "A quiet, wordless breath meditation",
});
assert.equal(unmeteredMeditation.identity.bpmRange, null);
assert.match(unmeteredMeditation.generation.structuredCaption, /unmetered and pulse-free/u);
assert.match(unmeteredMeditation.generation.structuredCaption, /intentionally unmetered and pulse-free/u);
assert.match(unmeteredMeditation.generation.structuredCaption, /unmetered, pulse-free texture/u);
assert.equal(ChannelMusicProgramSchema.safeParse(unmeteredMeditation).success, true,
  "meditation programs may explicitly omit meter without weakening other role validation");
assert.throws(() => createChannelMusicProgram({
  channelId: "channel-invalid-unmetered",
  channelIdentityFingerprint: sha("b"),
  family: "cinematic",
  contentLaneKey: "music_video",
  role: "primary_music",
  tempoMode: "unmetered",
  topic: "A focused instrumental",
}), /only supported for meditation and sleep roles/u);
const guidedSleepAlias = createChannelMusicProgram({
  channelId: "channel-guided-sleep-alias",
  channelIdentityFingerprint: sha("7"),
  family: "sleep",
  contentLaneKey: "ambient-guided",
  topic: "A slow walk through a quiet forest",
});
assert.equal(guidedSleepAlias.role, "sleep_sound_bed");
assert.equal(guidedSleepAlias.mix.narrationPriority, true,
  "spoken sleep aliases must reserve the foreground for narration");
assert.equal(guidedSleepAlias.mix.bodyMusicVol, 0.1026,
  "hyphenated spoken sleep lanes must not play their bed at full volume");
const unguidedMeditation = createChannelMusicProgram({
  channelId: "channel-unguided-meditation",
  channelIdentityFingerprint: sha("8"),
  family: "meditation",
  contentLaneKey: "unguided",
  topic: "Open silent awareness",
});
assert.equal(unguidedMeditation.role, "meditation_bed");
assert.equal(unguidedMeditation.mix.narrationPriority, false,
  "unguided meditation must not be mistaken for a spoken guided program");
assert.equal(unguidedMeditation.mix.bodyMusicVol, 0.25,
  "unguided meditation retains the intended music-forward bed level");
const meditationSibling = createChannelMusicProgram({
  channelId: "channel-meditation-es",
  channelIdentityFingerprint: sha("e"),
  family: "music_loop",
  contentLaneKey: "meditation",
  topic: "A different episode topic",
  providerPreference: meditation.generation.providerPreference,
  durationSec: meditation.generation.durationSec,
  genre: meditation.identity.genre,
  instrumentation: meditation.identity.instrumentation,
  textures: meditation.identity.textures,
  bpmRange: meditation.identity.bpmRange ?? undefined,
  moodArc: meditation.identity.moodArc,
  targetLufs: meditation.mix.targetLufs,
  bodyMusicVol: meditation.mix.bodyMusicVol,
});
assert.equal(musicSoundProfileFingerprint(meditation), musicSoundProfileFingerprint(meditationSibling),
  "channel and episode identifiers do not create a false sound-profile mismatch");
const differentSound = createChannelMusicProgram({
  channelId: "channel-meditation-different-sound",
  channelIdentityFingerprint: sha("f"),
  family: "music_loop",
  contentLaneKey: "meditation",
  topic: "A different episode topic",
  genre: "warm acoustic folk",
  instrumentation: ["nylon guitar", "upright bass"],
  textures: ["close wooden resonance"],
  moodArc: meditation.identity.moodArc,
});
assert.notEqual(musicSoundProfileFingerprint(meditation), musicSoundProfileFingerprint(differentSound),
  "a channel with different authored instrumentation cannot reuse this sound profile");
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
assert.ok(history.minimaxLicense, "MiniMax programs carry their provider-specific license terms");
assert.equal(history.minimaxLicense.uiAttribution, "MiniMax-Music3");
assert.equal(history.minimaxLicense.generatedContentDisclosureRequired, true);

for (const providerPreference of ["suno", "mureka"] as const) {
  const providerProgram = createChannelMusicProgram({
    channelId: `channel-${providerPreference}`,
    channelIdentityFingerprint: sha("a"),
    family: "narrated",
    contentLaneKey: "documentary",
    topic: "A provider-specific music brief",
    providerPreference,
  });
  assert.equal(providerProgram.generation.providerPreference, providerPreference);
  assert.equal(providerProgram.minimaxLicense, undefined,
    `${providerPreference} programs must not claim MiniMax-only attribution or commercial requirements`);
}

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
assert.throws(() => createChannelMusicProgram({
  channelId: "channel-lofi-role-conflict",
  channelIdentityFingerprint: sha("b"),
  family: "music_loop",
  contentLaneKey: "music_loop",
  topic: "Late tram through warm rain",
  role: "narration_bed",
}), /conflicts with route-owned role primary_music/u,
"the Lo-Fi route must not be reassigned to a ducked narration-bed role");
const { fingerprint: lofiFingerprint, ...lofiBody } = lofi;
assert.match(lofiFingerprint, /^[a-f0-9]{64}$/u, "the forged-route case starts from a valid sealed program");
const forgedLofiBody = {
  ...lofiBody,
  role: "narration_bed" as const,
  mix: { ...lofiBody.mix, bodyMusicVol: 0.1026, narrationPriority: true },
};
assert.throws(() => ChannelMusicProgramSchema.parse({
  ...forgedLofiBody,
  fingerprint: sha256Hex(canonicalJson(forgedLofiBody)),
}), /route-owned role primary_music/u,
"persisted Lo-Fi programs must retain route-role ownership even with a recomputed fingerprint");
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

const defaultLofi = createChannelMusicProgram({
  channelId: "channel-default-lofi",
  channelIdentityFingerprint: sha("e"),
  family: "music_loop",
  contentLaneKey: "music_loop",
  topic: "Rain at the last station",
});
assert.match(defaultLofi.identity.genre, /lo-fi/iu,
  "the canonical Lo-Fi product keeps its family-defining sound when no profile is configured");

const defaultMusicVideo = createChannelMusicProgram({
  channelId: "channel-default-music-video",
  channelIdentityFingerprint: sha("f"),
  family: "cinematic",
  contentLaneKey: "music_video",
  topic: "A city wakes before dawn",
});
assert.equal(defaultMusicVideo.role, "primary_music");
assert.equal(defaultMusicVideo.identity.genre,
  primaryMusicFallbackProfile({ family: "cinematic", contentLaneKey: "music_video", channelIdentitySeed: sha("f") }).genre);
assert.notEqual(defaultMusicVideo.identity.genre, "warm lo-fi instrumental",
  "generic primary-music routes need a music-forward, non-Lo-Fi program default");
assert.throws(() => createChannelMusicProgram({
  channelId: "channel-music-video-role-conflict",
  channelIdentityFingerprint: sha("f"),
  family: "cinematic",
  contentLaneKey: "music_video",
  topic: "A city wakes before dawn",
  role: "narration_bed",
}), /conflicts with route-owned role primary_music/u,
"music-video lanes must not be converted into ducked narration beds");
const { fingerprint: defaultMusicVideoFingerprint, ...defaultMusicVideoBody } = defaultMusicVideo;
assert.match(defaultMusicVideoFingerprint, /^[a-f0-9]{64}$/u);
assert.throws(() => ChannelMusicProgramSchema.parse({
  ...defaultMusicVideoBody,
  role: "narration_bed",
  mix: { ...defaultMusicVideoBody.mix, bodyMusicVol: 0.1026, narrationPriority: true },
  fingerprint: sha256Hex(canonicalJson({
    ...defaultMusicVideoBody,
    role: "narration_bed",
    mix: { ...defaultMusicVideoBody.mix, bodyMusicVol: 0.1026, narrationPriority: true },
  })),
}), /route-owned role primary_music/u,
"persisted music-video plans must retain primary-music ownership after re-fingerprinting");

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
assert.throws(() => createChannelMusicProgram({
  channelId: "channel-sleep-rhythm-conflict",
  channelIdentityFingerprint: sha("c"),
  family: "sleep",
  contentLaneKey: "music_loop",
  topic: "Steady rain through a quiet night",
  instrumentation: ["soft sustained pad", "soft boom-bap drums"],
}), /sleep soundscape cannot use rhythmic instrumentation: soft boom-bap drums/u,
"sleep programs must reject a channel palette that contradicts their beatless role before generation");
assert.throws(() => createChannelMusicProgram({
  channelId: "channel-sleep-genre-conflict",
  channelIdentityFingerprint: sha("c"),
  family: "sleep",
  contentLaneKey: "music_loop",
  topic: "Steady rain through a quiet night",
  genre: "minimal drum and bass",
  instrumentation: ["soft sustained pad"],
}), /sleep soundscape cannot use a rhythmic genre: minimal drum and bass/u,
"sleep programs must reject a channel genre that contradicts their beatless role before generation");
const conflictingSleepProgram = {
  ...sleep,
  identity: { ...sleep.identity, instrumentation: ["soft sustained pad", "soft boom-bap drums"] },
  generation: {
    ...sleep.generation,
    structuredCaption: `${sleep.generation.structuredCaption} soft boom-bap drums`,
  },
};
const { fingerprint: originalSleepFingerprint, ...conflictingSleepBody } = conflictingSleepProgram;
assert.ok(originalSleepFingerprint);
const reloadedSleep = ChannelMusicProgramSchema.safeParse({
  ...conflictingSleepBody,
  fingerprint: sha256Hex(canonicalJson(conflictingSleepBody)),
});
assert.equal(reloadedSleep.success, false, "reloaded sleep programs must not admit role-conflicting instrumentation");
assert.match(JSON.stringify(reloadedSleep.error?.issues), /sleep soundscape cannot use rhythmic instrumentation: soft boom-bap drums/u,
  "the persisted-program schema must report the role conflict, not only a changed fingerprint");
const conflictingSleepGenreProgram = {
  ...sleep,
  identity: { ...sleep.identity, genre: "minimal drum and bass" },
  generation: {
    ...sleep.generation,
    structuredCaption: sleep.generation.structuredCaption.replaceAll(sleep.identity.genre, "minimal drum and bass"),
  },
};
const { fingerprint: sleepGenreFingerprint, ...conflictingSleepGenreBody } = conflictingSleepGenreProgram;
assert.match(sleepGenreFingerprint, /^[a-f0-9]{64}$/u);
const reloadedSleepGenre = ChannelMusicProgramSchema.safeParse({
  ...conflictingSleepGenreBody,
  fingerprint: sha256Hex(canonicalJson(conflictingSleepGenreBody)),
});
assert.equal(reloadedSleepGenre.success, false, "reloaded sleep programs must not admit a rhythmic genre");
assert.match(JSON.stringify(reloadedSleepGenre.error?.issues), /sleep soundscape cannot use a rhythmic genre: minimal drum and bass/u,
  "the persisted-program schema must report the rhythmic genre conflict");
const conflictingSleepDirectionProgram = {
  ...sleep,
  generation: {
    ...sleep.generation,
    structuredCaption: `${sleep.generation.structuredCaption} Add a strong four-on-the-floor groove.`,
    sections: sleep.generation.sections.map((section, index) => index === 0
      ? { ...section, energy: 0.5, instruction: "Add a strong four-on-the-floor groove." }
      : section),
  },
};
const { fingerprint: sleepDirectionFingerprint, ...conflictingSleepDirectionBody } = conflictingSleepDirectionProgram;
assert.match(sleepDirectionFingerprint, /^[a-f0-9]{64}$/u);
const reloadedSleepDirection = ChannelMusicProgramSchema.safeParse({
  ...conflictingSleepDirectionBody,
  fingerprint: sha256Hex(canonicalJson(conflictingSleepDirectionBody)),
});
assert.equal(reloadedSleepDirection.success, false, "reloaded sleep programs must retain stable, beatless section direction");
assert.match(JSON.stringify(reloadedSleepDirection.error?.issues), /sleep soundscape sections must maintain stable low arousal/u);
assert.match(JSON.stringify(reloadedSleepDirection.error?.issues), /sleep soundscape cannot include rhythmic generation direction/u);
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
const { fingerprint: sleepFingerprint, ...sleepBody } = sleep;
assert.match(sleepFingerprint, /^[a-f0-9]{64}$/u, "the historical sleep receipt starts from a valid sealed program");
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
const guidedMeditationOnAmbientRoute = createChannelMusicProgram({
  channelId: "channel-guided-meditation-ambient-route",
  channelIdentityFingerprint: sha("a"),
  family: "sleep",
  contentLaneKey: "ambient_guided",
  role: "meditation_bed",
  topic: "A quiet guided breathing meditation",
});
assert.equal(guidedMeditationOnAmbientRoute.role, "meditation_bed",
  "the ambient-guided route must honor the Composer's explicit meditation role while retaining sleep as its default");
assert.equal(guidedMeditationOnAmbientRoute.mix.narrationPriority, true);
assert.equal(guidedMeditationOnAmbientRoute.mix.bodyMusicVol, 0.16);
assert.throws(() => createChannelMusicProgram({
  channelId: "channel-invalid-primary-on-ambient-route",
  channelIdentityFingerprint: sha("b"),
  family: "sleep",
  contentLaneKey: "ambient_guided",
  role: "primary_music",
  topic: "A quiet guided breathing meditation",
}), /conflicts with specialized route role sleep_sound_bed/u,
"the explicit meditation exception must not open the ambient route to unrelated music roles");
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
assert.ok(/meditation/iu.test(longMeditation.identity.genre),
  "long guided meditations retain a meditation-specific channel fallback identity");
assert.equal(longMeditation.mix.targetLufs, -18, "meditation retains a distinct target from sleep and primary music");
assert.equal(longMeditation.mix.narrationPriority, true,
  "guided meditation must preserve speech as the foreground even while retaining its meditative musical role");
assert.equal(longMeditation.mix.bodyMusicVol, 0.16,
  "guided meditation is more present than a documentary bed while leaving speech in the foreground");
const authoredMeditationGain = createChannelMusicProgram({
  channelId: "channel-authored-meditation-gain",
  channelIdentityFingerprint: sha("f"),
  family: "meditation",
  contentLaneKey: "ambient_guided",
  topic: "Quiet breathing",
  bodyMusicVol: 0.12,
});
assert.equal(authoredMeditationGain.mix.bodyMusicVol, 0.12,
  "an authored channel mix remains authoritative over the guided-meditation default");
assert.ok(longMeditation.identity.instrumentation.length >= 2);
assert.match(longMeditation.identity.moodArc, /calm|stillness|unhurried|breath/u);
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
assert.equal(longNarration.identity.genre, musicFallbackProfileForRole({
  role: "narration_bed", channelIdentitySeed: sha("f"),
}).genre);
assert.equal(longNarration.mix.targetLufs, -18, "narration beds retain their role-aware loudness target");
assert.match(longNarration.identity.moodArc, /unobtrusive beneath narration/u);

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
assert.deepEqual(musicProgramTechnicalQualityFailures({ program: lofi, measurements: receiptInput.measurements }), [],
  "the owner desk technical gate and durable release receipt share the same passing measurement decision");
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

const independentQualityRejections: {
  label: string;
  measurements?: Partial<typeof receiptInput.measurements>;
  sectionScore?: number;
  audition?: Partial<typeof receiptInput.audition>;
  expected: RegExp;
}[] = [
  { label: "loudness window", measurements: { integratedLufs: -19 }, expected: /integrated loudness/u },
  { label: "true-peak ceiling", measurements: { truePeakDbtp: -0.9 }, expected: /true peak/u },
  { label: "role-specific loudness range", measurements: { lraLu: 0.8 }, expected: /loudness range/u },
  { label: "crest factor", measurements: { crestDb: 4.2 }, expected: /crest factor/u },
  { label: "clipped samples", measurements: { clippedSamples: 1 }, expected: /clipped samples/u },
  { label: "flat-topped ceiling run", measurements: { maximumConsecutiveCeilingSamples: 4 }, expected: /flat-topped ceiling run/u },
  { label: "DC offset", measurements: { dcOffsetAbsolute: 0.021 }, expected: /DC offset/u },
  { label: "digital silence", measurements: { silenceFraction: 0.081 }, expected: /digital silence/u },
  { label: "mechanical artifacts", measurements: { mechanicalArtifactScore: 0.16 }, expected: /mechanical\/broadband artifact/u },
  { label: "known high-band collapse", measurements: { openingHighBandDropDb: 18.1 }, expected: /opening-to-early-interior high-band energy collapsed/u },
  { label: "per-section review floor", sectionScore: 0.74, expected: /at least one musical section failed review/u },
  { label: "emotional depth", audition: { emotionalDepthScore: 0.79 }, expected: /insufficient emotional depth/u },
  { label: "arrangement depth", audition: { arrangementDepthScore: 0.79 }, expected: /insufficient arrangement depth/u },
  { label: "generic result", audition: { hollowOrGeneric: true }, expected: /hollow or generic/u },
  { label: "failed audition", audition: { verdict: "fail" }, expected: /human audition did not pass/u },
];

for (const rejection of independentQualityRejections) {
  const candidate = {
    ...receiptInput,
    measurements: { ...receiptInput.measurements, ...rejection.measurements },
    sectionReviews: rejection.sectionScore === undefined
      ? receiptInput.sectionReviews
      : receiptInput.sectionReviews.map((section, index) =>
          index === 0 ? { ...section, score: rejection.sectionScore } : section),
    audition: { ...receiptInput.audition, ...rejection.audition },
  };
  assert.throws(
    () => createMusicProgramQualityReceipt({ program: lofi, ...candidate }),
    rejection.expected,
    `the independent ${rejection.label} gate must reject a failing result`,
  );
  if (rejection.measurements) {
    const failures = musicProgramTechnicalQualityFailures({
      program: lofi,
      measurements: { ...receiptInput.measurements, ...rejection.measurements },
    });
    assert.match(failures.join("; "), rejection.expected,
      `the owner desk must report the same technical failure for ${rejection.label}`);
  }
}

const tampered = structuredClone(history);
tampered.identity.genre = "generic cinematic";
assert.throws(
  () => ChannelMusicProgramSchema.parse(tampered),
  /fingerprint is invalid/i,
  "channel sound identity is fingerprint-bound",
);

const droppedSoundCue = structuredClone(history);
droppedSoundCue.generation.structuredCaption = droppedSoundCue.generation.structuredCaption
  .replaceAll("felt piano", "generic keyboard");
const { fingerprint: _droppedCueFingerprint, ...droppedCueBody } = droppedSoundCue;
void _droppedCueFingerprint;
assert.throws(
  () => ChannelMusicProgramSchema.parse({
    ...droppedCueBody,
    fingerprint: sha256Hex(canonicalJson(droppedCueBody)),
  }),
  /structured caption omits declared channel sound cue: felt piano/u,
  "a validly refingerprinted program cannot silently lose a declared channel instrument from the provider prompt",
);

const legacyPrompt = structuredClone(history);
delete legacyPrompt.channelIdentityPromptContract;
legacyPrompt.generation.structuredCaption = legacyPrompt.generation.structuredCaption
  .replaceAll("felt piano", "generic keyboard");
const { fingerprint: _legacyPromptFingerprint, ...legacyPromptBody } = legacyPrompt;
void _legacyPromptFingerprint;
assert.doesNotThrow(
  () => ChannelMusicProgramSchema.parse({
    ...legacyPromptBody,
    fingerprint: sha256Hex(canonicalJson(legacyPromptBody)),
  }),
  "legacy persisted v1 prompts without the new cue contract remain readable",
);

const tooShortCaption = structuredClone(history);
tooShortCaption.generation.structuredCaption = "A generic ambient track.";
assert.throws(
  () => ChannelMusicProgramSchema.parse(tooShortCaption),
  /structured caption must contain 250–450 words; received 4/u,
  "a MiniMax program cannot silently replace its creative brief with a weak one-line prompt",
);

const missingLicenseProgram = structuredClone(history);
delete missingLicenseProgram.minimaxLicense;
const { fingerprint: _missingLicenseFingerprint, ...missingLicenseBody } = missingLicenseProgram;
void _missingLicenseFingerprint;
assert.throws(
  () => ChannelMusicProgramSchema.parse({
    ...missingLicenseBody,
    fingerprint: sha256Hex(canonicalJson(missingLicenseBody)),
  }),
  /MiniMax-Music3 programs require the provider-specific license and attribution terms/u,
  "a MiniMax program cannot omit its provider-specific terms even with a valid content fingerprint",
);

const legacyMureka = structuredClone(createChannelMusicProgram({
  channelId: "channel-legacy-mureka",
  channelIdentityFingerprint: sha("a"),
  family: "narrated",
  contentLaneKey: "documentary",
  topic: "Legacy provider record",
  providerPreference: "mureka",
}));
legacyMureka.minimaxLicense = history.minimaxLicense;
const { fingerprint: _legacyFingerprint, ...legacyBody } = legacyMureka;
void _legacyFingerprint;
assert.doesNotThrow(
  () => ChannelMusicProgramSchema.parse({
    ...legacyBody,
    fingerprint: sha256Hex(canonicalJson(legacyBody)),
  }),
  "legacy fingerprinted provider records with the old extra terms remain readable",
);

console.log("CHANNEL MUSIC PROGRAM PASS: role-specific structure, mix, licensing, and listened quality gate");
