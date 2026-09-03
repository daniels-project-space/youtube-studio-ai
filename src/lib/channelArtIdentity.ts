/**
 * Pure channel-art identity derivation shared by server-side rendering and the
 * client channel workspace. Keeping it free of provider/storage dependencies
 * means what the operator sees is exactly the identity sent to the renderer.
 */

export interface ArtIdentity {
  name: string;
  persona?: string;
  styleGrammar?: string;
  palette?: string[];
  niche?: string;
  iconicMotif?: string;
  vibe?: string;
  worldSetting?: string;
  worldComposition?: string;
  worldMotifs?: string[];
  visualAvoid?: string[];
}

export interface ChannelArtIdentitySource {
  name: string;
  identity?: {
    persona?: unknown;
    styleGrammar?: unknown;
    palette?: unknown;
    niche?: unknown;
    creativeBrief?: {
      iconicMotif?: unknown;
      vibe?: unknown;
    } | null;
  } | null;
  styleDNA?: {
    setting?: unknown;
    composition?: unknown;
    motifs?: unknown;
    visualAvoid?: unknown;
  } | null;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .map(nonEmptyText)
    .filter((candidate): candidate is string => Boolean(candidate));
  return values.length ? values : undefined;
}

/**
 * A channel name can carry a concrete visual promise. Imported or renamed
 * channels occasionally retain an older show's DNA (for example a seaside
 * channel with a rainy-city room). These are semantic rules, not slug maps:
 * a clear world word in any present or future channel name must be visible in
 * its channel art while the fuller DNA is being re-grounded.
 */
function nameBoundArtWorld(identity: ArtIdentity): Partial<ArtIdentity> {
  const name = identity.name.toLowerCase();
  if (/\b(seaside|coast(?:al)?|ocean|shore|beach|harbour|harbor)\b/u.test(name)) {
    return {
      persona: "a quiet, non-identifiable study figure in a hand-painted coastal world",
      styleGrammar: "hand-painted storybook animation, tactile watercolor skies, calm cinematic coastal light",
      palette: ["#0a2940", "#1d7894", "#74c6c4", "#f3d39a", "#f7efe0"],
      iconicMotif: "a single quiet figure beside an open seaside window, framed by surf and distant coastal roofs",
      vibe: "salt-air calm, gentle wonder, and unhurried focus",
      worldSetting: "a hand-painted seaside study above a living coastline, with unmistakable ocean, surf, coves, and sunlit coastal rooftops",
      worldComposition: "a compact quiet figure in the central safe area, framed by an open coastal window; wide ocean and sky carry the outer banner",
      worldMotifs: ["turquoise surf", "weathered pier posts", "paper sailboat", "salt-soft linen curtain", "coastal wildflowers"],
      visualAvoid: ["rainy neon bedroom", "generic headphones-at-a-desk scene", "city-only window view", "photorealistic CGI"],
    };
  }
  if (/\b(drift|drifting)\b/u.test(name)) {
    return {
      persona: "a quiet, non-identifiable study figure inside a slow-moving sky observatory",
      styleGrammar: "hand-painted atmospheric animation, soft paper texture, luminous cloud depth, calm cinematic daylight",
      palette: ["#10263f", "#466e93", "#a6d6dd", "#efd2a1", "#f8f3e8"],
      iconicMotif: "an open field notebook whose loose page becomes a small paper glider above an ocean of clouds",
      vibe: "weightless concentration, quiet momentum, and room to think",
      worldSetting: "a hand-painted high-altitude study observatory drifting through a vast morning cloudscape, with no coastline or enclosed bedroom",
      worldComposition: "one compact study figure and a paper glider in the center safe area; layered clouds, distant sun, and open sky fill the wide banner",
      worldMotifs: ["paper glider", "field notebook", "sunlit cloud layers", "quiet brass observatory rail", "slow-moving curtains"],
      visualAvoid: ["rainy neon bedroom", "generic headphones-at-a-desk scene", "seaside window", "generic city skyline", "photorealistic CGI"],
    };
  }
  if (/\b(neon|rainy|rain)\b/u.test(name) && /\b(lofi|lo-fi|music)\b/u.test(name)) {
    return {
      persona: "a quiet, non-identifiable late-night listener in a rain-washed city refuge",
      styleGrammar: "rich hand-painted nocturne, restrained neon reflections, tactile ink and watercolor, cinematic rain light",
      palette: ["#070d1f", "#1a3d66", "#4c81b7", "#cc5d88", "#f0c98f"],
      iconicMotif: "a single glowing cassette player reflected in a rain-slicked window overlooking a softened night city",
      vibe: "late-night warmth, softened rain, and a private pulse of focus",
      worldSetting: "a hand-painted rain-lit listening room above a living night city, with unmistakable wet glass, reflected signs, and a distant transit glow",
      worldComposition: "one small cassette-player focal point inside the safe area; window reflections and blurred city color form the outer banner",
      worldMotifs: ["rain-slicked window", "glowing cassette player", "soft transit light", "reflected signage", "ink-blue rain"],
      visualAvoid: ["seaside window", "generic headphones-at-a-desk scene", "daytime coffee desk", "photorealistic CGI"],
    };
  }
  if (/\binvestory\b/u.test(name)) {
    return {
      persona: "a patient financial historian tracing durable capital through time",
      styleGrammar: "sober heritage-finance editorial art, archival texture, cinematic institutional depth",
      palette: ["#0a1224", "#273f68", "#c69f42", "#e7dfc8", "#52758a"],
      iconicMotif: "an antique bronze key whose teeth trace a compound-growth curve across an archival ledger",
      vibe: "earned insight, long-horizon conviction, and durable value",
      worldSetting: "an illuminated archival market archive of ledgers, price tapes, and patient human decision-making",
      worldComposition: "one central institutional object with layered data-like depth and a distant exchange hall; never a lifestyle desk",
      worldMotifs: ["engraved ledger lines", "bronze key", "long-horizon growth curve", "aged exchange tickets"],
      visualAvoid: ["coffee desk", "generic trading monitors", "LoFi room", "neon cyberpunk", "broker lifestyle photography"],
    };
  }
  if (/\bchalk\b/u.test(name)) {
    return {
      styleGrammar: "precise chalk-and-paper financial explainer, tactile charcoal marks on a real tax work surface",
      worldSetting: "a focused tax-planning worktable with a deep charcoal chalkboard, ruled ledgers, and one clean hand-drawn framework",
      worldComposition: "one legible chalk framework anchors the safe area; supporting tax records stay deliberately sparse",
      worldMotifs: ["chalk tax brackets", "ruled ledger paper", "compound curve", "eraser dust"],
      visualAvoid: ["generic game UI", "video-game glow", "unrelated stock-market screens", "coffee-shop desk"],
    };
  }
  return {};
}

