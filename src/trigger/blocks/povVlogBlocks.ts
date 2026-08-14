/**
 * The POV-vlog lane's three text blocks. Each one owns exactly one job and
 * imports exactly the library that owns that job:
 *
 *   pov_vlog_script  → src/lib/povVlogScript.ts       (write the episode)
 *   dialogue_scene   → src/lib/dialogueScene.ts       (write the conversations)
 *   fact_check       → src/lib/historicalFactCheck.ts (prove the facts)
 *
 * They are three blocks rather than one because they fail differently, cost
 * differently and are worth retrying separately: a rejected fact does not mean
 * the dialogue was bad, and a flat conversation does not mean the itinerary
 * was wrong.
 *
 * NARRATION OWNERSHIP, stated once. `narrationText` has exactly ONE producer on
 * this lane: `dialogue_scene`. `pov_vlog_script` deliberately does not emit it,
 * even though it writes most of it, because the conversations have to be spliced
 * in before anything speaks — and two blocks writing the same key is how a
 * checkpoint replay ends up narrating a version that no longer exists. The
 * splice itself is `povEpisodeNarration()`, a pure projection owned by the
 * script module; the dialogue block calls it, it does not reimplement it.
 *
 * NONE of these three blocks renders anything, and none of them synthesizes
 * speech. The lane's picture is the existing Z-Image -> LTX chain, unchanged.
 */
import type { Block } from "@/engine/types";
import { COST_PATCH_KEY } from "@/engine/types";
import { geminiJson, hasGeminiKey } from "@/lib/gemini";
import { PRICE } from "@/engine/pricing";
import { resolveChannelCharacter } from "@/lib/channelCharacter";
import {
  assertDialogueScene,
  dialogueScenePrompt,
  dialogueSceneText,
  normalizeDialogueScene,
  turnsForSeconds,
  type DialogueBeat,
  type DialogueScene,
} from "@/lib/dialogueScene";
import {
  assertFactCheckIntegrity,
  checkFactClaims,
  factCheckSummary,
  usableFactClaims,
  type FactClaim,
} from "@/lib/historicalFactCheck";
import {
  assertPovEpisode,
  normalizePovEpisode,
  POV_MAX_DIALOGUE_BEATS,
  POV_VLOG_REGISTER,
  povEpisodeNarration,
  povEpisodePrompt,
  povEpisodeScript,
  type PovEpisode,
} from "@/lib/povVlogScript";

/**
 * Resolve the channel's locked host once, and refuse to proceed without one.
 *
 * This is the hard requirement that makes the lane a CHARACTER lane rather than
 * a first-person-narration lane. Falling back to a generic host would produce a
 * channel whose presenter changes between episodes, which is the exact product
 * failure this capability exists to prevent — so it fails closed, before spend.
 */
