/**
 * povVlogScript — ONE job: WRITE THE EPISODE, in first-person travel-vlog
 * register, in the structure this format actually uses.
 *
 * It is the script-genre module for a persistent-character POV history/travel
 * vlog. It does not speak, does not draw, does not verify and does not choose a
 * topic. It turns "a day in Tudor London, 1536" plus a locked character into an
 * episode structure.
 *
 * THE STRUCTURE IS NOT INVENTED HERE
 * It is transcribed from the real format this capability was built to serve
 * (13-14 minute first-person history vlogs, YouTube "Education" category).
 * Every episode of that format runs the same seven-part spine, and the spine is
 * the reason it reads as a vlog rather than as a documentary:
 *
 *   1. COLD OPEN, DIRECT ADDRESS — "Hi, welcome back. I'm <name> and I have
 *      time travelled to <place> in <year>." Casual, to camera, immediately.
 *   2. SENSORY REACTION — the first thing said about the period is a physical
 *      complaint or a joke, not a fact. Smell, mud, noise, cold. This is what
 *      makes the past feel visited rather than described.
 *   3. STATED ITINERARY — the host says out loud what they are going to do
 *      today, as a list. This is the single most vlog-shaped move in the
 *      format: it sets expectation and gives the episode its chapters.
 *   4. FACT-DROPS IN CHARACTER — facts land MID-SCENE, in the first person
 *      ("fun fact, this was the only bridge across the city until 1750"),
 *      never as a narrator aside over b-roll. The delivery is the whole point:
 *      the same sentence read by a documentary voice is a different format.
 *   5. DIALOGUE SCENES — actual scripted back-and-forth with named historical
 *      figures. Declared here as beats; WRITTEN by src/lib/dialogueScene.ts,
 *      which is a separate module because it is a separate writing problem.
 *   6. FOURTH-WALL ENGAGEMENT LINE — the host, in character, thanks the real
 *      audience. The character's own channel growth is part of the fiction.
 *   7. SIGN-OFF RECAP — a deadpan list of what happened today, then goodnight.
 *
 * WHAT THIS MODULE OWNS AND WHAT IT HANDS OFF
 * It emits an `PovEpisode`: the structure, the spoken prose for every part
 * EXCEPT the dialogue, the dialogue BEATS (who/where/what's wanted), and the
 * fact-drops AS CLAIMS with the structured fields a checker needs. It owns none
 * of the three things that follow:
 *   • dialogue text            → src/lib/dialogueScene.ts
 *   • whether the facts are true → src/lib/historicalFactCheck.ts
 *   • who the host is           → src/lib/channelCharacter.ts
 *
 * Emitting fact-drops as CLAIMS rather than as sentences is the load-bearing
 * decision. A claim carries its subject QID/label, its Wikidata property and
 * its asserted value, which is what makes it checkable at all — a "fun fact"
 * that exists only as prose can be graded for tone and never for truth.
 *
 * Pure data + pure functions and prompt construction. The one bounded model
 * call lives in the block.
 */
import type { DialogueBeat } from "@/lib/dialogueScene";
import type { FactClaim } from "@/lib/historicalFactCheck";

export const POV_EPISODE_VERSION = "pov-episode/v1" as const;

export const POV_MIN_ITINERARY_ITEMS = 3;
export const POV_MAX_ITINERARY_ITEMS = 6;
export const POV_MIN_SEGMENTS = 3;
export const POV_MAX_SEGMENTS = 8;
export const POV_MAX_DIALOGUE_BEATS = 3;

/**
 * The register directive. Held as one exported constant, like
 * `AI_SPECULATIVE_FRAME` in src/lib/aiPersona.ts, so a test can assert it
 * survived into the composed prompt rather than trusting each caller.
 */
export const POV_VLOG_REGISTER =
  "You are the HOST, speaking to a camera you are holding yourself. First person, present tense, casual " +
  "spoken English — contractions, asides, self-interruption. You are a traveller who is amused, " +
  "uncomfortable and genuinely curious, not a narrator and not a historian. You never say \"we\" meaning " +
  "humanity, never say \"let us explore\", and never describe the scene in the third person. When something " +
  "is disgusting you say so. The humour is self-deprecating and comes from the gap between modern " +
  "expectations and what is actually here; it is never a joke AT the people of the period.";

