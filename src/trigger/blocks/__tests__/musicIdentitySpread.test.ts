/**
 * Two channels that declare no sound of their own must not receive the same one.
 *
 * The music block's last-resort prompt was a single LOFI HIP-HOP brief — Rhodes
 * piano, boom-bap drums, vinyl crackle — left from when this block served only
 * the lofi family. It now serves twelve channels, most not lofi, so a finance or
 * philosophy channel with no styleDNA audio and no composer brief was one
 * missing param away from being scored as lofi. Nothing caught it, because a
 * wrong score renders, passes QA and uploads perfectly.
 *
 * Separately, the NARRATED archetype hard-coded a music prompt, and an archetype
 * literal is copied verbatim onto every channel built from it. Six live channels
 * — two finance and four philosophy — hold byte-identical musical briefs because
 * of that one line, and that param overrode all three of the differentiating
 * paths beneath it.
 *
 * The lofi family is deliberately exempt. Its sound IS the product, one of its
 * channels has no styleDNA audio, and spreading it onto a string bed would be a
 * far worse regression than the convergence being fixed. That is the golden
 * reference this repo is meant to protect.
 */
import assert from "node:assert/strict";

import {
  createChannelMusicProgram,
  musicFallbackProfileForRole,
  musicRoleForRoute,
  musicProviderPromptForProgram,
} from "@/engine/channelMusicProgram";
import { ARCHETYPES } from "@/engine/archetypes";
import { CHANNEL_IDENTITY_SHORT_FORM_MUSIC_VERSION } from "@/engine/musicModuleVersions";
import { selectChannelIdentityMusicProfile } from "@/engine/composerMixPipelineSelection";
import type { PipelineEntry } from "@/engine/types";
import { musicFallbackPromptForRoute } from "../musicBlocks";

