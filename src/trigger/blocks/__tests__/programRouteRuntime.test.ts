import assert from "node:assert/strict";

import { createChannelProgramBrief } from "@/engine/channelProgramBrief";
import {
  channelProgramRouteRunSeed,
  channelProgramRouteRunSeedFingerprint,
  parseChannelProgramRouteRunSeed,
  resolveChannelProgramRoute,
} from "@/engine/channelProgramRoute";
import { syntheticScenarioContract } from "@/engine/syntheticScenario";
import { classifyExecutionError, ExecutionError } from "@/engine/executionErrors";
import type { Block, StageContext } from "@/engine/types";
import { freezeChannelInceptionProbeContext } from "@/lib/channelInceptionProbe";
import { createSerializedProgramEpisodeContext } from "@/lib/serializedProgramEpisodeContext";
import {
  serializedProgramEpisodeIdentity,
  serializedProgramEpisodeMemoryKey,
} from "@/lib/serializedProgramEpisode";
import { lofiBlocks, persistTopicAfterRouteValidation } from "../lofiBlocks";
import { narratedBlocks } from "../narratedBlocks";
import { quizPlanningBlocks } from "../quizPlanningBlocks";
import { syntheticScenarioBlocks } from "../syntheticScenarioBlocks";

function brief(input: Readonly<Record<string, unknown>>) {
  return createChannelProgramBrief({
    nicheKey: "educational",
    locale: "en",
    concept: "A clear, original channel program with a repeatable viewer promise.",
    ...input,
  });
}

function runnable(blocks: readonly Block[], id: string): Block["run"] {
  const block = blocks.find((candidate) => candidate.id === id);
  assert.ok(block, `expected ${id} to be registered`);
  return block.run;
}

function stageContext(input: {
  readonly params?: Record<string, unknown>;
  readonly store: Record<string, unknown>;
}): StageContext {
  return {
    ownerId: "owner-program-route-test",
    runId: "run-program-route-test",
    channelId: "channel-program-route-test",
    keyPrefix: "owner/test/channel/program-route/",
    params: input.params ?? {},
    store: input.store,
    budgetUsd: 0,
    log: () => {},
  };
}

const narratedBrief = brief({ family: "narrated_stock" });
const narratedRoute = resolveChannelProgramRoute(narratedBrief);
const narratedSeed = channelProgramRouteRunSeed({
  route: narratedRoute,
  programBrief: narratedBrief,
});
const serializedNarratedBrief = brief({
  family: "narrated_stock",
  serializedProgram: {
    version: "serialized_program/v1",
    seriesTitle: "Seven Days of Better Questions",
    seriesCount: 7,
  },
});
const serializedNarratedRoute = resolveChannelProgramRoute(serializedNarratedBrief);
const serializedNarratedSeed = channelProgramRouteRunSeed({
  route: serializedNarratedRoute,
  programBrief: serializedNarratedBrief,
});
const serializedNarratedIdentity = serializedProgramEpisodeIdentity(serializedNarratedSeed);
if (!serializedNarratedIdentity) throw new Error("serialized route test must derive an episode identity");
const serializedNarratedTopic = "Seven Days of Better Questions — Part 1 of 7: Start with the real question";
const serializedNarratedContext = createSerializedProgramEpisodeContext({
  routeFingerprint: serializedNarratedSeed.routeFingerprint,
  routeRunSeedFingerprint: channelProgramRouteRunSeedFingerprint(serializedNarratedSeed),
  runId: "run-program-route-test",
  seriesIdentity: serializedNarratedIdentity.value,
  seriesTitle: serializedNarratedIdentity.seriesTitle,
  ...(serializedNarratedIdentity.seriesCount === undefined
    ? {}
    : { seriesCount: serializedNarratedIdentity.seriesCount }),
  episodeNumber: 1,
  topic: serializedNarratedTopic,
  topicMemoryKey: serializedProgramEpisodeMemoryKey({
    identity: serializedNarratedIdentity,
    episodeNumber: 1,
    topic: serializedNarratedTopic,
  }),
  continuity: {
    arcSummary: "The opening episode establishes the question the series will keep testing.",
    plotBeats: [{ episode: 1, beat: "The host reframes the first assumption." }],
    unresolvedThreads: ["Which assumption should the next episode test?"],
    entities: [],
  },
});