/** One chunk of the episode between the itinerary and the sign-off. */
export interface PovSegment {
  id: string;
  /** Where this segment happens — drives the shot's setting. */
  location: string;
  /** The spoken narration for this segment, in character. */
  narration: string;
  /** Ids of fact claims delivered inside this segment's narration. */
  factClaimIds: string[];
  /** Id of the dialogue beat that occurs in this segment, if any. */
  dialogueBeatId?: string;
}

export interface PovEpisode {
  version: typeof POV_EPISODE_VERSION;
  title: string;
  /** The host's name, copied from the channel lock — never authored here. */
  hostName: string;
  /** Where and when, e.g. "London, 1536". */
  destination: string;
  /** Part 1 + 2: direct address and the first sensory reaction. */
  coldOpen: string;
  /** Part 3: what the host says they will do today, as spoken items. */
  itinerary: string[];
  /** Part 4 + 5: the body. */
  segments: PovSegment[];
  /** Part 6: in-character thanks to the real audience. */
  engagementLine: string;
  /** Part 7: the deadpan recap and goodnight. */
  signOff: string;
  /** Every checkable assertion the episode makes, extracted for verification. */
  factClaims: FactClaim[];
  /** Every conversation the episode calls for, for dialogue_scene to write. */
  dialogueBeats: DialogueBeat[];
}

function cleanString(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanList(value: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item, itemMax)).filter(Boolean).slice(0, max);
}

/**
 * Normalise a raw model response. NEVER throws: an unusable response must
 * become an episode that `povEpisodeDefects` rejects with a legible reason,
 * not a JSON parse error that says nothing about the writing.
 *
 * `hostName` is passed in from the channel lock and OVERWRITES whatever the
 * model returned. A model that renames the host has renamed the channel's
 * character, and accepting that even once is the drift this whole capability
 * exists to prevent.
 */
export function normalizePovEpisode(raw: unknown, args: {
  hostName: string;
  destination: string;
}): PovEpisode {
  const object = (raw ?? {}) as Record<string, unknown>;

  const factClaims: FactClaim[] = (Array.isArray(object["factClaims"]) ? object["factClaims"] : [])
    .flatMap((entry, index) => {
      const claim = (entry ?? {}) as Record<string, unknown>;
      const kind = claim["kind"] === "quantity" ? "quantity" : "year";
      const value = Number(claim["value"]);
      const property = cleanString(claim["property"], 12);
      const subject = cleanString(claim["subject"], 120);
      const text = cleanString(claim["text"], 400);
      if (!Number.isFinite(value) || !property || !subject || !text) return [];
      return [{
        id: cleanString(claim["id"], 40) || `fact-${String(index + 1).padStart(2, "0")}`,
        kind: kind as FactClaim["kind"],
        text,
        subject,
        value,
        property,
      }];
    })
    .slice(0, 12);
  const claimIds = new Set(factClaims.map((claim) => claim.id));

  const dialogueBeats: DialogueBeat[] = (Array.isArray(object["dialogueBeats"]) ? object["dialogueBeats"] : [])
    .flatMap((entry, index) => {
      const beat = (entry ?? {}) as Record<string, unknown>;
      const setting = cleanString(beat["setting"], 200);
      const counterparts = cleanList(beat["counterparts"], 3, 60);
      const intent = cleanString(beat["intent"], 300);
      if (!setting || !counterparts.length || !intent) return [];
      const targetSeconds = Number(beat["targetSeconds"]);
      return [{
        id: cleanString(beat["id"], 40) || `scene-${String(index + 1).padStart(2, "0")}`,
        setting,
        counterparts,
        intent,
        targetSeconds: Number.isFinite(targetSeconds) ? Math.max(20, Math.min(240, targetSeconds)) : 75,
      }];
    })
    .slice(0, POV_MAX_DIALOGUE_BEATS);
  const beatIds = new Set(dialogueBeats.map((beat) => beat.id));

  const segments: PovSegment[] = (Array.isArray(object["segments"]) ? object["segments"] : [])
    .flatMap((entry, index) => {
      const segment = (entry ?? {}) as Record<string, unknown>;
      const narration = cleanString(segment["narration"], 2_400);
      const location = cleanString(segment["location"], 160);
      if (!narration || !location) return [];
      const dialogueBeatId = cleanString(segment["dialogueBeatId"], 40);
      return [{
        id: cleanString(segment["id"], 40) || `segment-${String(index + 1).padStart(2, "0")}`,
        location,
        narration,
        // Dangling references are dropped rather than kept: a segment that
        // points at a claim or a beat that does not exist would silently break
        // the verification join downstream.
        factClaimIds: cleanList(segment["factClaimIds"], 6, 40).filter((id) => claimIds.has(id)),
        ...(dialogueBeatId && beatIds.has(dialogueBeatId) ? { dialogueBeatId } : {}),
      }];
    })
    .slice(0, POV_MAX_SEGMENTS);

  return {
    version: POV_EPISODE_VERSION,
    title: cleanString(object["title"], 120) || `${args.destination}: one day`,
    // Not negotiable, not model-supplied.
    hostName: args.hostName,
    destination: args.destination,
    coldOpen: cleanString(object["coldOpen"], 1_200),
    itinerary: cleanList(object["itinerary"], POV_MAX_ITINERARY_ITEMS, 200),
    segments,
    engagementLine: cleanString(object["engagementLine"], 600),
    signOff: cleanString(object["signOff"], 900),
    factClaims,
    dialogueBeats,
  };
}

