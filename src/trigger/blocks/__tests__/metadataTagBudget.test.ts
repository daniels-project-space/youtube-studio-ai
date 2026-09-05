/**
 * The tag list the module REPORTS must be the tag list YouTube RECEIVES.
 *
 * finishMetadata capped tags at 30 by count. Count was never the binding
 * constraint: YouTube budgets tags by total character length (~500, with
 * space-containing tags counted as if quoted), and the uploader clamps to that
 * by dropping the tail — silently, with a `break`.
 *
 * Measured by running the real craftMetadata across four live channels, the
 * module emitted 594, 600, 692 and 797 effective characters against a 460
 * budget. Between 6 and 13 tags per video never reached YouTube.
 *
 * The divergence matters beyond the lost tags. `tags` is persisted with the
 * release and read back by the learning loops, so a 30-tag record for a video
 * that actually shipped 17 trains them on tags that were never live — the
 * module's own memory of what it tried becomes fiction.
 *
 * An earlier measurement of mine said this problem did not exist. It used the
 * curated nicheIntel vocabularies, which are short, and concluded no channel
 * overflowed. The generated tags are the long ones. Measuring the wrong input
 * is how a real defect gets a clean bill of health.
 */
import assert from "node:assert/strict";

import { finishMetadata } from "../intelligenceBlocks";
import type { StageContext } from "@/engine/types";

/** How YouTube counts a tag list. */
const cost = (tags: string[]): number =>
  tags.reduce((n, t) => n + t.length + (t.includes(" ") ? 2 : 0) + 1, 0);

const BUDGET = 460;

function ctxWith(params: Record<string, unknown> = {}, store: Record<string, unknown> = {}): StageContext {
  const logs: string[] = [];
  const ctx = { params, store, log: (m: string) => logs.push(m) } as unknown as StageContext;
  (ctx as unknown as { _logs: string[] })._logs = logs;
  return ctx;
}
const logsOf = (ctx: StageContext): string[] => (ctx as unknown as { _logs: string[] })._logs;

function main(): void {
  // ---- the real shape that was overflowing -------------------------------
  // Long, multi-word, video-specific tags are what the generator actually
  // produces; this list costs well over the budget.
  const generated = [
    "desmond doss hacksaw ridge", "conscientious objector world war 2", "medal of honor recipient",
    "okinawa battle history", "hacksaw ridge true story", "desmond doss real story",
    "world war 2 documentary", "seventh day adventist soldier", "combat medic okinawa",
    "military history documentary", "pacific theater world war two", "war hero true story",
    "doss maeda escarpment", "unarmed soldier world war 2", "faith under fire history",
    "wwii battlefield medicine", "conscientious objector medal of honor", "history documentary channel",
  ];
  assert.ok(cost(generated) > BUDGET, "the fixture must genuinely overflow, or it proves nothing");

  const ctx = ctxWith({ baseTags: ["inked histories", "history"] });
  const out = finishMetadata(ctx, {
    title: "Why the Snipers at Hacksaw Ridge Kept Missing Desmond Doss",
    description: "A description long enough to be plausible.",
    tags: generated,
    channelName: "Inked Histories",
    // A realistic researched vocabulary, not three short words: with enough
    // niche reach in play, ORDER decides what survives the budget. A shorter
    // fixture let both orderings pass and made the order assertion below
    // decorative.
    nicheIntel: {
      topTags: [
        "military history documentaries", "second world war documentary series",
        "battlefield history explained", "war documentary full episodes",
        "history channel documentary", "wwii pacific campaign history",
        "famous soldiers of world war two", "war stories documentary",
        "history explained documentary", "20th century military history",
        "great battles of the second world war", "military history explained simply",
        "documentary about world war two", "wartime heroism documentaries",
      ].map((tag) => ({ tag })),
    } as never,
  });

  assert.ok(
    cost(out.tags) <= BUDGET,
    `the module must not report tags that exceed the budget it is measured against (${cost(out.tags)} > ${BUDGET})`,
  );
  assert.ok(out.tags.length > 0, "clamping must not empty the list");
  assert.ok(out.tags.length < generated.length + 2, "an overflowing list must actually lose entries");

  // The cut must be stated. Silent divergence between what the module thinks it
  // shipped and what shipped is the whole defect.
  assert.ok(
    logsOf(ctx).some((l) => /exceeded YouTube's character budget/.test(l)),
    "the module must log which tags it cut, and why",
  );

  // ---- order is the policy -------------------------------------------------
  // Channel identity first, then this video's own terms, then broad niche
  // reach — so what gets cut is the least specific material, not the video's.
  assert.equal(out.tags[0], "inked histories", "channel identity tags must survive first");
  assert.ok(
    out.tags.some((t) => t.includes("desmond doss")),
    "this video's own specific terms must survive the cut — if broad niche reach were " +
      "ordered ahead of them, the budget would be spent before this video's subject appeared",
  );
  // Sized on purpose: the niche block alone costs more than the whole budget,
  // so this assertion actually detects a reordering instead of passing either
  // way. The first version did not, which made it decorative.
  assert.ok(
    cost([
      "military history documentaries", "second world war documentary series",
      "battlefield history explained", "war documentary full episodes",
      "history channel documentary", "wwii pacific campaign history",
      "famous soldiers of world war two", "war stories documentary",
      "history explained documentary", "20th century military history",
      "great battles of the second world war", "military history explained simply",
      "documentary about world war two", "wartime heroism documentaries",
    ]) > BUDGET,
    "the niche fixture must exceed the budget on its own, or ordering cannot be tested",
  );

  // ---- a list that fits must be untouched ---------------------------------
  const short = ["lofi", "chillhop", "study music", "jazzhop", "focus", "beats"];
  assert.ok(cost(short) < BUDGET);
  const fine = finishMetadata(ctxWith(), {
    title: "Late night Tokyo train ride lofi",
    description: "d",
    tags: short,
    channelName: "Neon Rain Penthouse",
    nicheIntel: null,
  });
  assert.deepEqual(fine.tags, short, "a list within budget must pass through untouched");

  // ---- the empty guard still holds ----------------------------------------
  const none = finishMetadata(ctxWith(), {
    title: "A Fallback Title",
    description: "d",
    tags: [],
    channelName: "",
    nicheIntel: null,
  });
  assert.deepEqual(none.tags, ["a fallback title"], "an empty tag list must still fall back to the title");

  console.log("METADATA TAG BUDGET PASS — reported tags equal shipped tags");
}

main();