function main(): void {
  // ---- the range actually differentiates ----------------------------------
  const channels = [
    "Investory", "Chalk & Compound", "Stoic Truths", "The Quiet Stoic",
    "Stoic Truths (ES)", "Stoic Truths (DE)",
  ];
  const briefs = new Set(channels.map((channelIdentitySeed) => musicFallbackProfileForRole({
    role: "narration_bed", channelIdentitySeed,
  }).prompt));
  assert.ok(
    briefs.size >= 3,
    `six channels resolved to ${briefs.size} distinct brief(s) — a last resort that returns one ` +
      `point gives every undeclared channel the same sound`,
  );
  // Stable, or a channel's score changes between episodes.
  assert.equal(
    musicFallbackProfileForRole({ role: "narration_bed", channelIdentitySeed: "Investory" }).prompt,
    musicFallbackProfileForRole({ role: "narration_bed", channelIdentitySeed: "Investory" }).prompt,
    "the same channel must always resolve to the same brief",
  );

  // ---- every brief must be usable UNDER narration -------------------------
  // A bed that competes with speech is worse than a shared one.
  for (const channelIdentitySeed of channels) {
    const brief = musicFallbackProfileForRole({ role: "narration_bed", channelIdentitySeed }).prompt;
    assert.match(brief, /purely instrumental/, `"${brief.slice(0, 30)}" must declare it is instrumental`);
    assert.match(brief, /no build-ups/, `"${brief.slice(0, 30)}" must forbid build-ups under narration`);
    assert.ok(
      /no percussion|no drums|no rhythm section/.test(brief),
      `"${brief.slice(0, 30)}" must forbid percussion competing with speech`,
    );
  }

  // The default remains the immutable legacy profile; only the selected new
  // module version spreads concise beds across short-form channel identities.
  const legacyShortForm = channels.map((channelIdentitySeed) => musicFallbackProfileForRole({
    role: "short_form_bed", channelIdentitySeed,
  }));
  assert.equal(new Set(legacyShortForm.map((profile) => profile.prompt)).size, 1,
    "legacy unversioned short-form runs must retain their established fallback");
  const versionedShortForm = channels.map((channelIdentitySeed) => musicFallbackProfileForRole({
    role: "short_form_bed", channelIdentitySeed, profileVersion: "channel-identity-short-form/v1",
  }));
  assert.ok(new Set(versionedShortForm.map((profile) => profile.prompt)).size >= 3,
    "the versioned short-form range must make channel identity audible in the fallback brief");
  for (const profile of versionedShortForm) {
    assert.match(profile.prompt, /no vocals/u);
    assert.match(profile.moodArc, /immediately|at once|quickly/u);
    assert.match(profile.moodArc, /resolve|ending|finish|button/u);
  }
  assert.equal(versionedShortForm[0].prompt,
    musicFallbackProfileForRole({
      role: "short_form_bed", channelIdentitySeed: channels[0], profileVersion: "channel-identity-short-form/v1",
    }).prompt,
    "the same short-form channel identity must resolve deterministically");
  const programSeed = "a".repeat(64);
  const expectedProgramProfile = musicFallbackProfileForRole({
    role: "short_form_bed", channelIdentitySeed: programSeed, profileVersion: "channel-identity-short-form/v1",
  });
  const versionedProgram = createChannelMusicProgram({
    channelId: "short-channel", channelIdentityFingerprint: programSeed, family: "shorts",
    contentLaneKey: "shorts", topic: "one useful idea", role: "short_form_bed",
    musicProfileVersion: "channel-identity-short-form/v1", durationSec: 45,
  });
  assert.equal(versionedProgram.identity.genre, expectedProgramProfile.genre,
    "the sealed production program must consume the selected versioned profile");
  assert.deepEqual(versionedProgram.identity.instrumentation, expectedProgramProfile.instrumentation);
  const legacyProgram = createChannelMusicProgram({
    channelId: "short-channel", channelIdentityFingerprint: programSeed, family: "shorts",
    contentLaneKey: "shorts", topic: "one useful idea", role: "short_form_bed", durationSec: 45,
  });
  assert.equal(legacyProgram.identity.genre, legacyShortForm[0].genre,
    "unversioned program construction retains the established short-form profile");
  const providerPrompts = channels.map((channelIdentitySeed, index) => {
    const fingerprint = index.toString(16).padStart(64, "0");
    const program = createChannelMusicProgram({
      channelId: channelIdentitySeed, channelIdentityFingerprint: fingerprint, family: "shorts",
      contentLaneKey: "shorts", topic: "one useful idea", role: "short_form_bed",
      musicProfileVersion: "channel-identity-short-form/v1", durationSec: 45,
    });
    return musicProviderPromptForProgram(program);
  });
  assert.ok(new Set(providerPrompts).size >= 3,
    "the actual provider prompt must preserve the versioned short-form identity differences");
  const selectable: PipelineEntry[] = [
    { block: "composer_brief" }, { block: "music" }, { block: "timeline_assemble" },
  ];
  const identitySelected = selectChannelIdentityMusicProfile(selectable, "short_form_bed");
  assert.equal(identitySelected[1].version, CHANNEL_IDENTITY_SHORT_FORM_MUSIC_VERSION);
  assert.equal(selectable[1].version, undefined, "selection leaves legacy source entries untouched");
  assert.equal(selectChannelIdentityMusicProfile(selectable, "narration_bed")[1].version, undefined,
    "other music roles do not receive the short-form profile version");
  assert.equal(selectChannelIdentityMusicProfile([
    selectable[0], { ...selectable[1], version: "1.0.0-owner-pinned" }, selectable[2],
  ], "short_form_bed")[1].version, "1.0.0-owner-pinned",
  "explicit module pins remain authoritative");

  // ---- lofi keeps its own sound -------------------------------------------
  const lofiPrompt = musicFallbackPromptForRoute({
    family: "music_loop", contentLaneKey: "music_loop", topic: "quiet harbor", channelIdentitySeed: "Seaside Ghibli",
  });
  assert.match(lofiPrompt, /lo-fi instrumental/,
    "the exact loop route must retain its own sound — that sound is the product");
  const narratedPrompts = channels.map((channelIdentitySeed) => musicFallbackPromptForRoute({
    family: "narrated", contentLaneKey: "narrated_longform", topic: "a measured story", channelIdentitySeed,
  }));
  assert.ok(new Set(narratedPrompts).size >= 3,
    "narrated channels must draw distinct identity-bound prompts rather than inherit Lo-Fi or one generic bed");
  for (const [index, channelIdentitySeed] of channels.entries()) {
    const profile = musicFallbackProfileForRole({ role: "narration_bed", channelIdentitySeed });
    assert.equal(narratedPrompts[index], `${profile.prompt}, evoking "a measured story"; no vocals, no lyrics`);
  }
  const versionedShortFormPrompts = channels.map((channelIdentitySeed) => musicFallbackPromptForRoute({
    family: "shorts", contentLaneKey: "shorts", topic: "one useful idea", channelIdentitySeed,
    profileVersion: "channel-identity-short-form/v1",
  }));
  assert.ok(new Set(versionedShortFormPrompts).size >= 3,
    "the real route prompt adapter must carry the selected short-form identity profile");

  // ---- meditation stays calm while retaining channel identity ------------
  const meditationRole = musicRoleForRoute("meditation", "meditation");
  assert.equal(meditationRole, "meditation_bed");
  const meditationPrompts = channels.map((channelIdentitySeed) => musicFallbackPromptForRoute({
    family: "meditation", contentLaneKey: "meditation", topic: "a quiet breath",
    channelIdentitySeed,
  }));
  assert.ok(new Set(meditationPrompts).size >= 3,
    "meditation channels must retain identity-specific fallback prompts");
  for (const prompt of meditationPrompts) {
    assert.match(prompt, /no percussion or dramatic build-ups, purely instrumental/);
    assert.match(prompt, /no vocals, no lyrics$/);
  }

  // ---- archetypes must not hard-code one identity ------------------------
  const meditationMusic = ARCHETYPES.meditation.pipeline.find(({ block }) => block === "music");
  assert.ok(
    meditationMusic?.params?.prompt === undefined,
    "the meditation archetype must leave its identity-bound music fallback selectable",
  );

  console.log("MUSIC IDENTITY PASS — channel-bound narration and short-form profiles; legacy short-form and Lo-Fi remain unchanged");
}

main();
