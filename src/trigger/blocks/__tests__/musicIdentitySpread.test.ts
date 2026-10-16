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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { FALLBACK_UNDERSCORE_BRIEFS, fallbackMusicPrompt, spreadDefault } from "@/lib/identitySpread";

const MUSIC = readFileSync(join(process.cwd(), "src/trigger/blocks/musicBlocks.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ARCHETYPES = readFileSync(join(process.cwd(), "src/engine/archetypes.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function main(): void {
  // ---- the range actually differentiates ----------------------------------
  const channels = [
    "Investory", "Chalk & Compound", "Stoic Truths", "The Quiet Stoic",
    "Stoic Truths (ES)", "Stoic Truths (DE)",
  ];
  const briefs = new Set(channels.map((c) => spreadDefault(c, FALLBACK_UNDERSCORE_BRIEFS)));
  assert.ok(
    briefs.size >= 3,
    `six channels resolved to ${briefs.size} distinct brief(s) — a last resort that returns one ` +
      `point gives every undeclared channel the same sound`,
  );
  // Stable, or a channel's score changes between episodes.
  assert.equal(
    spreadDefault("Investory", FALLBACK_UNDERSCORE_BRIEFS),
    spreadDefault("Investory", FALLBACK_UNDERSCORE_BRIEFS),
    "the same channel must always resolve to the same brief",
  );
  const unnamedChannels = ["channel-101", "channel-202", "channel-303", "channel-404", "channel-505"];
  const unnamedPrompts = unnamedChannels.map((id) => fallbackMusicPrompt("  ", id, "Market history", "narrated_stock"));
  assert.ok(
    new Set(unnamedPrompts).size >= 4,
    "blank names must fall back to each channel ID instead of collapsing onto the empty seed",
  );
  assert.equal(
    fallbackMusicPrompt("  Investory ", "other-id", "Market history", "narrated_stock"),
    fallbackMusicPrompt("Investory", "different-id", "Market history", "narrated_stock"),
    "a valid channel name, not a storage ID, must anchor its stable sound",
  );

  // ---- every brief must be usable UNDER narration -------------------------
  // A bed that competes with speech is worse than a shared one.
  for (const brief of FALLBACK_UNDERSCORE_BRIEFS) {
    assert.match(brief, /purely instrumental/, `"${brief.slice(0, 30)}" must declare it is instrumental`);
    assert.match(brief, /no build-ups/, `"${brief.slice(0, 30)}" must forbid build-ups under narration`);
    assert.ok(
      /no percussion|no drums|no rhythm section/.test(brief),
      `"${brief.slice(0, 30)}" must forbid percussion competing with speech`,
    );
  }
  for (const prompt of unnamedPrompts) {
    assert.match(prompt, /no vocals, no lyrics/);
    assert.match(prompt, /purely instrumental/);
    assert.match(prompt, /no build-ups/);
    assert.ok(/no percussion|no drums|no rhythm section/.test(prompt));
  }
  const sleepChannels = ["Quiet Tide", "Night Lantern", "Soft Current", "Restful Hours", "Moonlit Room"];
  const sleepPrompts = sleepChannels.map((name, index) =>
    fallbackMusicPrompt(name, `sleep-${index}`, "A safe place to rest", "sleep"),
  );
  assert.ok(
    new Set(sleepPrompts).size >= 3,
    "sleep channels need stable sonic variety without borrowing the Lo-Fi identity",
  );
  for (const prompt of sleepPrompts) {
    assert.match(prompt, /sleep soundscape|meditation soundscape/i);
    assert.match(prompt, /no abrupt|no sudden/);
    assert.match(prompt, /no vocals/);
    assert.doesNotMatch(prompt, /lofi hip-hop|boom-bap/i);
  }

  // ---- lofi keeps its own sound -------------------------------------------
  assert.match(MUSIC, /fallbackMusicPrompt\(ctx\.store\["channelName"\], ctx\.channelId, topic, musicRoute\?\.family\)/);
  const lofiPrompt = fallbackMusicPrompt("", "lofi-1", "Night rain", "music_loop");
  assert.match(lofiPrompt, /warm cozy lofi hip-hop/);
  assert.match(lofiPrompt, /boom-bap drums/);
  assert.doesNotMatch(lofiPrompt, /no percussion|no drums/);

  // ---- the archetype must not hard-code one identity ----------------------
  assert.ok(
    !/very calm, gentle ambient underscore/.test(ARCHETYPES),
    "an archetype literal is copied onto every channel built from it — it must not " +
      "override the three differentiating paths beneath it",
  );

  console.log("MUSIC IDENTITY PASS — undeclared channels differ, and lofi stays lofi");
}

main();