export function channelArtIdentityFromSource(source: ChannelArtIdentitySource): ArtIdentity {
  const identity = source.identity ?? {};
  const styleDNA = source.styleDNA ?? {};
  const derived: ArtIdentity = {
    name: source.name,
    ...(nonEmptyText(identity.persona) ? { persona: nonEmptyText(identity.persona) } : {}),
    ...(nonEmptyText(identity.styleGrammar) ? { styleGrammar: nonEmptyText(identity.styleGrammar) } : {}),
    ...(textList(identity.palette) ? { palette: textList(identity.palette) } : {}),
    ...(nonEmptyText(identity.niche) ? { niche: nonEmptyText(identity.niche) } : {}),
    ...(nonEmptyText(identity.creativeBrief?.iconicMotif)
      ? { iconicMotif: nonEmptyText(identity.creativeBrief?.iconicMotif) }
      : {}),
    ...(nonEmptyText(identity.creativeBrief?.vibe)
      ? { vibe: nonEmptyText(identity.creativeBrief?.vibe) }
      : {}),
    ...(nonEmptyText(styleDNA.setting) ? { worldSetting: nonEmptyText(styleDNA.setting) } : {}),
    ...(nonEmptyText(styleDNA.composition)
      ? { worldComposition: nonEmptyText(styleDNA.composition) }
      : {}),
    ...(textList(styleDNA.motifs) ? { worldMotifs: textList(styleDNA.motifs) } : {}),
    ...(textList(styleDNA.visualAvoid) ? { visualAvoid: textList(styleDNA.visualAvoid) } : {}),
  };
  // Name-bound worlds intentionally replace stale imported values as a whole;
  // merging would leave contradictory cues such as "rainy bedroom" beside a
  // required seaside world in the same provider prompt.
  return { ...derived, ...nameBoundArtWorld(derived) };
}
