import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MODULE_REGISTRY } from "@/engine/moduleRegistry";
import { TITLE_PROFILES } from "@/lib/titleProfile";

const source = readFileSync(join(process.cwd(), "src/trigger/blocks/intelligenceBlocks.ts"), "utf8");

async function main(): Promise<void> {
  // The no-provider path is intentionally deterministic and hermetic. A plan
  // title is input context, not evidence: it must not regain authority merely
  // because the current title module cannot run.
  const originalKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const { metadataOptimized } = await import("../intelligenceBlocks");
    const logs: string[] = [];
    const topic = "How the Roman aqueducts moved water uphill";
    const plannedTitle = "The Roman Water Secret Nobody Understands";
    const ctx = {
      ownerId: "owner-test",
      runId: "run-test",
      channelId: "channel-test",
      keyPrefix: "owner/test/",
      params: {},
      store: {
        topic,
        plannedTitle,
        channelName: "Inked Histories",
        niche: "history",
        persona: "documentary narrator",
      },
      budgetUsd: 5,
      log: (message: string) => logs.push(message),
    } as never;

    const out = await metadataOptimized.run(ctx);
    assert.equal(out.title, topic.slice(0, 70), "degraded metadata must use the evaluated topic fallback");
    assert.notEqual(out.title, plannedTitle, "an unevaluated planned title must not override the fallback");
    assert.match(
      logs.join("\n"),
      /planned title held out \(not evaluated\)/,
      "the operator must be told why the plan title was not used",
    );

    const titleProfileKnob = MODULE_REGISTRY.metadata?.customization?.knobs.find((knob) => knob.id === "titleProfile");
    assert.deepEqual(titleProfileKnob?.values, ["auto", ...Object.keys(TITLE_PROFILES)],
      "the module surface must expose auto plus the authoritative format-profile set");
    assert.equal(titleProfileKnob?.default, "auto",
      "the visible default must match the route-sealed format profile used by execution");
    const longTopic = "How Roman Aqueducts Carried Fresh Water Across Long Distances Without Modern Pumps";
    const shortProfileOut = await metadataOptimized.run({
      ownerId: "owner-test",
      runId: "run-test-short-profile",
      channelId: "channel-test",
      keyPrefix: "owner/test/",
      params: { titleProfile: "short_form" },
      store: {
        topic: longTopic,
        plannedTitle,
        channelName: "Inked Histories",
        niche: "history",
        persona: "documentary narrator",
      },
      budgetUsd: 5,
      log: (message: string) => logs.push(message),
    } as never) as { title: string };
    assert.ok(shortProfileOut.title.length <= TITLE_PROFILES.short_form.hardMaxChars,
      "the persisted module knob must control the real deterministic title fallback");
    assert.notEqual(shortProfileOut.title, longTopic,
      "a profile-specific title envelope must not silently fall back to the channel's general profile");

    const sealedMusicTopic = "Rainy Midnight Jazz for Deep Focus with Soft Piano and Vinyl Crackle";
    const autoProfileOut = await metadataOptimized.run({
      ownerId: "owner-test",
      runId: "run-test-auto-profile",
      channelId: "channel-test",
      keyPrefix: "owner/test/",
      params: { titleProfile: "auto" },
      store: {
        topic: sealedMusicTopic,
        plannedTitle,
        channelName: "Inked Histories",
        niche: "history",
        persona: "documentary narrator",
        automaticVideoPlan: { titleProfile: "music_loop" },
      },
      budgetUsd: 5,
      log: (message: string) => logs.push(message),
    } as never) as { title: string };
    assert.ok(autoProfileOut.title.length > TITLE_PROFILES.short_form.hardMaxChars,
      "auto must not be rendered as general or short-form when the sealed plan is music");
    assert.ok(autoProfileOut.title.length <= TITLE_PROFILES.music_loop.hardMaxChars,
      "auto must honor the sealed music profile's hard title envelope");
  } finally {
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }

  assert.doesNotMatch(
    source,
    /plannedTitle\s*\|\|\s*title/,
    "no metadata path may restore the old plannedTitle || title authority",
  );
  assert.match(
    source,
    /METACRAFT TITLE GATE FAILED — no unjudged fallback will be persisted/,
    "a configured provider failure must fail closed instead of entering an unjudged legacy recovery path",
  );
  assert.doesNotMatch(
    source,
    /legacy tournament fallback|legacy tournament\/critique recovery/,
    "the retired unjudged tournament/critique recovery path must not remain executable",
  );
  assert.match(source, /titleDecision: m\.titleDecision/, "the metadata block must persist the judged decision for run-stage review");
  assert.match(source, /resolveTitleProfile/, "metadata must resolve a format-aware title profile before generation");
  assert.match(source, /titleProfile,/, "the resolved title profile must be passed into the title engine");
  assert.match(source, /deterministicTitleFallback\(topic, titleProfile\)/, "no-provider fallback must use the shared profile envelope");
  assert.doesNotMatch(source, /optimalTitleLen\s*\?\?/,
    "niche research must not reintroduce an arbitrary long-title fallback envelope");

  console.log("METADATA TITLE AUTHORITY PASS — fallbacks cannot override evaluated or deterministic titles");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
