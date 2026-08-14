/**
 * "What would AI do" / "AI POV" persona enrichment lock.
 *
 * This capability is deliberately CONFIGURATION, not infrastructure: it adds no
 * renderer, no TTS pipeline and no new block. This suite binds the two things
 * that make it real, and the boundary that keeps it small:
 *
 *   1. the speculative-hypothetical genres exist, reach BOTH consumers
 *      (script_gen's tone switch and topic_select's seed pool), and carry a
 *      hard anti-fabrication frame;
 *   2. the channel voice lock resolves with the right precedence and — the
 *      whole point — turns the TTS resolver's silent fallback into a throw;
 *   3. neither module imports a provider: they are pure configuration.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AI_PERSONA_GENRES,
  AI_PERSONA_GENRE_KEYS,
  AI_SPECULATIVE_FRAME,
  aiPersonaDirective,
  aiPersonaTopicSeeds,
  isAiPersonaGenre,
} from "@/lib/aiPersona";
import {
  assertVoiceLockSatisfied,
  makeVoiceLock,
  parseVoiceLock,
  resolveChannelVoice,
  voiceLockDefects,
  VOICE_LOCK_VERSION,
} from "@/lib/voiceLock";
import { resolveVoiceId } from "@/lib/tts";
import { MODULE_CATALOG } from "@/engine/moduleCatalog";
import { MODULE_CONTRACTS } from "@/engine/moduleContracts";

const ROOT = join(__dirname, "../../..");

function genres(): void {
  assert.deepEqual(AI_PERSONA_GENRE_KEYS.sort(), ["ai_hypothetical", "ai_pov"]);
  for (const key of AI_PERSONA_GENRE_KEYS) {
    const genre = AI_PERSONA_GENRES[key];
    assert.ok(genre.label.length > 0 && genre.description.length > 0, `${key} needs operator-facing copy`);
    // THE ANTI-FABRICATION FRAME. A hypothetical is only honest if it refuses to
    // manufacture evidence for itself, so every genre must carry it verbatim.
    assert.ok(
      genre.directive.includes(AI_SPECULATIVE_FRAME),
      `${key} must carry the speculative frame verbatim, not a paraphrase`,
    );
    assert.ok(genre.topicSeeds.length >= 5, `${key} needs enough seeds to avoid immediate repetition`);
    assert.equal(
      new Set(genre.topicSeeds).size,
      genre.topicSeeds.length,
      `${key} has duplicate seeds, which the no-repeat policy would reject at runtime`,
    );
  }
  assert.match(AI_SPECULATIVE_FRAME, /may NOT invent a study/);
  assert.match(AI_SPECULATIVE_FRAME, /hypothetical in the first 15 seconds/);
  // The first-person format's defining constraint.
  assert.match(AI_PERSONA_GENRES.ai_pov.directive, /say "I" throughout/);
  assert.match(AI_PERSONA_GENRES.ai_pov.directive, /Do not claim feelings, memories, a body/);

  /* both consumers, one definition */
  assert.equal(aiPersonaDirective("ai_pov"), AI_PERSONA_GENRES.ai_pov.directive);
  assert.equal(aiPersonaDirective("crime"), "", "a non-genre style must fall through to the base switch");
  assert.equal(aiPersonaDirective(undefined), "");
  assert.deepEqual(aiPersonaTopicSeeds("ai_hypothetical"), AI_PERSONA_GENRES.ai_hypothetical.topicSeeds);
  assert.deepEqual(aiPersonaTopicSeeds("nonsense"), []);
  assert.ok(isAiPersonaGenre("ai_pov") && !isAiPersonaGenre("ai_pov_2"));

  // The genres must be REACHABLE from the operator surface, not just defined.
  const scriptSpec = MODULE_CATALOG.find((spec) => spec.block === "script_gen");
  const styleField = scriptSpec?.params.find((param) => param.key === "style");
  for (const key of AI_PERSONA_GENRE_KEYS) {
    assert.ok(
      styleField?.options?.some((option) => option.value === key),
      `${key} must be selectable as a script tone`,
    );
  }
  const topicSpec = MODULE_CATALOG.find((spec) => spec.block === "topic_select");
  const genreField = topicSpec?.params.find((param) => param.key === "genre");
  assert.ok(genreField, "topic_select must expose the genre seed switch");
  for (const key of AI_PERSONA_GENRE_KEYS) {
    assert.ok(
      genreField?.options?.some((option) => option.value === key),
      `${key} must be selectable as a topic genre`,
    );
  }

  // ...and it must be wired into the actual prompt path, not just the catalog.
  const scriptGenSource = readFileSync(join(ROOT, "src/lib/scriptGen.ts"), "utf8");
  assert.ok(
    scriptGenSource.includes("aiPersonaDirective"),
    "script_gen must read the genre directive from the shared definition",
  );
  const topicSource = readFileSync(join(ROOT, "src/trigger/blocks/lofiBlocks.ts"), "utf8");
  assert.ok(
    topicSource.includes("aiPersonaTopicSeeds"),
    "topic_select must read the genre seeds from the shared definition",
  );

  /* NO INFRASTRUCTURE. This capability is config; if it grows a provider import
   * it has stopped being config. */
  const personaSource = readFileSync(join(ROOT, "src/lib/aiPersona.ts"), "utf8");
  for (const forbidden of ["fetch(", "@/lib/gemini", "@/lib/tts", "import {", "novita"]) {
    assert.ok(!personaSource.includes(forbidden), `aiPersona.ts must stay pure config (found ${forbidden})`);
  }
}

