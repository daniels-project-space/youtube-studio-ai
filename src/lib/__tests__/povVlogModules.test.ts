/**
 * Contract tests for the POV character-vlog capability's five modules.
 *
 * The tests that matter most here are the NEGATIVE ones. Every module in this
 * lane exists to refuse something — a re-authored host, a re-framed shot, a
 * monologue wearing a conversation's clothes, a documentary sentence, a wrong
 * date — and a module that only proves it works on good input has not proven
 * the thing it was built for.
 *
 * The single most important assertion in this file is
 * `cinematicCompositionIsByteIdentical()`: the composition profile changed a
 * function every existing generated-video channel runs through, and the claim
 * "no existing family's output changed" is worth exactly as much as the test
 * that checks it.
 */
import assert from "node:assert/strict";

import {
  applyChannelCharacterToPrompt,
  assertChannelCharacterApplied,
  channelCharacterDefects,
  channelCharacterLoras,
  characterPromptBlock,
  makeChannelCharacter,
  parseChannelCharacter,
  resolveChannelCharacter,
} from "@/lib/channelCharacter";
import { makeImportedCharacterLora, LORA_SURFACES, characterLoraRefs } from "@/lib/characterLora";
import {
  compositionNegative,
  DEFAULT_SHOT_COMPOSITION,
  SHOT_COMPOSITION_PROFILES,
  shotCompositionProfile,
} from "@/lib/shotComposition";
import { ShotPlanSchema, planStorySpine } from "@/engine/storySpine";
import {
  assertDialogueScene,
  dialogueSceneDefects,
  dialogueSceneText,
  normalizeDialogueScene,
  type DialogueBeat,
} from "@/lib/dialogueScene";
import {
  normalizePovEpisode,
  povEpisodeDefects,
  povEpisodeNarration,
  povEpisodePrompt,
  POV_VLOG_REGISTER,
} from "@/lib/povVlogScript";
import {
  assertFactCheckIntegrity,
  checkFactClaims,
  usableFactClaims,
  type FactClaim,
} from "@/lib/historicalFactCheck";

/* ── module 1: persistent character identity ─────────────────────────────── */

const CHARACTER = makeChannelCharacter({
  name: "Chloe",
  appearance:
    "a woman in her late twenties with shoulder-length dark curly hair, freckles, and a small gap in her front teeth",
  signatureItems: ["mustard-yellow raincoat", "canvas satchel"],
  reason: "recurring host of every episode on this channel",
  now: 1_700_000_000_000,
});

function characterIsReadNotReauthored(): void {
  const identity = { channelCharacter: CHARACTER };
  // The defining property: the same answer every time, with no episode input
  // available that could vary it.
  const first = resolveChannelCharacter(identity);
  const second = resolveChannelCharacter(identity);
  assert.deepEqual(first, second, "resolving a locked character twice must return the same identity");
  assert.equal(first.locked, true);
  assert.equal(first.source, "locked");
  assert.equal(first.character?.name, "Chloe");
  assert.equal(first.promptOnly, true, "a character with no LoRA must be reported as prompt-only, not as fully locked");

  // A channel with no character is the normal case, not an error.
  const none = resolveChannelCharacter({});
  assert.equal(none.locked, false);
  assert.equal(characterPromptBlock(none), "", "no character must produce an empty prompt block, not a placeholder");

  // A malformed lock DEGRADES rather than throwing — the same stance voiceLock takes.
  assert.equal(parseChannelCharacter({ version: "channel-character/v9" }), undefined);
  assert.equal(resolveChannelCharacter({ channelCharacter: { name: "X" } }).locked, false);
}

