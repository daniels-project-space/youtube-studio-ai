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
      programIntent: { kind: "certified_quiz", profile: "world_geography" },
    });
    const baseDesign: Record<string, unknown> = {
      family: programBrief.family,
      nicheKey: programBrief.nicheKey,
      locale: programBrief.locale,
      concept: programBrief.concept,
      programBrief,
    };

    const forgedRouteDesign = { ...baseDesign, programRoute: { routeKey: "quizyear/certified-profile/v1" } };
    const forgedRouteResponse = await POST(request({
      design: forgedRouteDesign,
      requestKey: `00000000-0000-4000-8000-000000000000_${channelBuildIntentFingerprint(forgedRouteDesign)}`,
    }));
    assert.equal(forgedRouteResponse.status, 400);
    assert.match(
      (await forgedRouteResponse.json() as { error: string }).error,
      /server-derived from the canonical programBrief/,
    );

    const forgedDiagnosisDesign = {
      ...baseDesign,
      creatorIntentDiagnosis: { claimMode: "fictional_disclosed" },
    };
    const forgedDiagnosisResponse = await POST(request({
      design: forgedDiagnosisDesign,
      requestKey: `00000000-0000-4000-8000-000000000000_${channelBuildIntentFingerprint(forgedDiagnosisDesign)}`,
    }));
    assert.equal(forgedDiagnosisResponse.status, 400);
    assert.match(
      (await forgedDiagnosisResponse.json() as { error: string }).error,
      /creator intent diagnoses are server-derived/,
      "browser input cannot choose or rewrite the sealed creator-intent diagnosis",
    );

    const serializedBrief = createChannelProgramBrief({
      family: "narrated_stock",
      nicheKey: "educational",
      locale: "en",
      concept: "A recurring educational series with one clear original lesson in every episode.",
      serializedProgram: {
        version: "serialized_program/v1",
        seriesTitle: "Seven Days of Better Questions",
        seriesCount: 7,
      },
    });
    const rawSeriesDesign = {
      family: serializedBrief.family,
      nicheKey: serializedBrief.nicheKey,
      locale: serializedBrief.locale,
      concept: serializedBrief.concept,
      programBrief: serializedBrief,
      seriesTitle: "Browser-supplied replacement",
      seriesCount: 99,
    };
    const rawSeriesResponse = await POST(request({
      design: rawSeriesDesign,
      requestKey: `00000000-0000-4000-8000-000000000000_${channelBuildIntentFingerprint(rawSeriesDesign)}`,
    }));
    assert.equal(rawSeriesResponse.status, 400);
    assert.match(
      (await rawSeriesResponse.json() as { error: string }).error,
      /must be supplied only through programBrief\.serializedProgram/,
      "browser payload cannot inject a series after the canonical ProgramBrief is sealed",
    );

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

    const sportsAliasBrief = createChannelProgramBrief({
      ...programBrief,
      programIntent: { kind: "certified_quiz", profile: "sports_championship_timeline" },
    });
    const sportsAliasDesign = {
      ...baseDesign,
      programBrief: sportsAliasBrief,
    };
    const sportsAliasResponse = await POST(request({
      design: sportsAliasDesign,
      requestKey: `00000000-0000-4000-8000-000000000000_${channelBuildIntentFingerprint(sportsAliasDesign)}`,
    }));
    assert.equal(sportsAliasResponse.status, 409);
    assert.match(
      (await sportsAliasResponse.json() as { error: string }).error,
      /requires the dedicated sports_championship_timeline program intent/,
    );
  } finally {
    restoreEnv("STUDIO_INTERNAL_API_TOKEN", originalToken);
    restoreEnv("TRIGGER_SECRET_KEY", originalTriggerKey);
  }

  console.log("build-channel certified QuizYear profile boundary test passed");
}

void main();
