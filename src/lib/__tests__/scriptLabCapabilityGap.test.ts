/**
 * The narrative playbook is BLOCKED, and the blast radius must stay visible.
 *
 * distillScriptPlaybook watches the first 75 seconds of each reference video via
 * geminiAnalyzeYouTube, which ingests a YouTube URL directly. Nothing else wired
 * here can read video, and hasGeminiKey() returns false unconditionally by
 * policy ("Generic Gemini is intentionally unavailable"). So the function throws
 * on every call, and designChannelInception calls it UNCONDITIONALLY for any
 * family whose policy sets requiresNarrativePlaybook.
 *
 * That means Channel Inception cannot complete for those families. This test
 * exists to keep three things true while that is the case:
 *
 *   1. the failure is honest — the old message asked for a GEMINI_API_KEY, which
 *      would send someone hunting for a key that cannot fix it;
 *   2. the blast radius is pinned — if a family policy changes, the list in the
 *      error goes stale and this fails rather than quietly misinforming;
 *   3. it is a CAPABILITY gap, so when a non-video route to the same playbook
 *      exists, this test is what tells you the guard can come out.
 *
 * The existing designChannelInceptionNoGemini guard did not catch this: it
 * asserts that file never imports @/lib/gemini directly, and it does not — it
 * reaches Gemini through `await import("@/lib/scriptLab")`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { distillScriptPlaybook } from "@/lib/scriptLab";
import { CHANNEL_INCEPTION_FAMILY_POLICIES } from "@/engine/channelInceptionContracts";

async function main(): Promise<void> {
  /* ---------------------- it fails, and says why honestly ------------------- */

  const failure = await distillScriptPlaybook({
  refs: [{ videoId: "dQw4w9WgXcQ", title: "A reference video", views: 1_000_000 }],
  dna: null,
  channelName: "Stoic Truths",
  positioning: "practical ancient philosophy",
  log: () => {},
  }).then(
  () => null,
  (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

  assert.ok(failure, "the narrative playbook must still be blocked — if it succeeded, delete this test");
  assert.match(failure, /capability gap, not a missing key/, "the failure must not read as a misconfiguration");
  assert.ok(
  !/GEMINI_API_KEY \+ OPENROUTER_API_KEY required/.test(failure),
  "the old message asked for a key that cannot fix this",
  );

  /* ------------------------ the blast radius is current --------------------- */

  const blocked = Object.entries(CHANNEL_INCEPTION_FAMILY_POLICIES)
  .filter(([, policy]) => (policy as { requiresNarrativePlaybook?: boolean }).requiresNarrativePlaybook)
  .map(([family]) => family)
  .sort();

  assert.ok(blocked.length > 0, "some family requires the playbook, or this whole test is moot");
  // The message states the CONDITION, not a list. An enumerated list is what the
  // first version of this said — "narrated_stock, comic, shorts" — and this test
  // immediately falsified it: the real set is TEN of the eleven families,
  // everything except music_loop. A list inside a thrown string goes stale
  // silently; the condition does not.
  assert.match(
    failure,
    /requiresNarrativePlaybook/,
    "the error must name the policy flag that decides who is blocked",
  );
  assert.ok(
    blocked.length >= 2 && !blocked.includes("music_loop"),
    `music_loop is the one family that needs no playbook; live blocked set: ${blocked.join(", ")}`,
  );

  /* --------------- inception really does call it unconditionally ------------ */

  // If this stops being true — a try/catch, or a degraded playbook — the families
  // are no longer blocked and the message above becomes the stale claim.
  const inception = readFileSync(join(process.cwd(), "src/trigger/designChannelInception.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.match(
  inception,
  /if \(plan\.familyPolicy\.requiresNarrativePlaybook\) \{[\s\S]{0,400}?scriptPlaybook = await distillScriptPlaybook\(/,
  "inception must still call the playbook unconditionally for those families",
  );

  console.log(
    `SCRIPTLAB CAPABILITY GAP PASS — Channel Inception blocked for ${blocked.length} families: ` +
      `${blocked.join(", ")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