function characterIntegrityRefusesDrift(): void {
  // An appearance line short enough to be re-interpreted differently each render
  // is not a lock.
  assert.throws(
    () => makeChannelCharacter({ name: "Chloe", appearance: "a woman", reason: "host" }),
    /too thin/,
  );
  // ...and one long enough to be a prompt is not a lock either.
  assert.throws(
    () => makeChannelCharacter({ name: "Chloe", appearance: "x".repeat(401), reason: "host" }),
    /exceeds 400 characters/,
  );
  assert.ok(
    channelCharacterDefects({ ...CHARACTER, reason: "" }).some((defect) => /reason/.test(defect)),
    "an unexplained lock must be reported as a defect",
  );

  const resolved = resolveChannelCharacter({ channelCharacter: CHARACTER });
  const prompt = applyChannelCharacterToPrompt("A muddy street at dawn.", resolved);
  assert.ok(prompt.includes(CHARACTER.appearance), "the frozen appearance must reach the prompt verbatim");
  assert.doesNotThrow(() => assertChannelCharacterApplied({ resolved, prompt }));

  // THE ANTI-DRIFT ASSERT: a prompt built from a re-authored description is
  // refused even though it reads perfectly well.
  assert.throws(
    () =>
      assertChannelCharacterApplied({
        resolved,
        prompt: "Chloe, a curly-haired woman in a yellow coat, stands in a muddy street.",
      }),
    /frozen appearance .* is not present verbatim/,
  );
}

function loraTriggerWordsMustReachThePrompt(): void {
  const lora = makeImportedCharacterLora({
    novitaLoraPath: "chloe_v1.safetensors",
    triggerWords: ["chlo3person"],
    character: "Chloe",
    now: 1_700_000_000_000,
  });
  const resolved = resolveChannelCharacter({ channelCharacter: CHARACTER, characterLora: lora });
  assert.equal(resolved.promptOnly, false, "a channel with a LoRA is not prompt-only");

  const prompt = applyChannelCharacterToPrompt("A muddy street at dawn.", resolved);
  assert.ok(prompt.includes("chlo3person"), "the trigger word must be spliced in");
  assert.doesNotThrow(() => assertChannelCharacterApplied({ resolved, prompt }));
  // Idempotent: applying twice must not stack the trigger words.
  assert.equal(applyChannelCharacterToPrompt(prompt, resolved), prompt);

  // A loaded-but-ignored adapter looks identical to a bad adapter, so it fails.
  assert.throws(
    () =>
      assertChannelCharacterApplied({
        resolved,
        prompt: `${characterPromptBlock(resolved)}\n\nA muddy street at dawn.`,
      }),
    /trigger word\(s\) chlo3person never reached the prompt/,
  );
}

/**
 * THE ARCHITECTURAL CONCLUSION, pinned as a test rather than left in prose.
 *
 * Cross-episode identity needs a LoRA on the KEYFRAME surface only. Both
 * private-bridge surfaces refuse (they have no `loras` field), and the hosted
 * Z-Image LoRA endpoint accepts — which is exactly the shape of the answer:
 * put the adapter on the still, let the existing i2v chain animate it.
 */
function loraSurfaceCapabilityIsExplicit(): void {
  const lora = makeImportedCharacterLora({
    novitaLoraPath: "chloe_v1.safetensors",
    now: 1_700_000_000_000,
  });
  const resolved = resolveChannelCharacter({ channelCharacter: CHARACTER, characterLora: lora });

  assert.deepEqual(
    channelCharacterLoras(resolved, "z_image_turbo_lora"),
    [{ path: "chloe_v1.safetensors", scale: 0.8 }],
    "the hosted Z-Image LoRA endpoint documents a `loras` array and must receive one",
  );
  for (const surface of ["novita_bridge_image", "novita_bridge_i2v"] as const) {
    assert.equal(LORA_SURFACES[surface].supportsLoras, false);
    assert.throws(
      () => channelCharacterLoras(resolved, surface),
      /cannot be applied/,
      `${surface} has no lora field; handing it one silently would drift the character with no error`,
    );
  }
  // A channel with no LoRA gets [] rather than a throw on an unsupported
  // surface: "no character" is the pre-existing behaviour of every channel.
  assert.deepEqual(characterLoraRefs({ lora: undefined, surface: "novita_bridge_i2v" }), []);
}

/* ── module 2: POV shot-composition profile ──────────────────────────────── */

const SENTENCES = [
  { text: "I have just arrived and it smells extraordinary.", start: 0, end: 6 },
  { text: "There is a pig in the road and it has opinions.", start: 6, end: 12 },
];

