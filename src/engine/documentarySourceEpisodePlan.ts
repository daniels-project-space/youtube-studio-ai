import { z } from "zod";

import {
  parseChannelProgramRouteRunSeed,
  type ChannelProgramRouteRunSeed,
} from "./channelProgramRoute";
import {
  ShortClaimEvidenceSchema,
  ShortSourceSchema,
  type ShortSource,
} from "./shortStrategyManifest";
import { canonicalJson } from "@/lib/canonicalJson";
import { sha256Hex } from "@/lib/sha256";

export const DOCUMENTARY_SOURCE_EPISODE_PLAN_VERSION =
  "documentary-source-episode-plan/v1" as const;
export const DOCUMENTARY_SOURCE_PROGRAM_ROUTE_KEY =
  "documentary-collage-short/source-season/v1" as const;

type StorySource = Readonly<{
  id: string;
  type: ShortSource["type"];
  title: string;
  citation: string;
  url: string;
  publisher: string;
  accessedAt: string;
}>;

type StoryBeat = readonly [narration: string, evidence: string, locator: string];

type StoryDefinition = Readonly<{
  key: string;
  topic: string;
  title: string;
  description: string;
  sceneSeed: string;
  source: StorySource;
  beats: readonly StoryBeat[];
}>;

const NASA_APOLLO_13: StorySource = Object.freeze({
  id: "nasa-apollo-13-mission-details",
  type: "primary",
  title: "Apollo 13: Mission Details",
  citation: "NASA, Apollo 13: Mission Details, mission history and accident findings.",
  url: "https://www.nasa.gov/missions/apollo/apollo-13-mission-details/",
  publisher: "NASA",
  accessedAt: "2026-09-08",
});

const NPS_CUYAHOGA_FIRE: StorySource = Object.freeze({
  id: "nps-cuyahoga-1969-fire",
  type: "primary",
  title: "The 1969 Cuyahoga River Fire",
  citation: "U.S. National Park Service, The 1969 Cuyahoga River Fire.",
  url: "https://www.nps.gov/articles/story-of-the-fire.htm",
  publisher: "U.S. National Park Service",
  accessedAt: "2026-09-08",
});

const LOC_BROOKLYN_BRIDGE: StorySource = Object.freeze({
  id: "loc-haer-brooklyn-bridge",
  type: "archive",
  title: "Brooklyn Bridge, Historic American Engineering Record NY-18",
  citation: "Library of Congress, Historic American Engineering Record NY-18.",
  url: "https://www.loc.gov/item/ny1234/",
  publisher: "Library of Congress",
  accessedAt: "2026-09-08",
});

const NPS_CREATION: StorySource = Object.freeze({
  id: "nps-agency-creation",
  type: "primary",
  title: "Creation of the National Park Service",
  citation: "U.S. National Park Service, Creation of the National Park Service.",
  url: "https://www.nps.gov/articles/npshistory-creation.htm",
  publisher: "U.S. National Park Service",
  accessedAt: "2026-09-08",
});

/**
 * A deliberately finite first source season. These are not prompts for a model
 * to improvise around: every narration beat is paired with the exact official
 * source section that supports it. Expanding the season is an editorial data
 * change with its own tests, not an unreviewed browser-search fallback.
 */
