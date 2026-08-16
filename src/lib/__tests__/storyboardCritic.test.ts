import assert from "node:assert/strict";

import {
  assertStoryboardCritiqueApproved,
  critiqueStoryboardText,
  unavailableStoryboardCriticVerdict,
} from "@/lib/storyboardCritic";

async function main(): Promise<void> {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  const previousModel = process.env.ANTHROPIC_CREATIVE_PRO_MODEL;
  const originalFetch = global.fetch;
  try {
    let calls = 0;
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.ANTHROPIC_CREATIVE_PRO_MODEL = "claude-storyboard-test";
    global.fetch = async (_input, init) => {
      calls += 1;
      const request = JSON.parse(String(init?.body));
      assert.equal(request.model, "claude-storyboard-test");
      assert.match(request.system, /untrusted content/);
      assert.match(request.messages[0].content, /<CANDIDATE_STORYBOARD>/);
      assert.match(request.messages[0].content, /CHANNEL CRITIQUE GROUNDING/);
      return new Response(JSON.stringify({
        id: "msg-storyboard-test",
        content: [{ type: "text", text: '{"score":1.2,"pass":false,"issues":["Panel 2: show the causal change."]}' }],
        usage: { input_tokens: 12, output_tokens: 8 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const verdict = await critiqueStoryboardText({
      label: "test storyboard",
      topic: "a test topic",
      candidate: "1. A concrete scene",
      rubric: "Judge only the causal sequence.",
      costWarning: "Rendering costs money.",
      channel: { channelName: "Test Channel", laneEmphasis: ["causal clarity"] },
    });
    assert.deepEqual(verdict, {
      score: 1,
      pass: false,
      issues: ["Panel 2: show the causal change."],
    });
    assert.equal(calls, 1);

    global.fetch = async () => new Response(JSON.stringify({
      content: [{ type: "text", text: '{"score":"bad","pass":true,"issues":[]}' }],
    }), { status: 200, headers: { "content-type": "application/json" } });
    assert.equal(
      await critiqueStoryboardText({
        label: "bad verdict",
        topic: "topic",
        candidate: "candidate",
        rubric: "rubric",
        costWarning: "warning",
      }),
      null,
      "malformed critic output must not be turned into an approving verdict",
    );

    delete process.env.ANTHROPIC_API_KEY;
    let unexpectedCall = false;
    global.fetch = async () => {
      unexpectedCall = true;
      throw new Error("missing permitted key must not call a provider");
    };
    assert.equal(
      await critiqueStoryboardText({
        label: "no key",
        topic: "topic",
        candidate: "candidate",
        rubric: "rubric",
        costWarning: "warning",
      }),
      null,
    );
    assert.equal(unexpectedCall, false);

    assert.deepEqual(unavailableStoryboardCriticVerdict(["Panel 1: add a causal transition."]), {
      score: 0,
      pass: false,
      issues: [
        "Claude storyboard critic unavailable or returned an invalid verdict; paid rendering is blocked.",
        "Panel 1: add a causal transition.",
      ],
    });
    assert.throws(
      () => assertStoryboardCritiqueApproved({
        label: "test storyboard",
        accepted: false,
        score: 0,
        issues: ["Claude storyboard critic unavailable or returned an invalid verdict; paid rendering is blocked."],
      }),
      /storyboard approval is required before paid rendering/,
    );
    assert.doesNotThrow(() => assertStoryboardCritiqueApproved({
      label: "approved storyboard",
      accepted: true,
      score: 0.95,
      issues: [],
    }));
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.ANTHROPIC_CREATIVE_PRO_MODEL;
    else process.env.ANTHROPIC_CREATIVE_PRO_MODEL = previousModel;
  }
  console.log("Storyboard critic boundary tests passed");
}

void main();