const topicSelect = runnable(lofiBlocks, "topic_select");
const musicProgramPlan = runnable(lofiBlocks, "music_program_plan");
const scenePlanner = runnable(lofiBlocks, "scene_planner");
const music = runnable(lofiBlocks, "music");
const loopClips = runnable(lofiBlocks, "loop_clips");
const scriptGen = runnable(narratedBlocks, "script_gen");
const qaScript = runnable(narratedBlocks, "qa_script");
const quizTopicSafety = runnable(quizPlanningBlocks, "quiz_topic_safety");
const syntheticScenario = runnable(syntheticScenarioBlocks, "synthetic_scenario");
const scenarioDisclosureGate = runnable(syntheticScenarioBlocks, "scenario_disclosure_gate");

async function musicLoopProgramMustBindBothPaidBranches(): Promise<void> {
  const musicBrief = brief({
    family: "music_loop",
    nicheKey: "lofi",
    concept: "Original late-night instrumental focus sessions with calm seamless visual loops.",
  });
  const musicRoute = resolveChannelProgramRoute(musicBrief);
  const musicSeed = channelProgramRouteRunSeed({ route: musicRoute, programBrief: musicBrief });
  const topic = "Rainy city focus after midnight";
  const planned = await musicProgramPlan(stageContext({
    params: { visualStyle: "lofi", provider: "suno" },
    store: {
      channelProgramRoute: musicSeed,
      topic,
      niche: "rainy late-night focus",
      styleGrammar: "warm cinematic lofi",
    },
  }));
  const sealed = planned.musicProgramPlan as {
    fingerprint: string;
    audio: { direction: string };
    visual: { motionIntent: string };
  };
  assert.match(sealed.fingerprint, /^[a-f0-9]{64}$/iu);
  assert.match(sealed.audio.direction, /Original instrumental program/u);

  const scenes = await scenePlanner(stageContext({
    params: { visualStyle: "lofi" },
    store: {
      channelProgramRoute: musicSeed,
      topic,
      niche: "rainy late-night focus",
      styleGrammar: "warm cinematic lofi",
      musicProgramPlan: planned.musicProgramPlan,
    },
  }));
  assert.equal(scenes.sceneMusicPrompt, sealed.audio.direction);
  assert.equal(scenes.musicProgramMotionIntent, sealed.visual.motionIntent);

  const reused = await music(stageContext({
    store: {
      channelProgramRoute: musicSeed,
      topic,
      musicProgramPlan: planned.musicProgramPlan,
      reuseMusicKey: "owner/test/channel/program-route/reused-music.mp3",
    },
  }));
  assert.equal(reused.musicProvider, "reuse");
  assert.equal(reused.musicKey, "owner/test/channel/program-route/reused-music.mp3");

  await assert.rejects(
    music(stageContext({
      store: {
        channelProgramRoute: musicSeed,
        topic,
        reuseMusicKey: "owner/test/channel/program-route/reused-music.mp3",
      },
    })),
    /Required|expected object|musicProgramPlan/iu,
    "the route-owned music stage must refuse an unsealed program even on the no-provider reuse branch",
  );

  await assert.rejects(
    scenePlanner(stageContext({
      store: {
        channelProgramRoute: musicSeed,
        topic,
        styleGrammar: "warm cinematic lofi",
      },
    })),
    /Required|expected object|musicProgramPlan/iu,
    "the route-owned scene planner must refuse an unsealed music program before any visual render",
  );

  await assert.rejects(
    loopClips(stageContext({
      store: {
        channelProgramRoute: musicSeed,
        topic,
        f1Key: "owner/test/channel/program-route/first-frame.png",
        musicProgramPlan: planned.musicProgramPlan,
      },
    })),
    /requires mastered music before visual generation/iu,
    "the registered route must fail before a Novita worker is admitted when its sealed source track is absent",
  );
}