const SOURCE_SEASON: readonly StoryDefinition[] = Object.freeze([
  {
    key: "apollo-13-tank-chain",
    topic: "The overlooked test chain behind Apollo 13's oxygen-tank explosion",
    title: "The Test That Turned Apollo 13 Into a Rescue",
    description: "NASA's own mission record traces how a damaged oxygen tank passed through repair, testing, and a fatal voltage mismatch.",
    sceneSeed: "A scorched Apollo oxygen tank schematic, test log, voltage markings, and the spacecraft floating beyond Earth.",
    source: NASA_APOLLO_13,
    beats: [
      ["Apollo 13's crisis began years before launch, inside an oxygen tank already carrying a hidden history.", "NASA records that oxygen tank number two had previously been installed in the Apollo 10 service module.", "Mission Highlights — oxygen tank history"],
      ["The tank was removed for modification, and that removal accidentally dropped it by roughly two inches.", "NASA states that the tank was inadvertently dropped about two inches during removal for design changes.", "Mission Highlights — October 1968 removal"],
      ["Engineers repaired and tested it, then installed the same tank inside Apollo 13's service module.", "NASA records that the tank was fixed, factory-tested, installed in Apollo 13, and tested again.", "Mission Highlights — tank installation and testing"],
      ["But before launch it would not drain normally, so the team chose a different way to empty it.", "NASA reports that tank two stopped at 92 percent and resisted normal detanking procedures.", "Mission Highlights — Countdown Demonstration Test"],
      ["Ground power heated the tank for eight hours, using sixty-five volts to boil the oxygen away.", "NASA describes an eight-hour boil-off using 65-volt ground-support power.", "Mission Highlights — March 27 detanking"],
      ["A thermostat component had never been upgraded for that voltage, allowing extreme heat to damage insulation.", "NASA's accident summary says underrated thermostatic switches welded shut and nearby wiring reached damaging temperatures.", "Accident investigation — heater voltage mismatch"],
      ["The famous explosion was sudden, but NASA's record shows the failure chain had been accumulating quietly.", "NASA concludes that the damaged tank became a potential bomb when it was filled and used in flight.", "Accident investigation — board conclusion"],
    ],
  },
  {
    key: "apollo-13-lifeboat",
    topic: "How Apollo 13 turned a lunar lander into a lifeboat",
    title: "The Lifeboat Apollo 13 Was Never Meant to Need",
    description: "The lunar module was designed for a landing, yet improvised procedures stretched it into the crew's route home.",
    sceneSeed: "Apollo command and lunar modules separated into layered archival cutaways, with power gauges and a return path around the Moon.",
    source: NASA_APOLLO_13,
    beats: [
      ["Apollo 13 had just ended a calm television broadcast when an oxygen tank exploded nine minutes later.", "NASA places the explosion nine minutes after the crew ended its in-flight television broadcast.", "Mission Highlights — 55 hours 46 minutes"],
      ["The command module began losing oxygen, electricity, light, and water while far beyond immediate rescue.", "NASA reports the command module lost its normal electricity, light, and water supply about 200,000 miles from Earth.", "Mission Highlights — immediate systems loss"],
      ["Mission Control then considered the lunar module Aquarius as the only practical lifeboat available.", "NASA records Mission Control's decision to begin using the lunar module as a lifeboat.", "Mission Highlights — LM lifeboat decision"],
      ["Could a craft built for two astronauts and forty-five hours keep three people alive twice as long?", "NASA states that the lunar module's planned 45-hour lifetime had to be stretched to 90 hours.", "Mission Highlights — consumables assessment"],
      ["Controllers shut down noncritical systems and cut energy use to one fifth of the normal level.", "NASA reports that noncritical systems were turned off and consumption was reduced to one-fifth.", "Mission Highlights — power conservation"],
      ["They also wrote a command-module power-up procedure in three days instead of the usual three months.", "NASA describes flight controllers writing the cold command-module power-up procedure in three days rather than three months.", "Mission Highlights — command-module power-up"],
      ["Aquarius never reached the Moon's surface, but its unused capacity became the bridge that brought everyone home.", "NASA records that the crew left Aquarius shortly before the command module splashed down safely in the Pacific.", "Mission Highlights — jettison and splashdown"],
    ],
  },
  {
    key: "cuyahoga-small-fire-big-symbol",
    topic: "Why a short river fire became an enduring environmental symbol",
    title: "The River Fire That Became Bigger Than the Flames",
    description: "The 1969 Cuyahoga fire was brief and locally familiar; the story changed when imagery and national attention took over.",
    sceneSeed: "An oily river beneath a railroad bridge, newspaper halftones, a mayor's press tour, and smoke turning into headline clippings.",
    source: NPS_CUYAHOGA_FIRE,
    beats: [
      ["The Cuyahoga's famous 1969 fire was not a shocking first; the river had burned repeatedly before.", "NPS reports that the river had burned more than ten times over the previous century.", "The 1969 Cuyahoga River Fire — local history"],
      ["Debris collected near railroad bridges, oil made the surface flammable, and a train flare likely ignited it.", "NPS identifies trapped debris, oil, and a likely flare from an overpassing train as the ignition chain.", "The 1969 Cuyahoga River Fire — cause"],
      ["The flames lasted less than half an hour and caused only minor damage to the bridges.", "NPS states that the fire lasted under thirty minutes and caused minor railroad-bridge damage.", "The 1969 Cuyahoga River Fire — duration and damage"],
      ["So why did this small industrial fire outlive much larger disasters in the public imagination?", "NPS distinguishes the limited physical event from the much larger symbolic story that followed.", "The 1969 Cuyahoga River Fire — interpretation"],
      ["The next day, Mayor Carl Stokes led reporters through the polluted river corridor and reframed the event.", "NPS records Mayor Stokes leading a local press pollution tour on June 23, 1969.", "A Local Story Gains International Attention"],
      ["A later national magazine feature carried the burning-river image far beyond Cleveland's local news cycle.", "NPS says an August 1 Time feature helped national and international outlets pick up the story.", "A Local Story Gains International Attention"],
      ["The lasting power came from symbolism: a brief fire made an invisible pollution crisis impossible to ignore.", "NPS concludes that the fire remains relevant primarily as a symbol of water pollution and environmental change.", "Remembering the Fire"],
    ],
  },
  {
    key: "cuyahoga-causation-myth",
    topic: "The myth that one river fire created America's environmental laws",
    title: "The Clean-Water Myth Hidden Inside a Famous Fire",
    description: "The Cuyahoga fire mattered, but the official history shows policy, activism, and public attention were already converging.",
    sceneSeed: "A burning-river clipping split against earlier pollution laws, a Cleveland bond ballot, Earth Day crowds, and a Clean Water Act page.",
    source: NPS_CUYAHOGA_FIRE,
    beats: [
      ["A neat version of history says one burning river suddenly created America's modern environmental movement.", "NPS notes that popular retellings often cast the 1969 fire as a primary cause of later environmental milestones.", "Remembering the Fire — myth and memory"],
      ["The real timeline is messier, because federal pollution controls were already developing before the flames appeared.", "NPS identifies the Water Pollution Control Act of 1965 as a change already in motion.", "Remembering the Fire — changes already underway"],
      ["Cleveland voters had also approved a major local bond for sewer and water-treatment improvements in 1968.", "NPS records a 100-million-dollar Cleveland bond issue passed in 1968 for sewer and treatment upgrades.", "Remembering the Fire — local action"],
      ["And national media initially paid more attention to the much larger Santa Barbara oil spill that year.", "NPS states that the 1969 Santa Barbara oil spill received more media attention at the time.", "Remembering the Fire — national context"],
      ["Yet the Cuyahoga image persisted, appearing in textbooks and becoming shorthand for industrial pollution.", "NPS describes the fire's continued presence in textbooks and Cleveland's popular image.", "Remembering the Fire — cultural memory"],
      ["Public opinion shifted in 1970, alongside the first Earth Day and creation of the Environmental Protection Agency.", "NPS places the first Earth Day and EPA establishment within the broader 1970 shift in public opinion.", "Remembering the Fire — 1970 milestones"],
      ["The fire did not single-handedly write a law; it supplied a memorable symbol to an existing movement.", "NPS explicitly characterizes the direct-causation story as too simple while affirming the fire's symbolic importance.", "Remembering the Fire — conclusion"],
    ],
  },
  {
    key: "brooklyn-bridge-wire-system",
    topic: "The hidden wire system that made the Brooklyn Bridge a global model",
    title: "The Bridge Secret Hidden Inside Thousands of Wires",
    description: "The Brooklyn Bridge's influence came from a complete suspension system, not only its famous stone towers.",
    sceneSeed: "Brooklyn Bridge cable strands enlarging into engineering drawings, anchor plates, air-spun wires, and Gothic towers over the East River.",
    source: LOC_BROOKLYN_BRIDGE,
    beats: [
      ["When the Brooklyn Bridge opened in 1883, its immense span was longer than any bridge then standing anywhere.", "The HAER record says the Brooklyn Bridge was the world's longest-spanning bridge when it opened on May 24, 1883.", "HAER NY-18 — significance"],
      ["Its real legacy, however, was a complete suspension system that engineers around the world would copy widely.", "The Library of Congress record says the Roebling suspension system became a worldwide standard.", "HAER NY-18 — significance"],
      ["Massive cast-iron anchor plates were buried inside masonry to hold the bridge's cable chains.", "HAER documents cast-iron plates buried under masonry as the basis of the anchoring system.", "HAER NY-18 — anchoring system"],
      ["But how could builders turn many flexible strands into cables strong enough to carry a city?", "HAER explains that the cable system relied on large numbers of parallel wire strands.", "HAER NY-18 — cable construction"],
      ["They air-spun individual wires across the river, consolidated them, then wrapped them into solid cylinders.", "HAER records the air-spinning, consolidation, and wire-wrapping method used for the main cables.", "HAER NY-18 — air-spun cables"],
      ["Diagonal stays ran from the tower tops to stabilize the deck against severe vertical movement.", "HAER describes diagonal stay cables supporting the deck and stabilizing the system in severe winds.", "HAER NY-18 — diagonal stays"],
      ["The celebrated skyline silhouette was therefore an engineering diagram, with every visible line doing structural work.", "HAER presents the anchoring, main-cable, and stay-cable features as one influential structural system.", "HAER NY-18 — system significance"],
    ],
  },
  {
    key: "national-parks-letter",
    topic: "The complaint letter that recruited the future leader of America's national parks",
    title: "The Letter That Turned a Critic Into the Man in Charge",
    description: "Stephen Mather complained about park management; the Interior secretary's blunt reply redirected his career.",
    sceneSeed: "A 1914 complaint letter on a desk, Franklin Lane's reply, Stephen Mather boarding a train to Washington, and park posters filling a wall.",
    source: NPS_CREATION,
    beats: [
      ["In 1914, businessman and outdoorsman Stephen Mather wrote directly to Washington to complain about poor national-park management.", "NPS records Mather's 1914 complaint letter to Interior Secretary Franklin Lane.", "Campaign for a New Agency"],
      ["The reply was startlingly direct: if he disliked the system, he should come run it himself.", "NPS recounts Lane inviting Mather to Washington to take responsibility for improving park management.", "Campaign for a New Agency"],
      ["Mather accepted the challenge and became Lane's special assistant instead of remaining merely an outside critic.", "NPS states that Mather accepted the challenge and joined Lane as a special assistant.", "Campaign for a New Agency"],
      ["Could a complaint become an institution? Mather began organizing support for one unified parks bureau.", "NPS says Mather began building support for creation of a national parks bureau.", "Campaign for a New Agency"],
      ["He recruited railroad leaders seeking tourism and conservation groups seeking protection as unlikely allies.", "NPS identifies railroad directors, the Sierra Club, and the Audubon Society among Mather's allies.", "Campaign for a New Agency"],
      ["His relentless campaign sold both the parks' magnificence and their growing economic value to skeptical political leaders.", "NPS describes Mather's public-relations campaign stressing scenic importance and tourism value.", "Campaign for a New Agency"],
      ["Two years after the letter, President Woodrow Wilson signed the act creating the National Park Service.", "NPS dates the signing of the National Park Service Organic Act to August 25, 1916.", "Campaign for a New Agency"],
    ],
  },
  {
    key: "national-parks-double-mandate",
    topic: "The contradiction written into the National Park Service's founding mission",
    title: "The Contradiction America's Parks Were Built Around",
    description: "The founding law asked one agency to conserve extraordinary places and welcome people into them without impairment.",
    sceneSeed: "A split archival collage of protected wilderness and early touring automobiles joined by the 1916 Organic Act.",
    source: NPS_CREATION,
    beats: [
      ["National parks existed long before the National Park Service, but no single agency managed them as one coherent system.", "NPS explains that parks and monuments predated the agency and were affected by management controversies.", "Creation of the National Park Service — opening"],
      ["Even conservationists disputed whether protected land should also supply timber, water, and energy.", "NPS records disagreements among conservationists over timber, water, and energy use in parks.", "Creation of the National Park Service — management conflict"],
      ["Congressional approval of Yosemite's Hetch Hetchy dam sharpened calls for a dedicated federal parks agency.", "NPS identifies the 1913 Hetch Hetchy dam approval as evidence supporting a dedicated agency.", "Creation of the National Park Service — Hetch Hetchy"],
      ["The 1916 founding act then gave the new service two goals that could pull against each other.", "NPS describes the Organic Act as both a unified management system and a governing philosophy.", "Early Leadership — Organic Act"],
      ["It had to conserve scenery, historic objects, and wildlife while also providing public enjoyment.", "NPS summarizes the act's paired conservation and public-enjoyment duties.", "Early Leadership — statutory mission"],
      ["Early leaders encouraged cars, camps, hotels, museums, and recreation to build public support and funding.", "NPS documents early automobile access, concessions, recreation, museums, and tourism promotion.", "Getting People to the Parks"],
      ["The agency's enduring design problem was present at birth: invite people in without slowly using the place up.", "NPS frames early leadership around balancing preservation with visitor use for future generations.", "Early Leadership — preservation balance"],
    ],
  },
]);