/**
 * The regression that protects every pre-existing generated-video channel.
 * These are the EXACT strings `planStorySpine` produced before the composition
 * profile existed, written out as literals rather than recomputed — a
 * recomputed expectation would move with the code it is checking.
 */
function cinematicCompositionIsByteIdentical(): void {
  assert.equal(DEFAULT_SHOT_COMPOSITION, "cinematic_third_person");
  const spine = planStorySpine({
    topic: "anything",
    narrationDurationSec: 12,
    sentenceTimings: SENTENCES,
  });
  assert.equal(
    spine.dpVisualSpecs[0].keyframePrompt,
    "Literal story moment: I have just arrived and it smells extraordinary.. " +
      "Shot scale: establishing; lens: 35mm natural. " +
      "No text, letters, captions, logos, or watermarks in the image.",
  );
  assert.equal(
    spine.dpVisualSpecs[0].motionPrompt,
    "Continue the literal action implied by: I have just arrived and it smells extraordinary.. " +
      "Camera performs a restrained dolly push; preserve identity, setting, wardrobe, props, and lighting through the final frame.",
  );
  assert.equal(spine.shotList[0].cameraMove, "dolly_push");
  assert.equal(spine.shotList[0].shotScale, "establishing");
  assert.equal(spine.shotList[0].lens, "35mm natural");
  assert.equal(spine.shotList[0].negative, "");
}

function povCompositionChangesFramingNotRenderer(): void {
  const resolved = resolveChannelCharacter({ channelCharacter: CHARACTER });
  const spine = planStorySpine({
    topic: "London, 1536",
    narrationDurationSec: 12,
    sentenceTimings: SENTENCES,
    shotComposition: "pov_handheld_vlog",
    characterPromptBlock: characterPromptBlock(resolved),
  });
  const prompt = spine.dpVisualSpecs[0].keyframePrompt;
  assert.ok(prompt.startsWith('LOCKED RECURRING CHARACTER "Chloe"'), "identity leads the prompt, before framing and content");
  assert.ok(prompt.includes(CHARACTER.appearance), "the frozen appearance survives into the planned prompt");
  assert.ok(prompt.includes("HOLDING THE CAMERA THEMSELVES"), "POV framing must be stated in the prompt");
  assert.ok(!/\.\.\s/.test(prompt.replace(/extraordinary\.\./, "")), "spliced clauses must not produce doubled full stops");
  assert.ok(
    spine.dpVisualSpecs[0].motionPrompt.includes("held in the subject's own hand"),
    "the motion prompt must describe handheld operation for the i2v step",
  );
  assert.ok(spine.shotList[0].negative.includes("tripod"), "POV negatives must be merged into the shot");

  // The camera vocabulary stays inside the bridge's closed enum — this is the
  // constraint that keeps POV a PROFILE rather than a second render stack.
  for (const shot of spine.shotList) {
    assert.doesNotThrow(() => ShotPlanSchema.parse(shot), `shot ${shot.id} must satisfy the render contract`);
  }
  assert.ok(!spine.shotList.some((shot) => shot.shotScale === "extreme_close"), "there is no extreme close-up at arm's length");
}

function compositionVocabulariesSatisfyTheRenderContract(): void {
  const template = planStorySpine({
    topic: "t",
    narrationDurationSec: 12,
    sentenceTimings: SENTENCES,
  }).shotList[0];
  for (const profile of Object.values(SHOT_COMPOSITION_PROFILES)) {
    for (const cameraMove of profile.cameraMoves) {
      assert.doesNotThrow(
        () => ShotPlanSchema.parse({ ...template, cameraMove }),
        `${profile.key} camera move "${cameraMove}" is not in the render bridge's enum`,
      );
    }
    for (const shotScale of profile.shotScales) {
      assert.doesNotThrow(
        () => ShotPlanSchema.parse({ ...template, shotScale }),
        `${profile.key} shot scale "${shotScale}" is not in the render bridge's enum`,
      );
    }
  }
  // Unknown input must resolve to the default rather than throw: a channel with
  // a stale composition string must render the way it always did.
  assert.equal(shotCompositionProfile("nonsense").key, DEFAULT_SHOT_COMPOSITION);
  assert.equal(
    compositionNegative(SHOT_COMPOSITION_PROFILES.pov_handheld_vlog, ["Tripod", "blur"]),
    "Tripod, blur, film crew, professional studio lighting, cinematic bokeh, third-person observer framing, " +
      "modern camera equipment visible in the scene, smartphone visible in the reflection",
    "channel negatives are preserved and profile terms are de-duplicated case-insensitively",
  );
}

