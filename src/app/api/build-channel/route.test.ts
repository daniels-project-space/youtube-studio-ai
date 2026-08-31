import assert from "node:assert/strict";

import { createChannelProgramBrief, type ChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelBuildIntentFingerprint } from "@/lib/channelBuildRequestKey";
import { POST } from "./route";

const INTERNAL_TOKEN = "studio-test-service-token-that-is-long-enough";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function designFor(brief: ChannelProgramBrief): Record<string, unknown> {
  return {
    family: brief.family,
    nicheKey: brief.nicheKey,
    ...(brief.subcategory ? { subcategory: brief.subcategory } : {}),
    locale: brief.locale,
    concept: brief.concept,
    programBrief: brief,
  };
}

function requestKey(design: Record<string, unknown>): string {
  return `00000000-0000-4000-8000-000000000000_${channelBuildIntentFingerprint(design)}`;
}

function request(body: unknown): Request {
  return new Request("https://studio.test/api/build-channel", {
    method: "POST",
    headers: {
      authorization: `Bearer ${INTERNAL_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function main() {
  const originalToken = process.env.STUDIO_INTERNAL_API_TOKEN;
  const originalTriggerKey = process.env.TRIGGER_SECRET_KEY;
  process.env.STUDIO_INTERNAL_API_TOKEN = INTERNAL_TOKEN;
  process.env.TRIGGER_SECRET_KEY = "trigger-test-key";

  try {
    const brief = createChannelProgramBrief({
      family: "whiteboard",
      nicheKey: "educational",
      locale: "en",
      concept: "Explain a hard science mechanism with a causal whiteboard story.",
    });
    const design = designFor(brief);

    const factualWhiteboard = await POST(request({
      requestKey: requestKey(design),
      design,
    }));
    assert.equal(
      factualWhiteboard.status,
      409,
      "factual whiteboard claims must stop at the creator boundary before Trigger or provider work",
    );
    const factualWhiteboardBody = await factualWhiteboard.json() as {
      error: string;
      sourceRequirements?: unknown;
    };
    assert.match(factualWhiteboardBody.error, /source\/module evidence/);
    assert.deepEqual(factualWhiteboardBody.sourceRequirements, [
      "reviewed factual evidence pack",
      "source-bound claim ledger",
    ]);

    const missingNestedBriefDesign = { ...design };
    delete missingNestedBriefDesign.programBrief;
    const missingNestedBrief = await POST(request({
      requestKey: requestKey(missingNestedBriefDesign),
      design: missingNestedBriefDesign,
      programBrief: brief,
    }));
    assert.equal(missingNestedBrief.status, 400, "the request key must bind the design copy of programBrief");

    const mismatchedConcept = {
      ...design,
      concept: "Explain a different hard science mechanism with a causal whiteboard story.",
    };
    const mismatch = await POST(request({
      requestKey: requestKey(mismatchedConcept),
      design: mismatchedConcept,
    }));
    assert.equal(mismatch.status, 400);
    assert.match((await mismatch.json() as { error: string }).error, /concept.*programBrief/);

    const differentBrief = createChannelProgramBrief({
      ...brief,
      concept: "Explain why the same science mechanism behaves differently in orbit.",
    });
    const unsignedRootBrief = await POST(request({
      requestKey: requestKey(design),
      design,
      programBrief: differentBrief,
    }));
    assert.equal(unsignedRootBrief.status, 400);
    assert.match((await unsignedRootBrief.json() as { error: string }).error, /exactly match/);

    const unhostedBrief = createChannelProgramBrief({
      family: "whiteboard",
      nicheKey: "educational",
      locale: "en",
      concept: "Reconstruct a factual cold case with source-led visual evidence.",
    });
    const unhostedDesign = designFor(unhostedBrief);
    // Deliberately omit the optional root copy. The route must use the signed
    // nested brief, reach capability admission, and stop without any spend.
    const rootOmittedUsesNestedBrief = await POST(request({
      requestKey: requestKey(unhostedDesign),
      design: unhostedDesign,
    }));
    assert.equal(rootOmittedUsesNestedBrief.status, 409);
    const rootOmittedBody = await rootOmittedUsesNestedBrief.json() as {
      error: string;
      reviewHrefs?: unknown;
    };
    assert.match(rootOmittedBody.error, /private review/);
    assert.deepEqual(
      rootOmittedBody.reviewHrefs,
      ["/casefile"],
      "the blocked route must provide an explicit private-review desk",
    );

    // The creator may only carry audience/topic signals inside the canonical
    // nested brief. The authenticated route must still re-evaluate those
    // signals before Trigger import/dispatch, so a neutral-looking concept
    // cannot evade child-content private review by choosing a generic family.
    const audienceBoundChildrenBrief = createChannelProgramBrief({
      family: "narrated_stock",
      nicheKey: "educational",
      locale: "en",
      concept: "Original animated bedtime stories",
      audience: "Preschool children ages 3 to 5",
      sampleTopics: ["A gentle toddler learning adventure"],
    });
    const audienceBoundChildrenDesign = designFor(audienceBoundChildrenBrief);
    const audienceBoundChildren = await POST(request({
      requestKey: requestKey(audienceBoundChildrenDesign),
      design: audienceBoundChildrenDesign,
    }));
    assert.equal(audienceBoundChildren.status, 409);
    assert.match((await audienceBoundChildren.json() as { error: string }).error, /private review/);

    const staleBrief = { ...brief, catalogFingerprint: "0".repeat(64) };
    const staleDesign = { ...design, programBrief: staleBrief };
    const stale = await POST(request({
      requestKey: requestKey(staleDesign),
      design: staleDesign,
    }));
    assert.equal(stale.status, 400);
    assert.match((await stale.json() as { error: string }).error, /noncanonical|catalogFingerprint/);
  } finally {
    restoreEnv("STUDIO_INTERNAL_API_TOKEN", originalToken);
    restoreEnv("TRIGGER_SECRET_KEY", originalTriggerKey);
  }

  console.log("build-channel program brief boundary tests passed");
}

void main();
