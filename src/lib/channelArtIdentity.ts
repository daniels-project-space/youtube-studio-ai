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