/**
 * The structural gate. Each check corresponds to one part of the transcribed
 * spine, so "the episode is not in this format" fails here rather than being
 * discovered after narration has been paid for.
 */
export function povEpisodeDefects(episode: PovEpisode): string[] {
  const defects: string[] = [];
  const host = episode.hostName;

  if (!episode.coldOpen) {
    defects.push("episode has no cold open");
  } else {
    // Part 1: direct address, by name, immediately. Checked on the first ~200
    // characters because "I'm <name>" arriving in minute four is not a cold open.
    const opening = episode.coldOpen.slice(0, 220);
    if (!new RegExp(`\\b${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(opening)) {
      defects.push(`the cold open never says the host's name (${host}) — the format opens on direct address`);
    }
    if (!/\b(i|i'm|i am|i've)\b/i.test(opening)) {
      defects.push("the cold open is not in the first person");
    }
  }

  if (episode.itinerary.length < POV_MIN_ITINERARY_ITEMS) {
    defects.push(
      `episode states ${episode.itinerary.length} itinerary item(s); the format announces at least ${POV_MIN_ITINERARY_ITEMS} up front`,
    );
  }
  if (episode.segments.length < POV_MIN_SEGMENTS) {
    defects.push(`episode has ${episode.segments.length} segment(s); at least ${POV_MIN_SEGMENTS} are required`);
  }
  if (!episode.engagementLine) {
    defects.push("episode has no fourth-wall engagement line — the character thanking the real audience is part of the format");
  }
  if (!episode.signOff) {
    defects.push("episode has no sign-off recap");
  }

  // Part 4: the facts have to actually be IN the narration, and they have to be
  // delivered by the host. A claim recorded in `factClaims` but never spoken is
  // a fact the audience does not hear; a claim spoken but not recorded is a
  // fact nobody can check.
  const spokenIds = new Set(episode.segments.flatMap((segment) => segment.factClaimIds));
  const undelivered = episode.factClaims.filter((claim) => !spokenIds.has(claim.id));
  if (undelivered.length) {
    defects.push(
      `${undelivered.length} fact claim(s) are declared but never delivered in any segment (${undelivered.map((claim) => claim.id).join(", ")})`,
    );
  }
  if (episode.factClaims.length === 0) {
    defects.push("episode makes no checkable fact claims — an Education-category history vlog with no facts in it is a travelogue");
  }

  // Part 5: dialogue beats must be anchored to a segment, or nothing knows
  // where in the episode the conversation happens.
  const referencedBeats = new Set(
    episode.segments.map((segment) => segment.dialogueBeatId).filter(Boolean) as string[],
  );
  const orphanBeats = episode.dialogueBeats.filter((beat) => !referencedBeats.has(beat.id));
  if (orphanBeats.length) {
    defects.push(
      `${orphanBeats.length} dialogue beat(s) are not placed in any segment (${orphanBeats.map((beat) => beat.id).join(", ")})`,
    );
  }

  // Register: third-person narrator phrasing anywhere in the body means the
  // model reverted to documentary voice, which is the single most likely
  // failure and the one that destroys the format.
  const body = [episode.coldOpen, ...episode.segments.map((segment) => segment.narration)].join(" ");
  const NARRATOR_TELLS = [
    /\bin this video,? we\b/i,
    /\blet us explore\b/i,
    /\bjoin (?:me|us) as we (?:explore|delve|uncover)\b/i,
    /\bthis (?:documentary|film) (?:explores|examines)\b/i,
    /\bhistorians? (?:believe|tell us) that\b.*\bwe (?:will|shall)\b/i,
  ];
  const tells = NARRATOR_TELLS.filter((pattern) => pattern.test(body));
  if (tells.length) {
    defects.push(
      `the narration slips into documentary-narrator register (${tells.length} tell(s)) — this format is a person talking to a camera`,
    );
  }
  return defects;
}

export function assertPovEpisode(episode: PovEpisode): PovEpisode {
  const defects = povEpisodeDefects(episode);
  if (defects.length) throw new Error(`pov episode integrity: ${defects.join("; ")}`);
  return episode;
}

/**
 * Project the episode into the flat narration the TTS module consumes.
 *
 * `dialogueTextByBeat` supplies the written conversations. It is a parameter
 * rather than a field on the episode because THIS MODULE DOES NOT WRITE
 * DIALOGUE — it only knows where the dialogue goes. A beat with no text yet is
 * simply absent from the output, so this same function serves both the
 * pre-dialogue preview and the final assembly.
 *
 * Pure and deterministic: given the same episode and the same dialogue, it
 * produces the same narration, which is what makes it safe for a checkpoint
 * replay to re-run.
 */
export function povEpisodeNarration(
  episode: PovEpisode,
  dialogueTextByBeat: Readonly<Record<string, string>> = {},
): string {
  const parts: string[] = [episode.coldOpen];
  if (episode.itinerary.length) {
    parts.push(episode.itinerary.join(" "));
  }
  for (const segment of episode.segments) {
    parts.push(segment.narration);
    const dialogue = segment.dialogueBeatId ? dialogueTextByBeat[segment.dialogueBeatId] : undefined;
    if (dialogue) parts.push(dialogue);
  }
  parts.push(episode.engagementLine, episode.signOff);
  return parts.filter((part) => part && part.trim()).join("\n\n");
}

/** Project the episode into the `script` artifact shape the rest of the engine reads. */
export function povEpisodeScript(
  episode: PovEpisode,
  dialogueTextByBeat: Readonly<Record<string, string>> = {},
): { title: string; sections: Array<{ heading: string; narration: string }>; narrationText: string } {
  const sections: Array<{ heading: string; narration: string }> = [
    { heading: "Cold open", narration: episode.coldOpen },
    ...(episode.itinerary.length ? [{ heading: "Today's plan", narration: episode.itinerary.join(" ") }] : []),
    ...episode.segments.flatMap((segment) => {
      const dialogue = segment.dialogueBeatId ? dialogueTextByBeat[segment.dialogueBeatId] : undefined;
      return [
        { heading: segment.location, narration: segment.narration },
        ...(dialogue ? [{ heading: `${segment.location} — conversation`, narration: dialogue }] : []),
      ];
    }),
    { heading: "To the audience", narration: episode.engagementLine },
    { heading: "Sign-off", narration: episode.signOff },
  ].filter((section) => section.narration.trim());
  return {
    title: episode.title,
    sections,
    narrationText: povEpisodeNarration(episode, dialogueTextByBeat),
  };
}

/**
 * The one prompt this module owns. Structured so every instruction maps to a
 * check in `povEpisodeDefects` — the prompt asks for exactly what the gate
 * enforces, so the two cannot drift into "asks for X, rejects Y".
 */
export function povEpisodePrompt(args: {
  destination: string;
  hostName: string;
  /** The channel's own persona line, when it has one. */
  persona?: string;
  targetSeconds: number;
  dialogueBeats: number;
}): string {
  const { destination, hostName, persona, targetSeconds, dialogueBeats } = args;
  const segments = Math.max(POV_MIN_SEGMENTS, Math.min(POV_MAX_SEGMENTS, Math.round(targetSeconds / 110)));
  return [
    `Write one episode of a first-person time-travel history vlog.`,
    ``,
    `HOST: ${hostName}${persona ? ` — ${persona}` : ""}`,
    `DESTINATION: ${destination}`,
    `TARGET LENGTH: about ${Math.round(targetSeconds / 60)} minutes of spoken narration.`,
    ``,
    POV_VLOG_REGISTER,
    ``,
    `REQUIRED STRUCTURE:`,
    `1. coldOpen — greet the audience, say your name, say where and WHEN you have arrived. Then react`,
    `   physically to the place in the next breath: what it smells like, how cold it is, what you just stepped in.`,
    `   Funny and specific. Compare it unfavourably to something modern.`,
    `2. itinerary — ${POV_MIN_ITINERARY_ITEMS}-${POV_MAX_ITINERARY_ITEMS} spoken items: "today I want to..." Each one is a`,
    `   real place or activity available in this destination.`,
    `3. segments — ${segments} segments, one per itinerary item, each with a location and spoken narration.`,
    `   Facts are dropped INSIDE this narration, mid-scene, in your own voice ("fun fact, ...", "apparently..."),`,
    `   never as a detached aside. Never break into a narrator voice.`,
    `4. dialogueBeats — ${dialogueBeats} conversation(s) with NAMED historical figures who could plausibly be`,
    `   in this place at this time. For each, give the setting, who they are, and what YOU want out of the`,
    `   conversation. Do NOT write the dialogue itself — only the setup. Attach each beat to a segment via`,
    `   that segment's dialogueBeatId.`,
    `5. engagementLine — thank the audience for the channel's growth, IN CHARACTER, as if the channel exists`,
    `   inside the fiction. It should be slightly absurd that you are saying it here.`,
    `6. signOff — a deadpan list of what actually happened today, in the order it happened, then goodnight.`,
    ``,
    `FACT CLAIMS — READ THIS CAREFULLY:`,
    `Every fact you drop must ALSO be listed in factClaims with the structured fields needed to check it`,
    `against Wikidata. Only make claims of these two shapes:`,
    `  kind:"year"     — something happened in a year. property is the Wikidata property (e.g. P571 inception,`,
    `                    P569 date of birth, P570 date of death), subject is the entity, value is the year.`,
    `  kind:"quantity" — something measures N. property e.g. P2048 (height), P2043 (length), P1082 (population).`,
    `If you cannot express a fact in that form, DO NOT MAKE THE CLAIM — say something qualitative instead.`,
    `A claim that turns out to contradict the record will fail the episode outright, so prefer facts you are`,
    `confident about over facts that sound impressive.`,
    ``,
    `Return JSON only:`,
    `{"title":"...","coldOpen":"...","itinerary":["..."],`,
    ` "segments":[{"id":"segment-01","location":"...","narration":"...","factClaimIds":["fact-01"],"dialogueBeatId":"scene-01"}],`,
    ` "engagementLine":"...","signOff":"...",`,
    ` "factClaims":[{"id":"fact-01","kind":"year","text":"...","subject":"<entity name or QID>","property":"P571","value":1176}],`,
    ` "dialogueBeats":[{"id":"scene-01","setting":"...","counterparts":["..."],"intent":"...","targetSeconds":75}]}`,
  ].join("\n");
}
