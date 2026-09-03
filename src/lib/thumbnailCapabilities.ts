/**
 * THUMBNAIL CAPABILITY REGISTRY.
 *
 * Each capability below was learned from a specific failure, and every one of
 * them is WRONG somewhere else. A worm's-eye tilt-up rescues an icon channel
 * and ruins a meditation channel. A comparison layout rescues a "vs" video and
 * destroys a single-hero story. The sober tier rescues a death toll and drains
 * a cozy channel.
 *
 * So the point of this file is not the capabilities — those live in their own
 * modules — it is the ROUTING: one reviewable place that says when each one may
 * fire, why, and what it would break if it fired on the wrong channel. A
 * capability that cannot state its own blast radius does not belong here.
 *
 * Everything is a pure function of the title and channel-declared identity, so
 * routing is deterministic and testable without paying for an image.
 */
import type { SubjectClass } from "@/lib/thumbnailStoryInterest";

export type CapabilityId =
  | "subject_class_hero"
  | "vantage_worm_tilt_up"
  | "energy_sober"
  | "layout_comparison"
  | "photo_cutout_collage"
  | "provider_fal_required";

export interface ThumbnailCapability {
  id: CapabilityId;
  summary: string;
  appliesWhen: string;
  /** What it damages if it fires on a channel that did not ask for it. */
  risk: string;
}

export const THUMBNAIL_CAPABILITIES: readonly ThumbnailCapability[] = [
  {
    id: "subject_class_hero",
    summary: "Who owns the hero slot: the icon, the person, or a human at the moment of consequence.",
    appliesWhen: "The channel identity declares subjectClass. Channels that do not declare one keep the original human-agency scoring.",
    risk: "Forcing `icon` on a story channel would demote people to scenery; forcing `person` on an object channel would invent a face the video is not about.",
  },
  {
    id: "vantage_worm_tilt_up",
    summary: "Ground-level camera tilted steeply up so the subject looms over the viewer.",
    appliesWhen: "subjectClass is `icon`. Offered but never defaulted elsewhere.",
    risk: "On a meditation, finance or document channel a heroic upward tilt reads as grandiose and breaks a calm or editorial register.",
  },
  {
    id: "energy_sober",
    summary: "Restrained treatment — true colour, narrow tonal range, no tabloid devices — while the moment itself stays charged.",
    appliesWhen: "The title names grave material: deaths, a disaster, a fatality, victims, a terminal illness. Detected from the title, overriding the channel's usual tier for that one video.",
    risk: "Applied broadly it drains the saturation that a spectacle or cozy_pop channel depends on; applied never, a channel puts hype on a death toll and reads as tasteless.",
  },
  {
    id: "layout_comparison",
    summary: "Two subjects as two separate photographs butted along a hard seam, each half labelled by its own headline word.",
    appliesWhen: "The title is an explicit two-sided construction — an X vs Y separator, or a known paired idiom such as before-and-after.",
    risk: "A loose trigger is the dangerous one: matching a bare word like 'reality' would split single-hero stories in half and destroy them. The detector deliberately requires an explicit two-sided form.",
  },
  {
    id: "photo_cutout_collage",
    summary: "Die-cut photo cutout of the subject over a designed collage, rather than one continuous rendered scene.",
    appliesWhen: "The channel declares composition `cutout_collage` — the expose and commentary register.",
    risk: "On a cinematic or meditation channel a cut-out composite destroys the continuous world the channel sells.",
  },
  {
    id: "provider_fal_required",
    summary: "Route generation through fal rather than the Gemini Developer API.",
    appliesWhen: "subjectClass is `person`, where the thumbnail depends on a recognizable real likeness.",
    risk: "The Gemini Developer API refuses a recognizable real person with finishReason=IMAGE_OTHER. Re-pointing a person channel at that endpoint to save a few cents silently breaks the entire channel, and the failure looks like a module bug rather than a provider policy.",
  },
] as const;