async function topicFastPathsStayInsideTheSealedRoute(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("serialized Program Route mismatch must fail before any topic-memory/network operation");
  };
  try {
    await assert.rejects(
      topicSelect(stageContext({
        params: { seriesTitle: "Injected Series", seriesCount: 7 },
        store: {
          channelProgramRoute: serializedNarratedSeed,
          plannedTopic: "A planned topic that must not bypass the sealed series contract",
        },
      })),
      /serialized_program\/v1 does not match frozen topic_select params/,
      "a Topic Select fast path must reject a mutable series replacement before it can claim a topic",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0, "a rejected serialized fast path must not reach topic-memory or network state");

  for (const [source, topicStoreKey] of [
    ["planned", "plannedTopic"],
    ["reused", "reuseTopic"],
  ] as const) {
    await assert.rejects(
      topicSelect(stageContext({
        params: {
          seriesTitle: "Seven Days of Better Questions",
          seriesCount: 7,
        },
        store: {
          channelProgramRoute: serializedNarratedSeed,
          [topicStoreKey]: `A ${source} topic that cannot bypass an ordered serialized episode`,
        },
      })),
      /requires a verified serialized_program_episode\/v1 receipt/,
      `an otherwise route-matching ${source} fast path must not bypass atomic serial admission`,
    );
  }

  const planned = await topicSelect(stageContext({
    store: {
      channelProgramRoute: narratedSeed,
      plannedTopic: "How a medieval water clock changed the city’s daily rhythm",
    },
  }));
  assert.equal(
    planned.topic,
    "How a medieval water clock changed the city’s daily rhythm",
    "a route-valid planned topic should remain a no-provider fast path",
  );

  const reused = await topicSelect(stageContext({
    store: {
      channelProgramRoute: narratedSeed,
      reuseTopic: "The forgotten map that redrew an empire’s borders",
    },
  }));
  assert.equal(
    reused.topic,
    "The forgotten map that redrew an empire’s borders",
    "a route-valid render-group reuse should remain a no-provider fast path",
  );

  const fictionalBrief = brief({
    family: "illustrated_explainer",
    programIntent: { kind: "fictional_scenario", profile: "ai_decision" },
  });
  const fictionalRoute = resolveChannelProgramRoute(fictionalBrief);
  const fictionalSeed = channelProgramRouteRunSeed({
    route: fictionalRoute,
    programBrief: fictionalBrief,
  });
  await assert.rejects(
    topicSelect(stageContext({
      store: {
        channelProgramRoute: fictionalSeed,
        plannedTopic: "Today’s market forecast from the fictional city council",
      },
    })),
    /no-real-world-claims contract/,
    "planned topics must be checked against the route before the planner fast path returns",
  );

  let persistedRejectedSeriesTopic = false;
  await assert.rejects(
    persistTopicAfterRouteValidation({
      route: fictionalSeed,
      topic: "Today’s market forecast from the fictional city council",
      source: "series",
      dryRun: false,
      persist: async () => {
        persistedRejectedSeriesTopic = true;
      },
    }),
    /no-real-world-claims contract/,
    "a series topic must be route-checked before it reaches topic memory",
  );
  assert.equal(
    persistedRejectedSeriesTopic,
    false,
    "a route-rejected series topic must not leave durable topic-memory state behind",
  );

  const quizBrief = brief({
    family: "quizyear",
    programIntent: { kind: "certified_quiz", profile: "world_geography" },
  });
  const quizSeed = channelProgramRouteRunSeed({
    route: resolveChannelProgramRoute(quizBrief),
    programBrief: quizBrief,
  });
  await assert.rejects(
    topicSelect(stageContext({
      store: {
        channelProgramRoute: quizSeed,
        plannedTopic: "A superficially valid narrated topic",
      },
    })),
    /owned by a different planner/,
    "QuizYear cannot enter the generic scripted topic path through a planned-topic shortcut",
  );
}

function serializedBusyIsRetryableWithoutProviderFallback(): void {
  const busy = new ExecutionError(
    "topic_select: serialized_program/v1 episode claim is in progress",
    {
      code: "SERIALIZED_EPISODE_BUSY",
      retryable: true,
      retryAfterMs: 100,
      phase: "topic_select",
    },
  );
  assert.equal(
    classifyExecutionError(busy).retryable,
    true,
    "an in-progress serial claim must re-enter the worker retry path rather than be terminal",
  );
}

async function reusedScriptsRetainTheirRouteBinding(): Promise<void> {
  const reuseScript = {
    hook: "A river made an impossible turn.",
    sections: [{ heading: "The turn", narration: "The old map recorded a turn nobody expected." }],
    narrationText: "A river made an impossible turn. The old map recorded a turn nobody expected.",
    estDurationSec: 12,
    programRouteFingerprint: narratedSeed.routeFingerprint,
  };
  const result = await scriptGen(stageContext({
    params: { language: "en" },
    store: {
      channelProgramRoute: narratedSeed,
      topic: "How one river bent an old empire’s trade routes",
      reuseScript,
    },
  }));
  assert.equal(
    (result.script as { programRouteFingerprint?: string }).programRouteFingerprint,
    narratedSeed.routeFingerprint,
    "the translation/reuse fast path must preserve the frozen route fingerprint",
  );

  await assert.rejects(
    scriptGen(stageContext({
      params: { language: "en" },
      store: {
        channelProgramRoute: narratedSeed,
        topic: "How one river bent an old empire’s trade routes",
        reuseScript: { ...reuseScript, programRouteFingerprint: "a".repeat(64) },
      },
    })),
    /reused script does not match the frozen channel program route/,
    "a language sibling must not translate a script from another program route",
  );
}

