/**
 * dialogueScene — ONE job: TURN A SCENE BEAT INTO SPEAKER-TAGGED DIALOGUE TEXT.
 *
 * Text in, structured conversation out. That is the entire contract.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *   • It does not synthesize speech. It emits `{ speaker, line }` turns; the
 *     existing narration module owns turning those into audio, and this module
 *     has no TTS import, no voice id and no opinion about who sounds like what.
 *   • It does not make pictures. A separate composition step turns a dialogue
 *     beat into a shot (src/lib/shotComposition.ts + the story spine).
 *   • It does not decide WHICH scenes an episode contains. The episode script
 *     module declares the beats; this one writes them.
 *
 * WHY DIALOGUE IS ITS OWN MODULE AND NOT PART OF THE SCRIPT MODULE
 * Because it is a different writing problem with a different failure mode. A
 * narrated script fails by being boring. A scripted conversation fails by
 * having both characters sound like the same person, by having the historical
 * figure narrate exposition at the host, or by having the host know things the
 * character in the fiction has not been told yet. Those are checkable
 * properties of a turn list, and `dialogueSceneDefects` checks them — which is
 * only possible because the turns exist as structure rather than as prose
 * buried in a paragraph.
 *
 * Pure data + pure functions and prompt construction. No provider import, no
 * network call: the block in src/trigger/blocks/povVlogBlocks.ts makes the one
 * bounded model call and hands the raw result here to be normalised and judged.
 */

export const DIALOGUE_SCENE_VERSION = "dialogue-scene/v1" as const;

/** Hard bounds. A "conversation" of two lines is a caption; of forty is a play. */
export const DIALOGUE_MIN_TURNS = 4;
export const DIALOGUE_MAX_TURNS = 24;
export const DIALOGUE_MAX_LINE_CHARS = 320;
export const DIALOGUE_MAX_PARTICIPANTS = 4;

/**
 * A scene the episode script asked for. The script module produces these; this
 * module consumes them. Kept small on purpose — everything here is something a
 * writer must decide, and nothing here is something a model should invent.
 */
export interface DialogueBeat {
  id: string;
  /** Where and when, e.g. "the presence chamber at Whitehall, winter 1536". */
  setting: string;
  /**
   * Who is in it BESIDES the host. Named historical figures, in the form the
   * audience will hear them. The host is added automatically as the first
   * participant, because a POV vlog scene without the POV character is not one.
   */
  counterparts: string[];
  /**
   * What the host wants out of this scene, in one line. This is the dramatic
   * engine — "warn her about what is coming without sounding insane" — and the
   * single most important input, because a conversation with no want is small
   * talk.
   */
  intent: string;
  /** Roughly how long, in spoken seconds. Bounds the requested turn count. */
  targetSeconds: number;
}

export interface DialogueTurn {
  /** WHO speaks. The host's own name, or a counterpart's name, verbatim. */
  speaker: string;
  line: string;
  /**
   * Optional parenthetical performance note ("wary", "delighted"). Carried as
   * a field rather than baked into `line` so a TTS layer can use it or ignore
   * it without having to strip brackets out of the spoken text.
   */
  delivery?: string;
}

export interface DialogueScene {
  version: typeof DIALOGUE_SCENE_VERSION;
  beatId: string;
  setting: string;
  /** Host first, then counterparts, de-duplicated. */
  participants: string[];
  turns: DialogueTurn[];
}

