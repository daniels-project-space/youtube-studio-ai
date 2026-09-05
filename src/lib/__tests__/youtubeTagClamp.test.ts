/**
 * Both YouTube snippet writers must obey the same tag constraint.
 *
 * YouTube rejects a tag list on its TOTAL character length (roughly 500, with
 * space-containing tags counted as if quoted) and refuses "<" and ">". The
 * upload path has always run clampTags. The metadata UPDATE path capped only
 * the COUNT — `tags.slice(0, 30)` — which is not the constraint YouTube
 * enforces.
 *
 * The consequence is out of proportion to the cause: title and tags travel in
 * one snippet PUT, so an over-long tag list returns "invalidTags", the call
 * throws, and the TITLE rewrite is lost with it. seoReoptimize is the live
 * caller that passes tags.
 *
 * Scope claim, stated honestly: this was found by reading, not by observing a
 * failure. Measured against the real niche vocabularies of all 12 live channels
 * that run the metadata block, a full 30-tag list costs 298-447 effective
 * characters and none currently exceed the cap. The fix is for the asymmetry
 * and the disproportionate failure, not a fire.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { clampTags } from "@/lib/youtube";

const SOURCE = readFileSync(join(process.cwd(), "src/lib/youtube.ts"), "utf8");

/** How YouTube counts a tag list: quoted when it contains a space, plus a separator. */
const effectiveCost = (tags: string[]): number =>
  tags.reduce((total, t) => total + t.length + (t.includes(" ") ? 2 : 0) + 1, 0);

function main(): void {
  // ---- the constraint ------------------------------------------------------
  const longList = Array.from({ length: 30 }, (_, i) => `a very long search phrase number ${i}`);
  assert.ok(effectiveCost(longList) > 460, "the fixture must actually exceed the cap, or it proves nothing");
  const clamped = clampTags(longList);
  assert.ok(effectiveCost(clamped) <= 460, "clampTags must bring the list under the effective cap");
  assert.ok(clamped.length < longList.length, "it must do so by dropping tags, not by silently truncating one");

  // The count-only rule the update path used would NOT have helped: 30 tags is
  // already within the count limit, and still far over the character limit.
  assert.ok(
    effectiveCost(longList.slice(0, 30)) > 460,
    "slice(0, 30) leaves an over-cap list — which is exactly why the update path could fail",
  );

  // ---- character hygiene ---------------------------------------------------
  assert.deepEqual(clampTags(["<script>", "clean tag"]), ["script", "clean tag"], "angle brackets must be stripped");
  assert.deepEqual(clampTags(["  padded  "]), ["padded"], "tags must be trimmed");
  assert.deepEqual(clampTags(["", "   ", "real"]), ["real"], "empty tags must be dropped, not sent as blanks");
  assert.equal(clampTags(["x".repeat(200)])[0].length, 60, "a single tag must be capped at 60 characters");

  // ---- what must NOT change ------------------------------------------------
  // Real channels ship 30 tags costing 298-447 effective chars. Clamping must
  // be invisible to them; a stricter cap would quietly cost live discovery.
  const realistic = [
    "lofi hip hop", "lofi", "lofi music", "chillhop", "chill music", "chill",
    "study music", "relaxing music", "sleep music", "calm music", "beats to study to",
    "instrumental", "jazzhop", "lofi beats", "focus music",
  ];
  assert.deepEqual(clampTags(realistic), realistic, "an ordinary real tag list must pass through untouched");

  assert.deepEqual(clampTags([]), [], "an empty list is not an error");

  // ---- both writers must use it -------------------------------------------
  // The asymmetry is the whole bug, so assert it cannot come back.
  const uploadUsesClamp = /tags: clampTags\(args\.tags\)/.test(SOURCE);
  const updateUsesClamp = /tags: clampTags\(args\.tags\) \}/.test(SOURCE);
  assert.ok(uploadUsesClamp, "the upload path must clamp");
  assert.ok(updateUsesClamp, "the metadata update path must clamp too");
  assert.ok(
    !/tags: args\.tags\.slice\(/.test(SOURCE),
    "no snippet writer may cap tags by COUNT alone — that is not the constraint YouTube enforces",
  );

  console.log("YOUTUBE TAG CLAMP PASS — both snippet writers obey the character constraint");
}

main();
