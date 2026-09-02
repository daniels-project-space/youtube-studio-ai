import type { ThumbnailPlaybook, VisualLanguage } from "@/lib/thumbnailLab";

/**
 * A channel identity cannot be a collection of aspirational prompt prose.
 * This is the small, reviewable subset that must survive all the way from
 * playbook resolution to art direction, provider prompting, and the mobile
 * admission gate.  `requiredSceneEvidence` describes visible facts, not
 * stylistic preferences; `reviewCriteria` is deliberately phrased so the
 * reviewer can answer true/false from pixels at browse size.
 */
export interface ThumbnailIdentityContract {
  version: "thumbnail-channel-identity/v1";
  profile: string;
  requiredSceneEvidence: readonly string[];
  prohibitedVisualPatterns: readonly string[];
  reviewCriteria: readonly string[];
}

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
  contract: ThumbnailIdentityContract;
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
    contract: {
      version: "thumbnail-channel-identity/v1",
      profile: "investory-editorial-realism",
      requiredSceneEvidence: [
        "A believable adult human decision or tactile financial artifact visibly enacts the title's exact wealth mechanism.",
        "The scene still communicates a concrete financial consequence when the headline is covered.",
        "The dominant material reads as photographed paper, property, cash-flow object, or human-scale evidence rather than a digital asset.",
      ],
      prohibitedVisualPatterns: [
        "Generic floating coins, neon market charts, holographic dashboards, anonymous gold bars, luxury filler, video-game art, or a glossy 3D product render.",
      ],
      reviewCriteria: [
        "The exact financial mechanism in the title is visibly enacted by a believable human or tactile real-world artifact, not merely named by the headline.",
        "With the headline mentally covered, the image communicates a specific financial consequence rather than generic money, coins, charts, or luxury imagery.",
        "The candidate reads as grounded financial editorial realism and contains no game UI, neon finance cliché, or product-render aesthetic.",
      ],
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
    contract: {
      version: "thumbnail-channel-identity/v1",
      profile: "gratitude-springs-human-sanctuary",
      requiredSceneEvidence: [
        "A serene human or environmental sanctuary visibly expresses the episode's exact emotional promise.",
        "Water, mist, light, foliage, sky, or quiet human presence is used as a tactile calm cue where it fits the topic.",
      ],
      prohibitedVisualPatterns: [
        "A repeated rock-pile or paired-stones hero for an unrelated topic, synthetic wellness UI, plastic 3D props, or generic spa stock.",
      ],
      reviewCriteria: [
        "The calm scene expresses the video's specific emotional promise instead of relying on a repeated stones motif.",
        "If stones appear, they are incidental scenery rather than the dominant hero unless the title makes grounding or balance the literal subject.",
        "The image reads as dignified, tactile meditation photography rather than synthetic wellness stock or fantasy-game art.",
      ],
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
    contract: {
      version: "thumbnail-channel-identity/v1",
      profile: "chalk-compound-causal-teaching",
      requiredSceneEvidence: [
        "A human hand is visibly drawing the explanation in white chalk on a tactile dark board.",
        "For tax videos, a hand-drawn allocation visibly connects the take-home share and tax share in one causal teaching diagram.",
        "The board, chalk dust, and diagram carry the educational story even when the headline is covered.",
      ],
      prohibitedVisualPatterns: [
        "A chalkless illustration, passive board, glossy 3D icons, game UI, neon HUD, generic classroom clip art, tiny equations, or disconnected symbols.",
      ],
      reviewCriteria: [
        "A human hand is actively drawing with white chalk on a real-looking dark tactile board; chalk is not a small decorative prop.",
        "For a tax topic, the board contains one readable non-textual causal allocation that makes the tax split or take-home consequence visually clear without the headline.",
        "All supporting marks read as one coherent hand-drawn chalk explanation with dust and erased edges, never as a game interface, glossy icon set, or unrelated diagram.",
      ],
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
    contract: {
      version: "thumbnail-channel-identity/v1",
      profile: "inked-histories-engraved-action",
      requiredSceneEvidence: [
        "One human historical action, artifact recovery, danger, discovery, or consequence is visibly staged at the peak moment.",
        "Tactile cross-hatching, aged paper, charcoal depth, and a restrained ember-gold or rust proof detail anchor the illustration.",
      ],
      prohibitedVisualPatterns: [
        "AAA adventure-game key art, glossy 3D character models, RPG inventory props, comic-panel grids, speech bubbles, UI overlays, or decorative artifact-only scenes.",
      ],
      reviewCriteria: [
        "The candidate is an authored historical ink-and-charcoal illustration with tangible cross-hatching and aged physical print texture, not a photoreal adventure-game or glossy poster image.",
        "A single historical action, danger, discovery, or consequence is clear at mobile size; a disconnected relic or decorative object alone is insufficient.",
        "Any ember-gold or rust accent acts as one restrained proof detail and does not overwhelm the historic ink language.",
      ],
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
    contract: {
      version: "thumbnail-channel-identity/v1",
      profile: "lofi-rendered-frame-only",
      requiredSceneEvidence: [
        "The dominant artwork is the exact still sampled from this video's completed rendered scene.",
        "Only one truthful compact 4K quality emblem may be added in its reserved corner.",
      ],
      prohibitedVisualPatterns: [
        "A separately generated generic scene, replacement illustration, headline, mood label, or alteration outside the allowed 4K emblem.",
      ],
      reviewCriteria: [
        "The thumbnail artwork is the exact finished-video frame rather than a regenerated or generic Lo-Fi image.",
        "No added copy or image alteration appears outside one truthful compact 4K emblem in its reserved corner.",
      ],
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
    identityContract: profile.contract,
    rules: unique([...args.playbook.rules, ...profile.rules]),
    avoid: unique([...args.playbook.avoid, ...profile.avoid]),
  };
}