function cleanString(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Normalise whatever the model returned into a scene. NEVER throws — an
 * unusable response must degrade to a scene with too few turns, which
 * `dialogueSceneDefects` then rejects with a legible reason. Throwing here
 * would report "bad JSON" where the real problem is "the writing is wrong".
 */
export function normalizeDialogueScene(raw: unknown, beat: DialogueBeat, hostName: string): DialogueScene {
  const object = (raw ?? {}) as Record<string, unknown>;
  const rawTurns = Array.isArray(object["turns"]) ? object["turns"] : [];
  const participants = [hostName, ...beat.counterparts]
    .map((name) => cleanString(name, 60))
    .filter(Boolean);
  const known = new Set(participants.map((name) => name.toLowerCase()));
  const turns: DialogueTurn[] = rawTurns
    .flatMap((entry) => {
      const turn = (entry ?? {}) as Record<string, unknown>;
      const speaker = cleanString(turn["speaker"], 60);
      const line = cleanString(turn["line"], DIALOGUE_MAX_LINE_CHARS);
      // A turn attributed to somebody who is not in the scene is dropped rather
      // than re-attributed: silently reassigning a line changes who said it.
      if (!speaker || !line || !known.has(speaker.toLowerCase())) return [];
      const delivery = cleanString(turn["delivery"], 40);
      return [{ speaker, line, ...(delivery ? { delivery } : {}) }];
    })
    .slice(0, DIALOGUE_MAX_TURNS);
  return {
    version: DIALOGUE_SCENE_VERSION,
    beatId: beat.id,
    setting: beat.setting,
    participants,
    turns,
  };
}

/**
 * The quality gate. These are the four ways a scripted historical conversation
 * actually fails, each expressed as something checkable about a turn list.
 */
export function dialogueSceneDefects(scene: DialogueScene, hostName: string): string[] {
  const defects: string[] = [];
  if (scene.turns.length < DIALOGUE_MIN_TURNS) {
    defects.push(
      `scene ${scene.beatId} has ${scene.turns.length} turn(s); a conversation needs at least ${DIALOGUE_MIN_TURNS}`,
    );
  }
  if (scene.participants.length < 2) {
    defects.push(`scene ${scene.beatId} has fewer than two participants — that is a monologue, not a dialogue`);
  }
  if (scene.participants.length > DIALOGUE_MAX_PARTICIPANTS) {
    defects.push(
      `scene ${scene.beatId} has ${scene.participants.length} participants; over ${DIALOGUE_MAX_PARTICIPANTS} nobody is distinguishable by voice alone`,
    );
  }
  const host = hostName.toLowerCase();
  const speakers = scene.turns.map((turn) => turn.speaker.toLowerCase());
  if (!speakers.includes(host)) {
    defects.push(`scene ${scene.beatId} never has the POV host speak — the format is first person`);
  }
  // FAILURE MODE: the counterpart is a prop. If everyone else combined gets
  // fewer than a third of the turns, this is narration wearing a costume.
  const hostTurns = speakers.filter((speaker) => speaker === host).length;
  const otherTurns = scene.turns.length - hostTurns;
  if (scene.turns.length >= DIALOGUE_MIN_TURNS && otherTurns * 3 < scene.turns.length) {
    defects.push(
      `scene ${scene.beatId} gives the other participant(s) only ${otherTurns}/${scene.turns.length} turns — ` +
        "that is a monologue with interruptions, not a conversation",
    );
  }
  // FAILURE MODE: no actual exchange. Consecutive same-speaker runs across the
  // whole scene mean nobody is responding to anybody.
  let alternations = 0;
  for (let index = 1; index < scene.turns.length; index++) {
    if (speakers[index] !== speakers[index - 1]) alternations++;
  }
  if (scene.turns.length >= DIALOGUE_MIN_TURNS && alternations < 2) {
    defects.push(`scene ${scene.beatId} never alternates speakers — the turns are stacked, not exchanged`);
  }
  // FAILURE MODE: exposition dumping. A single 320-char turn is a paragraph,
  // and nobody in a real conversation delivers one.
  const overlong = scene.turns.filter((turn) => turn.line.length >= DIALOGUE_MAX_LINE_CHARS);
  if (overlong.length) {
    defects.push(
      `scene ${scene.beatId} has ${overlong.length} turn(s) at the ${DIALOGUE_MAX_LINE_CHARS}-character ceiling — ` +
        "that is an exposition dump, not a line of dialogue",
    );
  }
  return defects;
}

export function assertDialogueScene(scene: DialogueScene, hostName: string): DialogueScene {
  const defects = dialogueSceneDefects(scene, hostName);
  if (defects.length) throw new Error(`dialogue scene integrity: ${defects.join("; ")}`);
  return scene;
}

/**
 * Render a scene as speaker-tagged spoken text.
 *
 * The tag format is `NAME: line`, one turn per line — the plainest thing a
 * downstream multi-voice TTS layer can split on, and readable as-is when a
 * single-voice narrator performs the whole scene. This module makes no claim
 * about which of those happens; it just does not foreclose either.
 */
export function dialogueSceneText(scene: DialogueScene): string {
  return scene.turns
    .map((turn) => `${turn.speaker}: ${turn.line}`)
    .join("\n");
}

/** Bounded turn request derived from the beat's duration. ~3.2 spoken words/sec, ~14 words/turn. */
export function turnsForSeconds(targetSeconds: number): number {
  const estimate = Math.round((Math.max(10, Math.min(240, targetSeconds)) * 3.2) / 14);
  return Math.max(DIALOGUE_MIN_TURNS, Math.min(DIALOGUE_MAX_TURNS, estimate));
}

/**
 * The one prompt this module owns. Every instruction here is aimed at one of
 * the failure modes `dialogueSceneDefects` checks for, so the prompt and the
 * gate cannot drift apart into "asks for X, rejects Y".
 */
export function dialogueScenePrompt(args: {
  beat: DialogueBeat;
  hostName: string;
  hostRegister: string;
  turns: number;
}): string {
  const { beat, hostName, hostRegister, turns } = args;
  return [
    `Write a scene of scripted dialogue for a first-person history vlog.`,
    ``,
    `SETTING: ${beat.setting}`,
    `PARTICIPANTS: ${hostName} (the vlogger, POV host) and ${beat.counterparts.join(", ")}.`,
    `WHAT ${hostName.toUpperCase()} WANTS IN THIS SCENE: ${beat.intent}`,
    ``,
    `${hostName}'s register: ${hostRegister}`,
    ``,
    `RULES:`,
    `1. Roughly ${turns} turns. Real conversation: they interrupt, react, and answer each other.`,
    `2. The other participant(s) must get at least a third of the turns and must WANT something of their own.`,
    `   They are not a lectern for facts — if they explain something, it is because it serves them to.`,
    `3. No turn may exceed about 40 words. Nobody delivers a paragraph out loud.`,
    `4. The historical figure speaks like a person of their time and station, not like a museum placard,`,
    `   and never like a modern person. ${hostName} is the only one who sounds contemporary — that gap is the joke.`,
    `5. ${hostName} may not reveal that they are from the future in a way the scene cannot absorb;`,
    `   the comedy is in almost giving it away.`,
    `6. Do not state dates, measurements or statistics in this scene. Facts are delivered elsewhere in the`,
    `   episode where they can be source-checked; a number invented inside dialogue is unverifiable and`,
    `   will be treated as a defect.`,
    ``,
    `Return JSON only: {"turns":[{"speaker":"<exact participant name>","line":"...","delivery":"<optional one-word tone>"}]}`,
  ].join("\n");
}
