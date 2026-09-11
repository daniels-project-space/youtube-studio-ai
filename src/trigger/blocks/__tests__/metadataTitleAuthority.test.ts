import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  console.log("METADATA TITLE AUTHORITY PASS — fallbacks cannot override evaluated or deterministic titles");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
