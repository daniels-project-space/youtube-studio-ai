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

import { FALLBACK_UNDERSCORE_BRIEFS, spreadDefault } from "@/lib/identitySpread";
import { musicFallbackPromptForRoute } from "../musicBlocks";

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

  // ---- lofi keeps its own sound -------------------------------------------
  const lofiPrompt = musicFallbackPromptForRoute({
    family: "music_loop", contentLaneKey: "music_loop", topic: "quiet harbor", channelIdentitySeed: "Seaside Ghibli",
  });
  assert.match(lofiPrompt, /warm cozy lofi hip-hop/,
    "the exact loop route must retain its own sound — that sound is the product");
  const narratedPrompts = channels.map((channelIdentitySeed) => musicFallbackPromptForRoute({
    family: "narrated", contentLaneKey: "narrated_longform", topic: "a measured story", channelIdentitySeed,
  }));
  assert.ok(new Set(narratedPrompts).size >= 3,
    "narrated channels must draw distinct identity-bound prompts rather than inherit Lo-Fi or one generic bed");

  // ---- the archetype must not hard-code one identity ----------------------
  assert.ok(
    !/very calm, gentle ambient underscore/.test(ARCHETYPES),
    "an archetype literal is copied onto every channel built from it — it must not " +
      "override the three differentiating paths beneath it",
  );

  console.log("MUSIC IDENTITY PASS — undeclared channels differ, and lofi stays lofi");
}

main();