/* ── module 3: multi-character dialogue ──────────────────────────────────── */

const BEAT: DialogueBeat = {
  id: "scene-01",
  setting: "the presence chamber at Whitehall, winter 1536",
  counterparts: ["Henry VIII"],
  intent: "warn Anne about what is coming without sounding completely insane",
  targetSeconds: 75,
};

function dialogueRejectsTheFourRealFailureModes(): void {
  const good = normalizeDialogueScene(
    {
      turns: [
        { speaker: "Chloe", line: "Your Majesty. Big fan. Genuinely." },
        { speaker: "Henry VIII", line: "You speak strangely. Where is your husband?" },
        { speaker: "Chloe", line: "Long story. Can I ask you something about Anne?" },
        { speaker: "Henry VIII", line: "You may ask. I may not answer." },
        { speaker: "Chloe", line: "Just be kind to her. That is all." },
        { speaker: "Henry VIII", line: "Kindness is not a thing a king is owed to spend." },
      ],
    },
    BEAT,
    "Chloe",
  );
  assert.doesNotThrow(() => assertDialogueScene(good, "Chloe"));
  assert.equal(
    dialogueSceneText(good).split("\n")[0],
    "Chloe: Your Majesty. Big fan. Genuinely.",
    "turns render as plain NAME: line, which a multi-voice layer can split and a single narrator can read",
  );

  // A turn attributed to somebody not in the scene is DROPPED, not reassigned.
  const intruder = normalizeDialogueScene(
    { turns: [...(good.turns as unknown[]), { speaker: "Thomas Cromwell", line: "Indeed." }] },
    BEAT,
    "Chloe",
  );
  assert.equal(intruder.turns.length, good.turns.length, "a line from an absent speaker must be dropped, not re-attributed");

  // (a) counterpart as a lectern
  const monologue = { ...good, turns: [
    ...good.turns.slice(0, 1),
    { speaker: "Chloe", line: "So anyway." },
    { speaker: "Chloe", line: "And then." },
    { speaker: "Chloe", line: "And also." },
    { speaker: "Henry VIII", line: "Mm." },
  ] };
  assert.ok(
    dialogueSceneDefects(monologue, "Chloe").some((defect) => /monologue with interruptions/.test(defect)),
  );
  // (b) stacked turns, no exchange
  const stacked = { ...good, turns: [
    { speaker: "Chloe", line: "One." },
    { speaker: "Chloe", line: "Two." },
    { speaker: "Chloe", line: "Three." },
    { speaker: "Henry VIII", line: "Four." },
    { speaker: "Henry VIII", line: "Five." },
    { speaker: "Henry VIII", line: "Six." },
  ] };
  assert.ok(dialogueSceneDefects(stacked, "Chloe").some((defect) => /never alternates/.test(defect)));
  // (c) exposition dump
  const dump = { ...good, turns: good.turns.map((turn, index) => (index === 1 ? { ...turn, line: "x".repeat(320) } : turn)) };
  assert.ok(dialogueSceneDefects(dump, "Chloe").some((defect) => /exposition dump/.test(defect)));
  // (d) the host never speaks
  const hostless = { ...good, turns: good.turns.map((turn) => ({ ...turn, speaker: "Henry VIII" })) };
  assert.ok(dialogueSceneDefects(hostless, "Chloe").some((defect) => /never has the POV host speak/.test(defect)));

  // An unusable response degrades to "too few turns", not to a parse error.
  assert.ok(
    dialogueSceneDefects(normalizeDialogueScene(null, BEAT, "Chloe"), "Chloe").some((defect) => /turn\(s\)/.test(defect)),
  );
}

