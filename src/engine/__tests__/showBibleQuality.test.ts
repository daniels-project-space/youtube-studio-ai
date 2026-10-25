import assert from "node:assert/strict";

import { synthShowBible } from "@/engine/creative/showBible";

const worksInSpace = [
  "Open with the irreversible choice before explaining the engineering context",
  "Use primary documents to reveal which warning reached decision-makers",
  "Track one human consequence alongside the physical failure sequence",
  "Distinguish verified findings from later speculation in the inquiry",
  "End by showing which safeguards changed after the disaster",
];
const avoidInSpace = [
  "Do not announce a cause before the evidence supports it",
  "Avoid treating every accident as a single-person morality tale",
  "Do not bury the affected community beneath engineering jargon",
  "Avoid reenactments that imply access to undocumented private thoughts",
  "Do not frame later standards as if investigators knew them then",
];

function bibleResponse(complete: boolean, model: string): Response {
  return Response.json({
    id: `show-bible-${complete ? "complete" : "incomplete"}`,
    model,
    choices: [{ message: { content: JSON.stringify({
      positioning: "Forensic histories of infrastructure failures and the people affected by them.",
      vibe: "Measured, humane, and evidence-led.",
      iconicMotif: "An annotated engineering drawing with a red evidence mark",
      worksInSpace: complete ? worksInSpace : [],
      avoidInSpace: complete ? avoidInSpace : [],
      activeCrew: ["critic"],
      criticDoctrine: complete
        ? "Test each claim against the channel promise and expose uncertainty before approving a cut."
        : undefined,
    }) } }],
    usage: { prompt_tokens: 25, completion_tokens: 60, total_tokens: 85 },
  });
}

function input(name: string) {
  return {
    family: "narrated_stock" as const,
    name,
    niche: "forgotten infrastructure history",
    persona: "Forensic and humane",
    styleGrammar: "archival diagrams, restrained red annotations",
    now: 1_800_000_000_000,
  };
}

async function main(): Promise<void> {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.OPENROUTER_API_KEY = "show-bible-contract-test-key";
    const repairRequests: RequestInit[] = [];
    globalThis.fetch = async (_input, init) => {
      repairRequests.push(init ?? {});
      const request = JSON.parse(String(init?.body));
      return bibleResponse(repairRequests.length > 1, request.model);
    };

    const repaired = await synthShowBible(input("Bridge Records"));
    assert.equal(repaired.worksInSpace.length, 5);
    assert.equal(repaired.avoidInSpace.length, 5);
    assert.ok(repaired.criticDoctrine, "each active role must receive its channel-specific doctrine");
    assert.equal(repairRequests.length, 2, "empty critical lists get one bounded repair");
    const repairRequest = JSON.parse(String(repairRequests[1]?.body));
    assert.match(repairRequest.messages.at(-1)?.content ?? "", /5 distinct niche-specific patterns/);
    assert.match(repairRequest.messages.at(-1)?.content ?? "", /criticDoctrine is required for active crew role critic/);

    let healthyCalls = 0;
    globalThis.fetch = async (_input, init) => {
      healthyCalls++;
      const request = JSON.parse(String(init?.body));
      return bibleResponse(true, request.model);
    };
    const healthy = await synthShowBible(input("Bridge Inquiry"));
    assert.equal(healthy.worksInSpace.length, 5);
    assert.equal(healthyCalls, 1, "qualified output keeps the normal path to one request");

    let failedRepairCalls = 0;
    globalThis.fetch = async (_input, init) => {
      failedRepairCalls++;
      const request = JSON.parse(String(init?.body));
      return bibleResponse(false, request.model);
    };
    await assert.rejects(
      () => synthShowBible(input("Incomplete Bridge Notes")),
      /Show Bible quality contract failed after repair/,
      "a second incomplete result must not become a successful fallback",
    );
    assert.equal(failedRepairCalls, 2);

    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(
      () => synthShowBible(input("Offline Bridge Notes")),
      /creative-model key required for a qualified Bible/,
      "offline fallback text must not be reported as a qualified Show Bible",
    );
    console.log("SHOW BIBLE QUALITY PASS — pattern floors, one repair, healthy one-call path, and fail-closed output verified");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
}

void main();
