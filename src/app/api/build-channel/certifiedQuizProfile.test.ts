import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import { channelBuildIntentFingerprint } from "@/lib/channelBuildRequestKey";
import { POST } from "./route";

const INTERNAL_TOKEN = "studio-certified-quiz-profile-test-token";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
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

async function main(): Promise<void> {
  const originalToken = process.env.STUDIO_INTERNAL_API_TOKEN;
  const originalTriggerKey = process.env.TRIGGER_SECRET_KEY;
  process.env.STUDIO_INTERNAL_API_TOKEN = INTERNAL_TOKEN;
  process.env.TRIGGER_SECRET_KEY = "trigger-certified-quiz-profile-test-key";

  try {
    const programBrief = createChannelProgramBrief({
      family: "quizyear",
      nicheKey: "educational",
      locale: "en",
      concept: "A deterministic adult trivia challenge with sourced facts and a timed reveal.",
    });
    const baseDesign: Record<string, unknown> = {
      family: programBrief.family,
      nicheKey: programBrief.nicheKey,
      locale: programBrief.locale,
      concept: programBrief.concept,
      programBrief,
    };

    const staleCategoryDesign = {
      ...baseDesign,
      quizProfile: "world_geography",
      paramOverrides: { quiz_year: { categories: "general_knowledge" } },
    };
    const staleCategoryResponse = await POST(request({
      design: staleCategoryDesign,
      requestKey: `00000000-0000-4000-8000-000000000000_${channelBuildIntentFingerprint(staleCategoryDesign)}`,
    }));
    assert.equal(staleCategoryResponse.status, 400);
    assert.match(
      (await staleCategoryResponse.json() as { error: string }).error,
      /selected only through a certified quiz profile/,
    );

    const unknownProfileDesign = { ...baseDesign, quizProfile: "unreviewed_trivia" };
    const unknownProfileResponse = await POST(request({
      design: unknownProfileDesign,
      requestKey: `00000000-0000-4000-8000-000000000000_${channelBuildIntentFingerprint(unknownProfileDesign)}`,
    }));
    assert.equal(unknownProfileResponse.status, 400);
    assert.match(
      (await unknownProfileResponse.json() as { error: string }).error,
      /unknown certified QuizYear profile/,
    );
  } finally {
    restoreEnv("STUDIO_INTERNAL_API_TOKEN", originalToken);
    restoreEnv("TRIGGER_SECRET_KEY", originalTriggerKey);
  }

  console.log("build-channel certified QuizYear profile boundary test passed");
}

void main();