/* ── module 4: vlogger-register episode script ───────────────────────────── */

function goodEpisodeRaw(): unknown {
  return {
    title: "One day in Tudor London",
    coldOpen:
      "Hi, welcome back, I'm Chloe and I have time travelled to London in 1536, and I need you to understand " +
      "that the smell has physically staggered me. This is no Four Seasons.",
    itinerary: [
      "Today I want to walk across London Bridge.",
      "Then I want to find something to eat that will not kill me.",
      "And then, obviously, I am going to try to meet the king.",
    ],
    segments: [
      {
        id: "segment-01",
        location: "London Bridge",
        narration:
          "So this is the bridge, and fun fact, it was finished in 1209 and there are actual houses on it. People live " +
          "on the bridge. I am walking down a street that is also a river crossing.",
        factClaimIds: ["fact-01"],
      },
      {
        id: "segment-02",
        location: "a Cheapside cookshop",
        narration: "I have bought a pie. I have questions about the pie. I am going to eat the pie anyway.",
        factClaimIds: [],
      },
      {
        id: "segment-03",
        location: "the presence chamber at Whitehall",
        narration: "Right. He is actually in there. I am going in.",
        factClaimIds: [],
        dialogueBeatId: "scene-01",
      },
    ],
    engagementLine:
      "Also, genuinely, thank you — a hundred and fifty thousand of you subscribed while I was in the sixteenth century, " +
      "which is a sentence I did not expect to say out loud in a palace.",
    signOff:
      "So, day one: crossed a bridge people live on, ate a pie of unknown provenance, and got mildly threatened by a king. Good night.",
    factClaims: [
      { id: "fact-01", kind: "year", text: "Old London Bridge was completed in 1209.", subject: "Q1090666", property: "P571", value: 1209 },
    ],
    dialogueBeats: [
      { id: "scene-01", setting: "the presence chamber at Whitehall, winter 1536", counterparts: ["Henry VIII"], intent: "warn him off", targetSeconds: 75 },
    ],
  };
}