/**
 * Grave material, kept deliberately TIGHT. A loose list here would drain the
 * saturation out of ordinary dramatic topics — "The £40,000 Pension Mistake" is
 * dramatic, not grave, and must keep its bold tier.
 */
const GRAVE_SUBJECT = [
  "killed", "kills", "died", "dies", "death", "deaths", "dead", "fatal",
  "fatality", "fatalities", "victim", "victims", "casualties", "disaster",
  "tragedy", "massacre", "atrocity", "famine", "epidemic", "pandemic",
  "suicide", "murdered", "manslaughter", "terminal", "cancer", "collapsed",
  "drowned", "buried alive", "mass grave", "war crime", "genocide",
];

/**
 * An explicit two-sided construction. This is deliberately strict: an earlier
 * version matched bare words like "reality", "promised" and "what actually",
 * which fired on ordinary single-hero titles such as "The Reality Of Retiring
 * At 55" and would have split them down the middle.
 */
export function isComparisonTitle(title: string): boolean {
  const normalized = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const separators = [" vs ", " versus "];
  const pairedIdioms = [
    " before and after ", " then and now ", " then vs now ",
    " expectation vs reality ", " promise vs reality ",
    " compared to ", " side by side ",
  ];
  if (separators.some((marker) => normalized.includes(marker))) return true;
  if (pairedIdioms.some((marker) => normalized.includes(marker))) return true;
  // "what they said ... what they did" style: both halves must be present.
  return normalized.includes(" what they said ") && normalized.includes(" what they ");
}

export function isGraveSubject(title: string): boolean {
  const normalized = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  return GRAVE_SUBJECT.some((word) => normalized.includes(` ${word} `));
}

export interface ResolvedThumbnailCapabilities {
  active: CapabilityId[];
  /** Human-readable justification per capability, for the render log. */
  reasons: string[];
  /** Overrides the channel's usual energy tier for this one video. */
  energyOverride?: "sober";
  /** Layout is no longer the art director's judgement call. */
  forcedLayout?: "comparison";
  /** Suggested camera position when the art director does not choose one. */
  defaultVantage?: "worm_tilt_up";
  /** Provider the channel must generate through. */
  requiredProviderRoute?: "fal";
}

/**
 * Decide which capabilities apply to ONE video on ONE channel. Pure, so the
 * whole routing table can be regression-tested against every existing channel
 * without generating anything.
 */
export function resolveThumbnailCapabilities(args: {
  title: string;
  subjectClass?: SubjectClass;
  composition?: string;
}): ResolvedThumbnailCapabilities {
  const active: CapabilityId[] = [];
  const reasons: string[] = [];
  const out: ResolvedThumbnailCapabilities = { active, reasons };

  if (args.subjectClass) {
    active.push("subject_class_hero");
    reasons.push(`channel declares subjectClass=${args.subjectClass}`);
  }

  if (args.subjectClass === "icon") {
    active.push("vantage_worm_tilt_up");
    reasons.push("icon subject: a low camera tilted up is what makes the structure loom rather than merely appear");
    out.defaultVantage = "worm_tilt_up";
  }

  if (args.subjectClass === "person") {
    active.push("provider_fal_required");
    reasons.push("person subject: the Gemini Developer API refuses a recognizable real likeness, the fal route does not");
    out.requiredProviderRoute = "fal";
  }

  if (args.composition === "cutout_collage") {
    active.push("photo_cutout_collage");
    reasons.push("channel composition is cutout_collage: photo cutout over designed collage, not a continuous scene");
  }

  if (isGraveSubject(args.title)) {
    active.push("energy_sober");
    reasons.push("title names grave material: restrained treatment, charged moment, no hype devices");
    out.energyOverride = "sober";
  }

  if (isComparisonTitle(args.title)) {
    active.push("layout_comparison");
    reasons.push("title is an explicit two-sided construction: layout is forced rather than left to the art director");
    out.forcedLayout = "comparison";
  }

  return out;
}