const EpisodePlanSchema = z.object({
  version: z.literal(DOCUMENTARY_SOURCE_EPISODE_PLAN_VERSION),
  catalogRevision: z.literal("2026-09-08"),
  episodeKey: z.string().min(1).max(80),
  memoryKey: z.string().min(1).max(160),
  topic: z.string().min(1).max(220),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(600),
  sceneSeed: z.string().min(1).max(600),
  targetDurationSec: z.number().finite().min(35).max(60),
  narrationSegments: z.array(z.string().min(12).max(600)).length(7),
  narrationText: z.string().min(96).max(3_800),
  sourceReferences: z.array(ShortSourceSchema).min(1).max(4),
  claimEvidence: z.array(z.object({
    claimId: z.string().regex(/^claim:[1-7]$/),
    sourceId: z.string().min(1).max(160),
    excerpt: z.string().min(1).max(2_000),
    locator: z.string().min(1).max(500),
  }).strict()).length(7),
  sourceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  route: z.object({
    routeKey: z.literal(DOCUMENTARY_SOURCE_PROGRAM_ROUTE_KEY),
    routeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    contentLaneKey: z.literal("documentary_collage_short"),
  }).strict(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type DocumentarySourceEpisodePlan = z.infer<typeof EpisodePlanSchema>;

function planBody(
  definition: StoryDefinition,
  route: ChannelProgramRouteRunSeed,
  targetDurationSec: number,
) {
  const sourceReferences = [ShortSourceSchema.parse(definition.source)];
  const narrationSegments = definition.beats.map(([narration]) => narration.trim());
  const claimEvidence = definition.beats.map(([, excerpt, locator], index) => ({
    claimId: `claim:${index + 1}`,
    sourceId: definition.source.id,
    excerpt: ShortClaimEvidenceSchema.parse({
      sourceId: definition.source.id,
      excerpt,
      locator,
    }).excerpt,
    locator,
  }));
  const narrationText = narrationSegments.join(" ");
  const wordCount = narrationText.split(/\s+/).filter(Boolean).length;
  const minimumWords = Math.ceil(targetDurationSec * 1.84);
  if (wordCount < minimumWords || wordCount > 150) {
    throw new Error(
      `documentary source episode ${definition.key} needs ${minimumWords}-150 spoken words for ` +
      `${targetDurationSec} seconds; received ${wordCount}`,
    );
  }
  const sourceSnapshotSha256 = sha256Hex(canonicalJson({
    sourceReferences,
    claimEvidence,
    accessedAt: definition.source.accessedAt,
  }));
  return {
    version: DOCUMENTARY_SOURCE_EPISODE_PLAN_VERSION,
    catalogRevision: "2026-09-08" as const,
    episodeKey: definition.key,
    memoryKey: `documentary-source-season:${definition.key}`,
    topic: definition.topic,
    title: definition.title,
    description: definition.description,
    sceneSeed: definition.sceneSeed,
    targetDurationSec,
    narrationSegments,
    narrationText,
    sourceReferences,
    claimEvidence,
    sourceSnapshotSha256,
    route: {
      routeKey: DOCUMENTARY_SOURCE_PROGRAM_ROUTE_KEY,
      routeFingerprint: route.routeFingerprint,
      contentLaneKey: "documentary_collage_short" as const,
    },
  };
}

function assertedRoute(value: unknown): ChannelProgramRouteRunSeed {
  const route = parseChannelProgramRouteRunSeed(value);
  if (
    route.routeKey !== DOCUMENTARY_SOURCE_PROGRAM_ROUTE_KEY ||
    route.family !== "documentary_collage_short" ||
    route.contentLaneKey !== "documentary_collage_short"
  ) {
    throw new Error("documentary source season requires its exact frozen program route");
  }
  return route;
}

function definitionForTopic(topic: string): StoryDefinition | undefined {
  const normalized = topic.trim().toLowerCase();
  return SOURCE_SEASON.find((definition) =>
    definition.topic.toLowerCase() === normalized || definition.title.toLowerCase() === normalized,
  );
}

export function documentarySourceSeasonCandidates(args: {
  readonly count: number;
  readonly avoidTopics?: readonly string[];
}): readonly Readonly<{
  topic: string;
  title: string;
  description: string;
  sceneSeed: string;
}>[] {
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 7) {
    throw new Error("documentary source season count must be an integer from 1 to 7");
  }
  const avoided = new Set((args.avoidTopics ?? []).map((topic) => topic.trim().toLowerCase()).filter(Boolean));
  const available = SOURCE_SEASON.filter((definition) =>
    !avoided.has(definition.topic.toLowerCase()) && !avoided.has(definition.title.toLowerCase()),
  );
  if (available.length < args.count) {
    throw new Error(
      `documentary source season has ${available.length} unused reviewed episode(s), fewer than the requested ${args.count}; ` +
      "add reviewed official-source entries instead of repeating or inventing a topic",
    );
  }
  return available.slice(0, args.count).map((definition) => Object.freeze({
    topic: definition.topic,
    title: definition.title,
    description: definition.description,
    sceneSeed: definition.sceneSeed,
  }));
}

export function buildDocumentarySourceEpisodePlan(args: {
  readonly topic?: string;
  readonly entropy?: string;
  readonly usedMemoryKeys?: readonly string[];
  readonly targetDurationSec?: number;
  readonly route: unknown;
}): DocumentarySourceEpisodePlan {
  const route = assertedRoute(args.route);
  const targetDurationSec = args.targetDurationSec ?? 52;
  if (!Number.isFinite(targetDurationSec) || targetDurationSec < 35 || targetDurationSec > 60) {
    throw new Error("documentary source episode target duration must be 35-60 seconds");
  }
  const used = new Set(args.usedMemoryKeys ?? []);
  let definition: StoryDefinition | undefined;
  if (args.topic?.trim()) {
    definition = definitionForTopic(args.topic);
    if (!definition) {
      throw new Error(
        "documentary source season received a topic without a reviewed source episode plan",
      );
    }
  } else {
    const available = SOURCE_SEASON.filter((candidate) =>
      !used.has(`documentary-source-season:${candidate.key}`),
    );
    if (!available.length) {
      throw new Error(
        "documentary source season is complete; add reviewed official-source entries before another run",
      );
    }
    const entropy = args.entropy?.trim() || "documentary-source-season";
    const index = Number.parseInt(sha256Hex(entropy).slice(0, 8), 16) % available.length;
    definition = available[index];
  }
  const body = planBody(definition, route, targetDurationSec);
  return EpisodePlanSchema.parse({
    ...body,
    fingerprint: sha256Hex(canonicalJson(body)),
  });
}

export function assertDocumentarySourceEpisodePlan(
  value: unknown,
  expectedRoute?: unknown,
): DocumentarySourceEpisodePlan {
  const plan = EpisodePlanSchema.parse(value);
  const { fingerprint: _fingerprint, ...body } = plan;
  void _fingerprint;
  if (plan.fingerprint !== sha256Hex(canonicalJson(body))) {
    throw new Error("documentary source episode plan fingerprint is invalid");
  }
  const definition = SOURCE_SEASON.find((candidate) => candidate.key === plan.episodeKey);
  if (!definition) throw new Error("documentary source episode is not in the reviewed source season");
  const route = expectedRoute === undefined
    ? undefined
    : assertedRoute(expectedRoute);
  if (route && plan.route.routeFingerprint !== route.routeFingerprint) {
    throw new Error("documentary source episode plan belongs to a different frozen program route");
  }
  const rebuilt = planBody(definition, route ?? ({
    routeKey: DOCUMENTARY_SOURCE_PROGRAM_ROUTE_KEY,
    routeFingerprint: plan.route.routeFingerprint,
    family: "documentary_collage_short",
    contentLaneKey: "documentary_collage_short",
  } as ChannelProgramRouteRunSeed), plan.targetDurationSec);
  if (canonicalJson(rebuilt) !== canonicalJson(body)) {
    throw new Error("documentary source episode plan differs from its reviewed catalog definition");
  }
  return plan;
}