function episodeStructureIsEnforced(): void {
  const episode = normalizePovEpisode(goodEpisodeRaw(), { hostName: "Chloe", destination: "London, 1536" });
  assert.deepEqual(povEpisodeDefects(episode), []);
  assert.equal(episode.hostName, "Chloe");

  // The host name is NOT model-supplied: a renamed host is a renamed channel.
  const renamed = normalizePovEpisode(
    { ...(goodEpisodeRaw() as Record<string, unknown>), hostName: "Imposter" },
    { hostName: "Chloe", destination: "London, 1536" },
  );
  assert.equal(renamed.hostName, "Chloe", "the locked host must overwrite whatever the model returned");

  // Each structural part is individually load-bearing.
  const cases: Array<[Partial<Record<string, unknown>>, RegExp]> = [
    [{ coldOpen: "London in 1536 was a city of contrasts and disease." }, /never says the host's name/],
    [{ itinerary: ["one thing"] }, /itinerary item/],
    [{ engagementLine: "" }, /engagement line/],
    [{ signOff: "" }, /sign-off recap/],
    [{ factClaims: [] }, /no checkable fact claims/],
  ];
  for (const [patch, pattern] of cases) {
    const broken = normalizePovEpisode(
      { ...(goodEpisodeRaw() as Record<string, unknown>), ...patch },
      { hostName: "Chloe", destination: "London, 1536" },
    );
    assert.ok(
      povEpisodeDefects(broken).some((defect) => pattern.test(defect)),
      `expected a defect matching ${pattern} for patch ${JSON.stringify(Object.keys(patch))}`,
    );
  }

  // THE FORMAT-KILLING DEFECT: a documentary-narrator sentence in the body.
  const narrated = normalizePovEpisode(
    {
      ...(goodEpisodeRaw() as Record<string, unknown>),
      segments: [
        ...(goodEpisodeRaw() as { segments: unknown[] }).segments,
        { id: "segment-04", location: "the Thames", narration: "In this video, we will explore the river.", factClaimIds: [] },
      ],
    },
    { hostName: "Chloe", destination: "London, 1536" },
  );
  assert.ok(povEpisodeDefects(narrated).some((defect) => /documentary-narrator register/.test(defect)));

  // A fact declared but never spoken, and a dialogue beat never placed, are
  // both dangling references that would break the downstream join.
  const undelivered = normalizePovEpisode(
    {
      ...(goodEpisodeRaw() as Record<string, unknown>),
      segments: (goodEpisodeRaw() as { segments: Array<Record<string, unknown>> }).segments.map((segment) => ({
        ...segment,
        factClaimIds: [],
      })),
    },
    { hostName: "Chloe", destination: "London, 1536" },
  );
  assert.ok(povEpisodeDefects(undelivered).some((defect) => /never delivered in any segment/.test(defect)));
}

function narrationProjectionIsPureAndOrdered(): void {
  const episode = normalizePovEpisode(goodEpisodeRaw(), { hostName: "Chloe", destination: "London, 1536" });
  // Before dialogue exists, the projection is still valid — the same function
  // serves the preview and the final assembly.
  const withoutDialogue = povEpisodeNarration(episode);
  assert.ok(!withoutDialogue.includes("Henry VIII:"));

  const withDialogue = povEpisodeNarration(episode, { "scene-01": "Chloe: Hello.\nHenry VIII: No." });
  assert.ok(withDialogue.includes("Henry VIII: No."), "dialogue must be spliced at its anchored segment");
  assert.ok(
    withDialogue.indexOf("Henry VIII: No.") < withDialogue.indexOf("thank you"),
    "dialogue lands inside the body, before the engagement line",
  );
  assert.ok(withDialogue.endsWith("Good night."), "the sign-off is last");
  assert.equal(
    withDialogue,
    povEpisodeNarration(episode, { "scene-01": "Chloe: Hello.\nHenry VIII: No." }),
    "the projection must be deterministic so a checkpoint replay reproduces it",
  );

  // The register directive and the structural asks reach the prompt.
  const prompt = povEpisodePrompt({ destination: "London, 1536", hostName: "Chloe", targetSeconds: 480, dialogueBeats: 2 });
  assert.ok(prompt.includes(POV_VLOG_REGISTER), "the register contract must survive into the composed prompt");
  for (const required of ["coldOpen", "itinerary", "dialogueBeats", "engagementLine", "signOff", "factClaims"]) {
    assert.ok(prompt.includes(required), `the prompt must ask for ${required}`);
  }
}

/* ── module 5: historical fact grounding ─────────────────────────────────── */

/** A SPARQL endpoint stub. Returns whatever bindings the scenario declares. */
function sparqlStub(bindingsFor: (query: string) => Array<Record<string, { value: string }>>) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    const query = decodeURIComponent(url.split("query=")[1] ?? "");
    return new Response(JSON.stringify({ results: { bindings: bindingsFor(query) } }), { status: 200 });
  };
}

const CLAIM: FactClaim = {
  id: "fact-01",
  kind: "year",
  text: "Old London Bridge was completed in 1209.",
  subject: "Q1090666",
  property: "P571",
  value: 1209,
};

