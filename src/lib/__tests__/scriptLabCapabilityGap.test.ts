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

import { distillScriptPlaybook, narrativePlaybookCapability } from "@/lib/scriptLab";
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

  /* ------------- the refusal happens BEFORE any stage runs ---------------- */

  // This is the part that stops a half-built channel being left behind. The
  // playbook call lives in the "channel-inception-seo" stage, and voice casting,
  // the avatar, the banner, the thumbnails and the pipeline compilation are all
  // stages AFTER it — so a throw there created the channel row and abandoned it.
  // designChannelInception now ASKS the capability up front and returns the same
  // clean plan-only draft it already produces when execution is not admitted.
  const capability = narrativePlaybookCapability();
  assert.equal(capability.available, false, "the playbook is unavailable — if it is not, delete this test");
  assert.match(capability.reason, /capability gap, not a missing key/, "the reason must not read as misconfiguration");

  const askAt = inception.indexOf("narrativePlaybookCapability(");
  const firstStageAt = inception.indexOf("await runStage(");
  const playbookAt = inception.indexOf("distillScriptPlaybook(");
  assert.ok(askAt > 0, "inception must ask whether the playbook is available");
  assert.ok(
    askAt < firstStageAt,
    "the capability must be checked BEFORE the first inception stage, or a channel is still abandoned mid-build",
  );
  assert.ok(askAt < playbookAt, "and before the call that would throw");
  // Computing the capability first is not enough — it has to DECIDE the refusal.
  // Without this, deleting `|| !playbookCapability.available` from the condition
  // left every assertion above still passing.
  assert.match(
    inception,
    /if \(!admission\.executionAuthorized \|\| !playbookCapability\.available\)/,
    "the missing capability must itself trigger the plan-only refusal, not merely be computed",
  );
  assert.match(
    inception,
    /requires a narrative playbook: \$\{playbookCapability\.reason\}/,
    "the blocker must carry the capability's own reason rather than restating it",
  );

  console.log(
    `SCRIPTLAB CAPABILITY GAP PASS — refused up front, not mid-build; ` +
      `${blocked.length} families: ${blocked.join(", ")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