async function serializedReuseRequiresTheExactEpisodeReceipt(): Promise<void> {
  const reuseScript = {
    hook: "The first answer is not the first question.",
    sections: [{ heading: "Start", narration: "Start with the question beneath the answer." }],
    narrationText: "The first answer is not the first question. Start with the question beneath the answer.",
    estDurationSec: 12,
    programRouteFingerprint: serializedNarratedSeed.routeFingerprint,
  };
  await assert.rejects(
    scriptGen(stageContext({
      params: { language: "en" },
      store: {
        channelProgramRoute: serializedNarratedSeed,
        topic: serializedNarratedTopic,
        serializedProgramEpisodeContext: serializedNarratedContext,
        reuseScript,
      },
    })),
    /does not match the immutable serialized episode context/,
    "same-route script reuse cannot bypass the per-episode continuity receipt",
  );
  await assert.rejects(
    scriptGen(stageContext({
      params: { language: "en" },
      store: {
        channelProgramRoute: serializedNarratedSeed,
        topic: serializedNarratedTopic,
        serializedProgramEpisodeContext: serializedNarratedContext,
        reuseScript: {
          ...reuseScript,
          serializedProgramEpisodeContextFingerprint: "a".repeat(64),
        },
      },
    })),
    /does not match the immutable serialized episode context/,
    "a forged receipt fingerprint cannot reuse another episode's script",
  );
  const exactReuse = {
    ...reuseScript,
    serializedProgramEpisodeContextFingerprint: serializedNarratedContext.fingerprint,
  };
  const reused = await scriptGen(stageContext({
    params: { language: "en" },
    store: {
      channelProgramRoute: serializedNarratedSeed,
      topic: serializedNarratedTopic,
      serializedProgramEpisodeContext: serializedNarratedContext,
      reuseScript: exactReuse,
    },
  }));
  assert.equal(
    (reused.script as { serializedProgramEpisodeContextFingerprint?: string })
      .serializedProgramEpisodeContextFingerprint,
    serializedNarratedContext.fingerprint,
    "a permitted translation/reuse preserves the exact episode receipt provenance",
  );
  await assert.rejects(
    qaScript(stageContext({
      store: {
        channelProgramRoute: serializedNarratedSeed,
        topic: serializedNarratedTopic,
        serializedProgramEpisodeContext: serializedNarratedContext,
        narrationText: reuseScript.narrationText,
        script: reuseScript,
      },
    })),
    /script does not match the immutable serialized episode context/,
    "script QA re-checks episode provenance before any critic call can approve a stale script",
  );
}

async function quizBlocksUseTheRouteOwnedProfile(): Promise<void> {
  const quizBrief = brief({
    family: "quizyear",
    programIntent: { kind: "certified_quiz", profile: "world_geography" },
  });
  const quizRoute = resolveChannelProgramRoute(quizBrief);
  const quizSeed = channelProgramRouteRunSeed({ route: quizRoute, programBrief: quizBrief });
  const quizPlan = {
    version: "quiz-curated-wikidata-planner/v1",
    profileKey: "world_geography",
    topicKey: "landmark_architecture",
    topic: "World Geography Trivia Challenge #1",
    episodeOrdinal: 1,
    memoryKey: "quiz-topic/v1/program-route-test/landmark_architecture/1",
    provenance: {
      registry: "quiz-year-topics/v1",
      sourceLicense: "Wikidata CC0-1.0",
      selection: "least-used curated topic with deterministic tie-break",
      previousEpisodesForTopic: 0,
    },
  };

  const valid = await quizTopicSafety(stageContext({
    params: { quizProfile: "world_geography" },
    store: { channelProgramRoute: quizSeed, quizPlan, topic: quizPlan.topic },
  }));
  assert.equal(valid.sensitiveTopic, false);

  await assert.rejects(
    quizTopicSafety(stageContext({
      params: { quizProfile: "chemistry_challenge" },
      store: { channelProgramRoute: quizSeed, quizPlan, topic: quizPlan.topic },
    })),
    /mutable quizProfile does not match the frozen channel program route profile/,
    "the caller cannot override a QuizYear profile after the route is sealed",
  );

  await assert.rejects(
    quizTopicSafety(stageContext({
      store: { channelProgramRoute: narratedSeed, quizPlan, topic: quizPlan.topic },
    })),
    /does not permit this QuizYear block/,
    "a generic script route cannot impersonate a certified QuizYear planner route",
  );
}

