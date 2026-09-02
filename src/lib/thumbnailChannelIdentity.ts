import type { ThumbnailPlaybook, VisualLanguage } from "@/lib/thumbnailLab";

/**
 * Channel-specific visual truths that are stronger than a generic thumbnail
 * pattern. They are applied at render time as an additive guard, so a stored
 * research playbook still owns its references, palette and composition while
 * old generic language cannot leak back into newly rendered candidates.
 */
type IdentityProfile = Readonly<{
  names: readonly string[];
  rules: readonly string[];
  avoid: readonly string[];
  visualLanguage?: Partial<VisualLanguage>;
}>;

const PROFILES: readonly IdentityProfile[] = [
  {
    names: ["investory"],
    rules: [
      "Investory is grounded financial editorial realism: use a recognizable real-world wealth mechanism, adult human decision, or tactile financial artifact that literally enacts this video's subject.",
      "Vary the visual world by topic—retirement, housing, work, cash flow, risk, inheritance, ownership and market consequence must not collapse into the same coins-and-chart image.",
      "A viewer must understand the specific financial tension with the text covered; the scene is a believable editorial photograph, not a metaphorical product render.",
    ],
    avoid: [
      "video-game, mobile-game, casino, or glossy 3D asset-store aesthetics",
      "generic floating coins, neon stock charts, holographic dashboards, anonymous gold bars, or unrelated luxury filler",
      "an abstract finance object that cannot explain the title's actual mechanism",
    ],
    visualLanguage: {
      imageStyle: "premium realistic financial editorial photograph, tactile real-world materials, decisive human-scale consequence, restrained navy-black and gold grade",
      composition: "full_scene",
    },
  },
  {
    names: ["gratitude springs"],
    rules: [
      "Gratitude Springs must feel like a real, deeply calm sanctuary rather than a single repeated spa prop. Rotate among still water, gentle human presence, misty landscape, quiet breath, moonlight, botanical shelter and soft dawn when the topic supports them.",
      "For embodiment or emotional-release topics, a serene adult woman floating or resting naturally in water is an allowed primary subject; preserve dignity, anatomy and a genuine meditative mood.",
      "Use river stones only when the episode's specific emotional idea is companionship, grounding, balance or a clearly justified physical metaphor—not as the default channel emblem.",
    ],
    avoid: [
      "repeating paired stones as the default thumbnail for unrelated meditations",
      "generic spa stock, synthetic wellness UI, plastic-looking 3D objects, or a game-like fantasy landscape",
      "an empty decorative calm scene that does not express the meditation's actual promise",
    ],
    visualLanguage: {
      imageStyle: "hyperreal cinematic meditation photography, natural water and atmospheric light, tactile human or environmental serenity, restrained blue and moonlit contrast",
      composition: "full_scene",
    },
  },
  {
    names: ["chalk & compound", "chalk and compound"],
    rules: [
      "Chalk & Compound must visibly show a human hand actively drawing the explanation in white chalk on a dark tactile board; the chalk act is part of the channel identity, never optional decoration.",
      "For tax topics, draw a clear non-textual tax mechanism—such as a bracketed share flowing from pay into a public-service symbol, a tax-calendar decision, or an honest before-and-after take-home split—so the image is specifically about taxation even without reading the hook.",
      "Every supporting symbol must look hand-drawn with chalk dust, erased edges and a coherent causal teaching diagram rather than unrelated icons.",
    ],
    avoid: [
      "video-game interface, glossy 3D icons, neon HUDs, or generic classroom clip art",
      "a chalkless illustration, a passive chalkboard, or an unrelated abstract maze for a tax explanation",
      "extra written props, fake equations, UI labels, or tiny unreadable detail",
    ],
    visualLanguage: {
      imageStyle: "premium hand-drawn editorial chalkboard illustration with an active human chalk hand, charcoal board grain, bright chalk dust and physically drawn causal diagrams",
      composition: "full_scene",
    },
  },
  {
    names: ["inked histories"],
    rules: [
      "Inked Histories is an original premium historical ink illustration: bold black linework, tangible cross-hatching, aged paper, charred edges and restrained ember-gold or rust proof details when the story warrants them.",
      "Stage one human historical action, artifact recovery, danger, discovery or consequence with dramatic editorial depth. It should feel authored like a high-craft illustrated history cover, never like a game cut-scene.",
      "Keep the visual language consistent across episodes while changing the actual historical subject, moment and proof detail for every story.",
    ],
    avoid: [
      "video-game concept art, glossy 3D character models, RPG inventory props, comic-panel grids, speech bubbles, or UI overlays",
      "flat beige parchment with a disconnected decorative object and no historical action",
      "literal reuse of any selected reference scene, headline or character",
    ],
    visualLanguage: {
      imageStyle: "original high-craft historical ink-and-charcoal editorial illustration on aged paper, tactile cross-hatching, dramatic chiaroscuro and restrained ember-gold proof accents",
      composition: "full_scene",
    },
  },
  {
    names: ["lofi", "lo-fi"],
    rules: [
      "Lo-Fi thumbnails must use the exact sampled frame from this video's finished rendered scene as their dominant artwork; only the truthful 4K quality emblem may be added in its reserved corner.",
    ],
    avoid: [
      "a separately generated generic Lo-Fi scene, replacement illustration, title treatment, mood label, or any alteration of the source frame outside the 4K emblem",
    ],
    visualLanguage: {
      imageStyle: "exact immutable rendered Lo-Fi video frame with a compact 4K quality emblem only",
      composition: "full_scene",
    },
  },
];

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

/**
 * Apply the known channel's durable craft requirements at the final common
 * resolver. This covers normal runs, weekly planning and thumbnail-refresh
 * successor candidates without rewriting any saved channel record.
 */
export function applyThumbnailChannelIdentity(args: {
  channelName: string;
  playbook: ThumbnailPlaybook;
}): ThumbnailPlaybook {
  const channel = compact(args.channelName);
  const profile = PROFILES.find((candidate) => candidate.names.some((name) => channel.includes(compact(name))));
  if (!profile) return args.playbook;

  return {
    ...args.playbook,
    visualLanguage: {
      ...args.playbook.visualLanguage,
      ...profile.visualLanguage,
    },
    rules: unique([...args.playbook.rules, ...profile.rules]),
    avoid: unique([...args.playbook.avoid, ...profile.avoid]),
  };
}