function voiceLock(): void {
  const lock = makeVoiceLock({
    provider: "fish",
    voiceId: "psychological",
    reason: "AI POV narrator identity",
    persona: "the AI narrator of this channel",
    now: 1_700_000_000_000,
  });
  assert.equal(lock.version, VOICE_LOCK_VERSION);
  assert.deepEqual(voiceLockDefects(lock), []);
  assert.deepEqual(parseVoiceLock(lock), lock);

  /* malformed locks are ignored, never fatal — an unreadable lock must not
   * brick a channel, it must simply stop being a lock */
  for (const bad of [
    null,
    {},
    { ...lock, version: "voice-lock/v0" },
    { ...lock, provider: "azure" },
    { ...lock, voiceId: "" },
    { ...lock, reason: "" },
    { ...lock, lockedAt: "yesterday" },
  ]) {
    assert.equal(parseVoiceLock(bad), undefined, `malformed lock must not parse: ${JSON.stringify(bad)}`);
  }
  assert.ok(voiceLockDefects({ ...lock, reason: "" }).some((d) => d.includes("no reason")));

  /* precedence: lock > cast > identity > nothing */
  assert.deepEqual(resolveChannelVoice({ voiceLock: lock, voiceId: "voice_dl", voiceCasting: { voiceId: "EL123" } }), {
    voiceId: "psychological",
    provider: "fish",
    locked: true,
    source: "lock",
    persona: "the AI narrator of this channel",
  });
  assert.deepEqual(resolveChannelVoice({ voiceId: "voice_dl", voiceCasting: { voiceId: "EL123" } }), {
    voiceId: "EL123",
    provider: "elevenlabs",
    locked: false,
    source: "cast",
  });
  assert.deepEqual(resolveChannelVoice({ voiceId: "voice_dl" }), {
    voiceId: "voice_dl",
    locked: false,
    source: "identity",
  });
  assert.deepEqual(resolveChannelVoice(undefined), { locked: false, source: "none" });
  // A malformed lock falls through to the pre-lock behaviour rather than failing.
  assert.equal(resolveChannelVoice({ voiceLock: { junk: true }, voiceId: "voice_dl" }).source, "identity");

  /* THE POINT OF THE LOCK: silent drift becomes a throw.
   *
   * resolveVoiceId() deliberately falls back to a niche default and then to
   * sleepless_historian for unknown keys — right for most channels, fatal for a
   * persona channel. First prove the fallback really is silent... */
  const drifted = resolveVoiceId("this_voice_does_not_exist", "history");
  assert.equal(
    drifted,
    resolveVoiceId("psychological"),
    "precondition: an unknown voice key silently resolves to the niche default",
  );
  // ...then prove a locked channel refuses to ship it.
  assert.throws(
    () =>
      assertVoiceLockSatisfied({
        lock: makeVoiceLock({ provider: "fish", voiceId: "voice_dl", reason: "persona" }),
        resolvedReferenceId: drifted,
        resolveExpected: (pinned) => resolveVoiceId(pinned, "history"),
      }),
    /voice lock violated/,
    "a locked channel must fail rather than narrate in a different voice",
  );
  // The matching case must pass THROUGH the provider mapping, not by string
  // equality — a lock naming a friendly key must accept its resolved hex id.
  assert.doesNotThrow(() =>
    assertVoiceLockSatisfied({
      lock: makeVoiceLock({ provider: "fish", voiceId: "psychological", reason: "persona" }),
      resolvedReferenceId: resolveVoiceId("psychological", "history"),
      resolveExpected: (pinned) => resolveVoiceId(pinned, "history"),
    }),
  );
  // No lock = no behaviour change anywhere.
  assert.doesNotThrow(() =>
    assertVoiceLockSatisfied({ lock: undefined, resolvedReferenceId: "anything", resolveExpected: (v) => v }),
  );

  /* the lock must actually reach the narration module */
  assert.ok(
    (MODULE_CONTRACTS.narration_tts.optionalConsumes ?? []).includes("voiceLock"),
    "narration_tts must declare the voiceLock input or the runner will deny the read",
  );
  const narrationSource = readFileSync(join(ROOT, "src/trigger/blocks/narratedBlocks.ts"), "utf8");
  assert.ok(narrationSource.includes("assertVoiceLockSatisfied"), "narration_tts must enforce the lock");
  const runPipelineSource = readFileSync(join(ROOT, "src/trigger/runPipeline.ts"), "utf8");
  assert.ok(
    runPipelineSource.includes("voiceLock"),
    "the run seed must carry the channel's lock into the store",
  );
  // Storage lives on the channel identity, not in a parallel table.
  const schemaSource = readFileSync(join(ROOT, "convex/schema.ts"), "utf8");
  assert.ok(schemaSource.includes('v.literal("voice-lock/v1")'), "the lock must be persisted on channels.identity");
  const channelsSource = readFileSync(join(ROOT, "convex/channels.ts"), "utf8");
  assert.ok(
    channelsSource.includes('v.literal("voice-lock/v1")'),
    "identityValidator must accept the lock or every write silently discards it",
  );

  /* purity: the lock module decides, it does not synthesize */
  const lockSource = readFileSync(join(ROOT, "src/lib/voiceLock.ts"), "utf8");
  for (const forbidden of ["fetch(", "@/lib/tts", "synthNarration", "elevenlabs.io", "api."]) {
    assert.ok(!lockSource.includes(forbidden), `voiceLock.ts must stay pure (found ${forbidden})`);
  }
}

function main(): void {
  genres();
  voiceLock();
  console.log("aiPersonaVoiceLock: genre definitions, both consumer wirings, lock precedence and fail-closed drift locks passed");
}

main();