function requireHost(store: Readonly<Record<string, unknown>>): { name: string; promptBlock: string } {
  const resolved = resolveChannelCharacter({
    channelCharacter: store["channelCharacter"],
    characterLora: store["characterLora"],
  });
  if (!resolved.character) {
    throw new Error(
      "pov vlog: this channel has no locked character. A persistent-character POV channel must resolve the " +
        "same host every episode (src/lib/channelCharacter.ts) — refusing to author an episode for a host " +
        "that would be re-invented next week.",
    );
  }
  return { name: resolved.character.name, promptBlock: resolved.character.appearance };
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

export const povVlogScript: Block = {
  id: "pov_vlog_script",
  consumes: ["topic"],
  produces: ["povEpisode", "factClaims", "dialogueBeats"],
  paid: true,
  run: async (ctx) => {
    const topic = String(ctx.store["topic"] ?? "").trim();
    if (!topic) throw new Error("pov_vlog_script: no topic in the store");
    const host = requireHost(ctx.store);
    const persona = typeof ctx.store["persona"] === "string" ? (ctx.store["persona"] as string) : undefined;
    const targetSeconds = boundedNumber(ctx.params["targetSeconds"], 780, 120, 1_800);
    const dialogueBeats = Math.round(
      boundedNumber(ctx.params["dialogueBeats"], 2, 1, POV_MAX_DIALOGUE_BEATS),
    );

    if (!hasGeminiKey()) {
      // No deterministic fallback here, deliberately. The chart lane can fall
      // back to a canned arc because its honesty comes from a disclosure the
      // code applies; a history vlog's value is entirely in the writing, and a
      // template episode about a real period would be worse than no episode.
      throw new Error("pov_vlog_script: GEMINI_API_KEY is required — this format has no template fallback");
    }

    let modelCalls = 0;
    const raw = await geminiJson<unknown>({
      prompt: povEpisodePrompt({
        destination: topic,
        hostName: host.name,
        ...(persona ? { persona } : {}),
        targetSeconds,
        dialogueBeats,
      }),
      maxTokens: 8_000,
      temperature: 0.9,
    });
    modelCalls += 1;

    const episode = assertPovEpisode(normalizePovEpisode(raw, { hostName: host.name, destination: topic }));
    const costUsd = modelCalls * PRICE.boundedTextPassUsd;
    ctx.log(
      `pov_vlog_script ✓ "${episode.title}" — ${episode.segments.length} segment(s), ` +
        `${episode.factClaims.length} checkable claim(s), ${episode.dialogueBeats.length} dialogue beat(s), ` +
        `host locked as ${episode.hostName}, $${costUsd.toFixed(4)}`,
    );
    return {
      povEpisode: episode,
      factClaims: episode.factClaims,
      dialogueBeats: episode.dialogueBeats,
      [COST_PATCH_KEY]: costUsd,
    };
  },
};

export const dialogueScene: Block = {
  id: "dialogue_scene",
  consumes: ["povEpisode", "dialogueBeats"],
  produces: ["dialogueScenes", "script", "narrationText"],
  paid: true,
  run: async (ctx) => {
    const episode = ctx.store["povEpisode"] as PovEpisode | undefined;
    if (!episode) throw new Error("dialogue_scene: no povEpisode in the store");
    const beats = (ctx.store["dialogueBeats"] ?? []) as DialogueBeat[];
    const hostName = episode.hostName;

    if (!hasGeminiKey()) {
      throw new Error("dialogue_scene: GEMINI_API_KEY is required to write scripted dialogue");
    }

    const scenes: DialogueScene[] = [];
    let modelCalls = 0;
    for (const beat of beats) {
      const raw = await geminiJson<unknown>({
        prompt: dialogueScenePrompt({
          beat,
          hostName,
          hostRegister: POV_VLOG_REGISTER,
          turns: turnsForSeconds(beat.targetSeconds),
        }),
        maxTokens: 3_000,
        temperature: 0.9,
      });
      modelCalls += 1;
      // One retry allowance per beat, and only on a QUALITY failure — a scene
      // that came back as a monologue is worth asking for again; a scene that
      // came back malformed twice is not.
      let scene = normalizeDialogueScene(raw, beat, hostName);
      try {
        scenes.push(assertDialogueScene(scene, hostName));
      } catch (first) {
        ctx.log(`dialogue_scene: ${beat.id} rejected (${first instanceof Error ? first.message : first}) — one retry`);
        const retry = await geminiJson<unknown>({
          prompt: `${dialogueScenePrompt({
            beat,
            hostName,
            hostRegister: POV_VLOG_REGISTER,
            turns: turnsForSeconds(beat.targetSeconds),
          })}\n\nYour previous attempt was rejected: ${first instanceof Error ? first.message : String(first)}\nFix exactly that.`,
          maxTokens: 3_000,
          temperature: 0.9,
        });
        modelCalls += 1;
        scene = normalizeDialogueScene(retry, beat, hostName);
        scenes.push(assertDialogueScene(scene, hostName));
      }
    }

    const textByBeat: Record<string, string> = {};
    for (const scene of scenes) textByBeat[scene.beatId] = dialogueSceneText(scene);

    // Pure projection owned by the script module — see the file header.
    const script = povEpisodeScript(episode, textByBeat);
    const narrationText = povEpisodeNarration(episode, textByBeat);
    if (!narrationText.trim()) throw new Error("dialogue_scene: assembled narration is empty");

    const costUsd = modelCalls * PRICE.boundedTextPassUsd;
    ctx.log(
      `dialogue_scene ✓ ${scenes.length} scene(s), ${scenes.reduce((sum, scene) => sum + scene.turns.length, 0)} turn(s), ` +
        `${modelCalls} text call(s), $${costUsd.toFixed(4)}`,
    );
    return {
      dialogueScenes: scenes,
      script,
      narrationText,
      [COST_PATCH_KEY]: costUsd,
    };
  },
};

export const factCheck: Block = {
  id: "fact_check",
  consumes: ["factClaims"],
  produces: ["factCheckReport"],
  run: async (ctx) => {
    const claims = usableFactClaims((ctx.store["factClaims"] ?? []) as unknown[]) as FactClaim[];
    const declared = ((ctx.store["factClaims"] ?? []) as unknown[]).length;
    if (declared > 0 && claims.length === 0) {
      throw new Error(
        `fact_check: all ${declared} declared claim(s) were malformed — an episode whose facts cannot even be ` +
          "expressed in checkable form has no verifiable content to ship",
      );
    }
    // Free, unauthenticated, CC0 Wikidata SPARQL — the same endpoint and client
    // the quiz and ranking lanes already use. No key, no provider, no spend.
    const report = await checkFactClaims(claims);
    assertFactCheckIntegrity(report, {
      ...(ctx.params["maxUnsupportedRatio"] !== undefined
        ? { maxUnsupportedRatio: boundedNumber(ctx.params["maxUnsupportedRatio"], 0.5, 0, 1) }
        : {}),
    });
    ctx.log(`fact_check ✓ ${factCheckSummary(report)} — no contradicted claims`);
    return { factCheckReport: report };
  },
};

export const povVlogBlocks: Block[] = [povVlogScript, dialogueScene, factCheck];