async function factCheckVerdictsAreAsymmetric(): Promise<void> {
  const options = { retries: 1, sleepImpl: async () => {} };

  const verified = await checkFactClaims([CLAIM], {
    ...options,
    fetchImpl: sparqlStub(() => [{ value: { value: "1209" } }]) as unknown as typeof fetch,
  });
  assert.equal(verified.verdicts[0].status, "verified");
  assert.equal(verified.verdicts[0].provenance, "wikidata-statement");
  assert.ok(verified.verdicts[0].sourceUrl?.startsWith("https://"), "a verified claim must carry a resolvable citation");
  assert.doesNotThrow(() => assertFactCheckIntegrity(verified));

  // CONTRADICTED is fatal with no ratio and no override.
  const wrong = await checkFactClaims([CLAIM], {
    ...options,
    fetchImpl: sparqlStub(() => [{ value: { value: "1176" } }]) as unknown as typeof fetch,
  });
  assert.equal(wrong.verdicts[0].status, "contradicted");
  assert.throws(() => assertFactCheckIntegrity(wrong, { maxUnsupportedRatio: 1 }), /contradicted by the structured record/);

  // No statement → UNSUPPORTED, which is explicitly not the same as false.
  const missing = await checkFactClaims([CLAIM], {
    ...options,
    fetchImpl: sparqlStub(() => []) as unknown as typeof fetch,
  });
  assert.equal(missing.verdicts[0].status, "unsupported");
  assert.ok(/not the same as it being wrong/.test(missing.verdicts[0].detail));
  assert.throws(() => assertFactCheckIntegrity(missing, { maxUnsupportedRatio: 0.5 }), /could not be checked/);
  assert.doesNotThrow(() => assertFactCheckIntegrity(missing, { maxUnsupportedRatio: 1 }));

  // Conflicting values are REFUSED, not arbitrated — the rankFacts rule.
  const conflicting = await checkFactClaims([CLAIM], {
    ...options,
    fetchImpl: sparqlStub(() => [{ value: { value: "1209" } }, { value: { value: "1176" } }]) as unknown as typeof fetch,
  });
  assert.equal(conflicting.verdicts[0].status, "unsupported");
  assert.ok(/refusing to arbitrate/.test(conflicting.verdicts[0].detail));

  // An ambiguous label is refused for the same reason: a confident verdict
  // about the wrong entity is worse than no verdict.
  const ambiguous = await checkFactClaims([{ ...CLAIM, subject: "Cambridge" }], {
    ...options,
    fetchImpl: sparqlStub((query) =>
      /rdfs:label/.test(query)
        ? [{ item: { value: "http://www.wikidata.org/entity/Q350" } }, { item: { value: "http://www.wikidata.org/entity/Q49123" } }]
        : [{ value: { value: "1209" } }],
    ) as unknown as typeof fetch,
  });
  assert.equal(ambiguous.verdicts[0].status, "unsupported");
  assert.ok(/exactly one Wikidata entity/.test(ambiguous.verdicts[0].detail));

  // A source failure degrades to unsupported instead of crashing a run that has
  // already paid for a script.
  const failing = await checkFactClaims([CLAIM], {
    ...options,
    fetchImpl: (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch,
  });
  assert.equal(failing.verdicts[0].status, "unsupported");

  // A quantity claim gets a 1% tolerance; a year claim gets none.
  const rounded = await checkFactClaims(
    [{ id: "f", kind: "quantity", text: "828m tall", subject: "Q12495", property: "P2048", value: 828 }],
    { ...options, fetchImpl: sparqlStub(() => [{ value: { value: "829.8" } }]) as unknown as typeof fetch },
  );
  assert.equal(rounded.verdicts[0].status, "verified", "a rounded measurement is an editorial choice, not an error");
}

function malformedClaimsAreNotSilentlyPassed(): void {
  // A property the writer did not supply cannot be inferred from prose — a
  // guessed property silently checks a different statement.
  assert.deepEqual(usableFactClaims([{ ...CLAIM, property: "height" }]), []);
  assert.deepEqual(usableFactClaims([{ ...CLAIM, kind: "vibes" }]), []);
  assert.deepEqual(usableFactClaims([{ ...CLAIM, value: Number.NaN }]), []);
  assert.equal(usableFactClaims([CLAIM]).length, 1);
}

async function main(): Promise<void> {
  characterIsReadNotReauthored();
  characterIntegrityRefusesDrift();
  loraTriggerWordsMustReachThePrompt();
  loraSurfaceCapabilityIsExplicit();
  cinematicCompositionIsByteIdentical();
  povCompositionChangesFramingNotRenderer();
  compositionVocabulariesSatisfyTheRenderContract();
  dialogueRejectsTheFourRealFailureModes();
  episodeStructureIsEnforced();
  narrationProjectionIsPureAndOrdered();
  await factCheckVerdictsAreAsymmetric();
  malformedClaimsAreNotSilentlyPassed();
  console.log("POV character-vlog module tests passed (identity lock, composition parity, dialogue, episode structure, fact verdicts)");
}

void main();