async function syntheticBlocksUseTheRouteOwnedContract(): Promise<void> {
  const fictionalBrief = brief({
    family: "illustrated_explainer",
    programIntent: { kind: "fictional_scenario", profile: "ai_decision" },
  });
  const fictionalRoute = resolveChannelProgramRoute(fictionalBrief);
  const fictionalSeed = channelProgramRouteRunSeed({
    route: fictionalRoute,
    programBrief: fictionalBrief,
  });
  const generated = await syntheticScenario(stageContext({
    store: {
      channelProgramRoute: fictionalSeed,
      topic: "A fictional city decides how to allocate its emergency water supply",
    },
  }));
  assert.equal(
    (generated.syntheticScenario as { profile?: string }).profile,
    "ai_decision",
    "a fictional route must derive its scenario profile from the sealed seed, not params",
  );

  const wrongScenario = syntheticScenarioContract("ai_town");
  const acceptedDisclosure = await scenarioDisclosureGate(stageContext({
    store: {
      channelProgramRoute: fictionalSeed,
      syntheticScenario: syntheticScenarioContract("ai_decision"),
      narrationText:
        "Fictional AI Scenario. These illustrative assumptions are not a real simulation or a real-world result.",
    },
  }));
  assert.equal(
    (acceptedDisclosure.syntheticScenarioDisclosure as { openingVerified?: boolean }).openingVerified,
    true,
    "a route-compliant disclosure belongs in the first spoken words",
  );

  const delayedDisclosure = [
    ...Array.from({ length: 40 }, (_value, index) => `word${index + 1}`),
    "Fictional AI Scenario. These illustrative assumptions are not a real simulation.",
  ].join(" ");
  await assert.rejects(
    scenarioDisclosureGate(stageContext({
      store: {
        channelProgramRoute: fictionalSeed,
        syntheticScenario: syntheticScenarioContract("ai_decision"),
        narrationText: delayedDisclosure,
      },
    })),
    /first 40 spoken words/,
    "a disclosure after the first 40 audible words cannot pass the scenario gate",
  );

  await assert.rejects(
    syntheticScenario(stageContext({
      params: { ...wrongScenario },
      store: {
        channelProgramRoute: fictionalSeed,
        topic: "A fictional city decides how to allocate its emergency water supply",
      },
    })),
    /mutable scenario params do not match the frozen channel program route/,
  );
  await assert.rejects(
    scenarioDisclosureGate(stageContext({
      store: {
        channelProgramRoute: fictionalSeed,
        syntheticScenario: wrongScenario,
        narrationText: "Fictional AI Scenario. These assumptions are illustrative only.",
      },
    })),
    /scenario contract does not match the frozen channel program route/,
    "the disclosure gate must reject a synthetic contract swapped after route admission",
  );
}

function probeSeedIsFrozenFromTheSameRoute(): void {
  const probe = freezeChannelInceptionProbeContext({
    ownerId: "owner-program-route-test",
    family: "narrated_stock",
    channel: {
      slug: "program-route-probe",
      name: "Program Route Probe",
      budget: 5,
      identity: {
        programBrief: narratedBrief,
        programRoute: narratedRoute,
        topicPool: [],
        styleGrammar: "measured",
        palette: [],
        persona: "historian",
        niche: "educational history",
      },
      schedule: { madeForKids: false },
    },
  });
  assert.equal(
    parseChannelProgramRouteRunSeed(probe.seedStore.channelProgramRoute).routeFingerprint,
    narratedSeed.routeFingerprint,
    "the probe must carry the same frozen route seed as a normal invocation",
  );

  assert.throws(
    () => freezeChannelInceptionProbeContext({
      ownerId: "owner-program-route-test",
      family: "narrated_stock",
      channel: {
        slug: "missing-route-probe",
        name: "Missing Route Probe",
        budget: 5,
        identity: {
          programBrief: narratedBrief,
          topicPool: [],
          styleGrammar: "measured",
          palette: [],
          persona: "historian",
          niche: "educational history",
        },
        schedule: { madeForKids: false },
      },
    }),
    /requires a sealed program route/,
    "a fresh probe cannot silently omit its route seed",
  );
}

async function main(): Promise<void> {
  await musicLoopProgramMustBindBothPaidBranches();
  await topicFastPathsStayInsideTheSealedRoute();
  serializedBusyIsRetryableWithoutProviderFallback();
  await reusedScriptsRetainTheirRouteBinding();
  await serializedReuseRequiresTheExactEpisodeReceipt();
  await quizBlocksUseTheRouteOwnedProfile();
  await syntheticBlocksUseTheRouteOwnedContract();
  probeSeedIsFrozenFromTheSameRoute();
  console.log("program route runtime fast-path tests passed");
}

void main();
