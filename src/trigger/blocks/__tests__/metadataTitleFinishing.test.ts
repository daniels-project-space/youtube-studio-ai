import assert from "node:assert/strict";
import { finishMetadata } from "../intelligenceBlocks";

function context() {
  const logs: string[] = [];
  return {
    ctx: { params: {}, store: {}, log: (message: string) => logs.push(message) } as never,
    logs,
  };
}

// Channel-name cleanup is a mechanical normalization step. It must still pass
// the same source-aware title gate before the value is persisted.
{
  const { ctx } = context();
  const result = finishMetadata(ctx, {
    title: "Inked Histories: Chernobyl Failed One Safety Test",
    description: "d",
    tags: ["history"],
    channelName: "Inked Histories",
    nicheIntel: null,
    grounding: "Chernobyl failed one safety test and the ignored warning changed the outcome.",
    titleProfile: "searchable_long",
  });
  assert.equal(result.title, "Chernobyl Failed One Safety Test");
}

// Normalization must retain the opening promise boundary too: a title can be
// grounded somewhere in the script yet still promise a subject the first beat
// never starts.
{
  const { ctx, logs } = context();
  assert.throws(
    () => finishMetadata(ctx, {
      title: "Inked Histories: Chernobyl Failed One Safety Test",
      description: "d",
      tags: ["history"],
      channelName: "Inked Histories",
      nicheIntel: null,
      grounding: "Chernobyl failed one safety test. Today we examine a quiet village archive.",
      opening: "Today we examine a quiet village archive and the letter it preserved.",
      titleProfile: "searchable_long",
    }),
    /normalized title failed title gate.*opening promise mismatch/,
  );
  assert.ok(logs.some((message) => /normalized title failed the shared title gate/.test(message)));
}

// A stale/legacy path may contain a title claim that the current source packet
// cannot support. The post-processing boundary must fail closed instead of
// silently shipping that normalized title.
{
  const { ctx, logs } = context();
  assert.throws(
    () => finishMetadata(ctx, {
      title: "Inked Histories: Chernobyl Failed 47 Safety Tests",
      description: "d",
      tags: ["history"],
      channelName: "Inked Histories",
      nicheIntel: null,
      grounding: "Chernobyl failed one safety test and the ignored warning changed the outcome.",
      titleProfile: "searchable_long",
    }),
    /normalized title failed title gate.*ungrounded number "47"/,
  );
  assert.ok(logs.some((message) => /normalized title failed the shared title gate/.test(message)));
}

console.log("METADATA TITLE FINISHING PASS — normalized titles are re-linted before persistence");
