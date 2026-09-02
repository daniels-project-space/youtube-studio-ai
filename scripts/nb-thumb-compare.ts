/**
 * Build the EXACT production Nano Banana Pro thumbnail prompt for three channel
 * types, using the real channel-thumbnail module (identity resolver + brief
 * builder + golden craft bar + owner A/B preferences).
 *
 * Output: /tmp/nb-compare/prompts.json — one frozen prompt per channel, so every
 * Nano Banana version receives byte-identical input.
 *
 * Pass a textObject key as argv[2] to force one signature type treatment across
 * all three channels (e.g. `metal_monolith`) and write prompts-<key>.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { buildThumbBrief, type ThumbBriefArgs } from "@/lib/banana";
import { applyThumbnailChannelIdentity } from "@/lib/thumbnailChannelIdentity";
import {
  GOLDEN_THUMBNAIL_CRAFT_RULES,
  OWNER_SELECTED_THUMBNAIL_PREFERENCE_RULES,
} from "@/lib/thumbnailGoldenStandard";
import type { ThumbnailPlaybook, VisualLanguage } from "@/lib/thumbnailLab";

const forcedTextObject = process.argv[2] as VisualLanguage["textObject"] | undefined;

const emptyPlaybook = (): ThumbnailPlaybook => ({
  source: "style_dna_foundation",
  energy: "bold",
  visualLanguage: {},
  rules: [],
  avoid: [],
  patterns: [],
  refsUsed: [],
  distilledAt: Date.now(),
});

const set = process.argv[3] ?? "core";

interface ChannelCase {
  id: string;
  set?: "core" | "heist";
  channelType: string;
  channelName: string;
  title: string;
  /** Frozen stand-in for the art director's STEP-2b staged scene. */
  scene: string;
  lines: { text: string; payoff?: boolean; accent?: boolean }[];
  baseColor: string;
  accentColor: string;
  energy: NonNullable<ThumbnailPlaybook["energy"]>;
}

const CASES: ChannelCase[] = [
  {
    id: "investory",
    channelType: "Finance / editorial explainer",
    channelName: "Investory",
    title: "The £40,000 Pension Mistake Nobody Warns You About",
    scene:
      "LAYOUT MODE: split composition; hero opposite the chosen type zone. " +
      "HERO PROP (dominant, 30-50% of frame, cropped close): a man in his late fifties at a kitchen table, " +
      "one hand pressed flat on a printed pension statement while the other tears the corner of the page away, " +
      "his face lit hard from a low window, jaw set in the instant he understands the number. " +
      "BACKGROUND (separate supporting layer behind the hero - darker, simpler, depth): an out-of-focus suburban " +
      "kitchen sinking into navy shadow, a cold grey morning beyond the blinds. " +
      "STORY DETAILS (symbolic, on/around the hero): the torn corner of the statement falling as a thin gold-lit " +
      "sliver; a cooling mug of tea with an untouched skin on it.",
    lines: [
      { text: "£40,000", accent: true, payoff: true },
      { text: "GONE QUIETLY", accent: false },
    ],
    baseColor: "#0B1220",
    accentColor: "#D8A11A",
    energy: "bold",
  },
  {
    id: "inked-histories",
    channelType: "History / illustrated narrative",
    channelName: "Inked Histories",
    title: "The Night Rome's Treasury Vanished",
    scene:
      "LAYOUT MODE: split composition; hero opposite the chosen type zone. " +
      "HERO PROP (dominant, 30-50% of frame, cropped close): a Roman treasury guard wrenching open an iron-banded " +
      "strongbox at the peak of the discovery, the lid flung back, his lantern arm thrown wide, mouth open in the " +
      "half-second before he shouts, the box interior utterly empty. " +
      "BACKGROUND (separate supporting layer behind the hero - darker, simpler, depth): a vaulted stone undercroft " +
      "receding into deep cross-hatched blackness, one collapsed shelf, torchlight raking the columns. " +
      "STORY DETAILS (symbolic, on/around the hero): a single coin still spinning on the flagstones catching an " +
      "ember-gold highlight; a snapped chain swinging from the strongbox hasp.",
    lines: [
      { text: "EMPTY", accent: true, payoff: true },
      { text: "BY DAWN", accent: false },
    ],
    baseColor: "#141110",
    accentColor: "#C2761F",
    energy: "spectacle",
  },
  {
    id: "gratitude-springs",
    channelType: "Meditation / wellness",
    channelName: "Gratitude Springs",
    title: "Let The Water Take The Weight",
    scene:
      "LAYOUT MODE: centered hero at peak action; reserve asymmetric clean pockets around its silhouette for " +
      "native typography. HERO PROP (dominant, 30-50% of frame, cropped close): a serene adult woman floating on " +
      "her back in still dark water, face calm and turned to the sky, arms open and released, hair fanned out, " +
      "the surface tension breaking into slow rings around her shoulders. " +
      "BACKGROUND (separate supporting layer behind the hero - darker, simpler, depth): a moonlit spring under " +
      "low mist, dark treeline dissolving into blue night, one cold band of light across the water. " +
      "STORY DETAILS (symbolic, on/around the hero): concentric ripples spreading outward from her released hands; " +
      "a faint breath of steam rising off the warm water into the cold air.",
    lines: [
      { text: "JUST FLOAT", accent: true, payoff: true },
      { text: "10 MINUTES", accent: false },
    ],
    baseColor: "#0A1A26",
    accentColor: "#8FD3E8",
    energy: "cozy_pop",
  },
  // Centred-hero test set. Both scenes deliberately put the subject dead centre
  // and met head-on, to check the layout reads as powerful rather than as a
  // flat title card.
  {
    id: "vault-breach",
    set: "heist",
    channelType: "Heist / technical documentary",
    channelName: "Vault Breach",
    title: "The Bank That Was Robbed Through Its Own Wall",
    scene:
      "LAYOUT MODE: centered hero at peak action; reserve asymmetric clean pockets around its silhouette for " +
      "native typography. HERO PROP (dominant, 30-50% of frame, cropped close): met dead head-on at the end of a " +
      "one-point-perspective service corridor, a steel vault door fills the centre of the frame while two gloved " +
      "hands drive a diamond core drill into its lock collar at the exact moment the bit breaks through, concrete " +
      "dust jetting back toward the lens. " +
      "BACKGROUND (separate supporting layer behind the hero - darker, simpler, depth): the corridor walls and " +
      "ceiling converge symmetrically into the vault door, lit by one hard caged worklight, everything else " +
      "falling into cold black. " +
      "STORY DETAILS (symbolic, on/around the hero): a bright cone of concrete dust hanging in the worklight; a " +
      "severed padlock shackle lying on the floor in the near foreground.",
    lines: [
      { text: "18 INCHES", accent: true, payoff: true },
      { text: "OF CONCRETE", accent: false },
    ],
    baseColor: "#0C0F12",
    accentColor: "#E0663A",
    energy: "bold",
  },
  // The same video after the story-interest gate rejected "18 INCHES OF
  // CONCRETE": the number now measures human audacity (how long they lived
  // next door) instead of a barrier, and the hero is a person at the moment of
  // consequence rather than a tool on a surface.
  {
    id: "vault-breach-lifted",
    set: "heist",
    channelType: "Heist / technical documentary",
    channelName: "Vault Breach",
    title: "The Bank That Was Robbed Through Its Own Wall",
    scene:
      "LAYOUT MODE: centered hero at peak action; reserve asymmetric clean pockets around its silhouette for " +
      "native typography. HERO PROP (dominant, 30-50% of frame, cropped close): met dead head-on and centred, a " +
      "dust-caked man in overalls kneels in the stripped back room of a rented shop at the mouth of a hand-dug " +
      "tunnel through the party wall, one arm braced on the broken brickwork, a work lamp swinging in his other " +
      "hand, his face turned straight to the lens in the instant the last course gives way. " +
      "BACKGROUND (separate supporting layer behind the hero - darker, simpler, depth): the shop's back room " +
      "converging symmetrically around him — a folding cot, a camping stove, months of takeaway cartons stacked " +
      "against peeling wallpaper — everything beyond falling into cold black. " +
      "STORY DETAILS (symbolic, on/around the hero): the black void of the bank vault opening beyond the broken " +
      "wall behind him; a paper calendar on the wall with weeks of days crossed off in pen.",
    lines: [
      { text: "6 MONTHS", accent: true, payoff: true },
      { text: "NOBODY NOTICED", accent: false },
    ],
    baseColor: "#0C0F12",
    accentColor: "#E0663A",
    energy: "bold",
  },
  {
    id: "getaway-files",
    set: "heist",
    channelType: "Heist / retro period caper",
    channelName: "The Getaway Files",
    title: "The Airport Switch That Fooled Everyone",
    scene:
      "LAYOUT MODE: centered hero at peak action; reserve asymmetric clean pockets around its silhouette for " +
      "native typography. HERO PROP (dominant, 30-50% of frame, cropped close): a man in a wide-lapel 1970s suit " +
      "sits dead centre at an airport lounge table facing the lens square on, holding the camera's gaze while his " +
      "shoe pushes an identical tan briefcase across the carpet to the case already there, caught mid-swap. " +
      "BACKGROUND (separate supporting layer behind the hero - darker, simpler, depth): a symmetrical 1970s " +
      "terminal lounge receding behind him, warm tungsten downlights haloing into the lens, out-of-focus " +
      "travellers reduced to soft period shapes. " +
      "STORY DETAILS (symbolic, on/around the hero): the two identical case handles almost touching in the near " +
      "foreground; a boarding card and a cold coffee cup on the table catching the light.",
    lines: [
      { text: "THE SWITCH", accent: true, payoff: true },
      { text: "60 SECONDS", accent: false },
    ],
    baseColor: "#1A130C",
    accentColor: "#D9A441",
    energy: "bold",
  },
];

function buildPrompt(c: ChannelCase) {
  // 1. The real identity resolver injects visualLanguage, identityContract,
  //    rules and avoid for this channel.
  const playbook = applyThumbnailChannelIdentity({
    channelName: c.channelName,
    playbook: { ...emptyPlaybook(), energy: c.energy },
  });
  const vl = playbook.visualLanguage ?? {};
  const identityContract = playbook.identityContract;

  // 2. Same identityDirection block renderCandidate() builds.
  const identityDirection = identityContract
    ? `CHANNEL IDENTITY CONTRACT (non-negotiable; reject a scene that misses any visible fact):\n` +
      `MUST SHOW:\n- ${identityContract.requiredSceneEvidence.join("\n- ")}\n` +
      `MUST NOT SHOW:\n- ${identityContract.prohibitedVisualPatterns.join("\n- ")}`
    : "";

  // 3. Same ThumbBriefArgs renderCandidate() assembles at the native route.
  const brief: ThumbBriefArgs = {
    channelName: c.channelName,
    imageStyle: vl.imageStyle,
    palette: [c.baseColor, c.accentColor],
    accentColor: c.accentColor,
    textObject: forcedTextObject
      ?? vl.textObject
      ?? (vl.treatment === "sticker" ? "grunge_sticker"
        : vl.treatment === "stamp" ? "stamp_ink"
          : vl.treatment === "neon" ? "neon_sign"
            : vl.treatment === "plate" ? "block_plate"
              : vl.font === "serif" ? "paint_smear"
                : "movie_poster"),
    composition: vl.composition,
    scene: c.scene,
    lines: c.lines,
    badge: c.channelName,
  };

  // 4. Identical concatenation to thumbnailLab.ts renderCandidate() L1064-1066.
  const prompt =
    `${buildThumbBrief(brief)} ${identityDirection} USER-APPROVED GOLDEN CRAFT BAR: ${GOLDEN_THUMBNAIL_CRAFT_RULES.join(" ")} ` +
    `OWNER-SELECTED A/B PREFERENCES: ${OWNER_SELECTED_THUMBNAIL_PREFERENCE_RULES.join(" ")}`;

  return {
    id: c.id,
    channelType: c.channelType,
    channelName: c.channelName,
    title: c.title,
    energy: c.energy,
    textObject: brief.textObject,
    identityProfile: identityContract?.profile ?? null,
    expectWords: c.lines.map((l) => l.text),
    promptUtf8Bytes: Buffer.byteLength(prompt, "utf8"),
    prompt,
  };
}

const out = CASES.filter((c) => (c.set ?? "core") === set).map(buildPrompt);
mkdirSync("/tmp/nb-compare", { recursive: true });
const suffix = `${forcedTextObject ? `-${forcedTextObject}` : ""}${set === "core" ? "" : `-${set}`}`;
const target = `/tmp/nb-compare/prompts${suffix}.json`;
writeFileSync(target, JSON.stringify(out, null, 2));
for (const p of out) {
  console.log(`${p.id.padEnd(20)} textObject=${String(p.textObject).padEnd(16)} bytes=${p.promptUtf8Bytes} words=${p.expectWords.join("/")}`);
}
console.log(`wrote ${target}`);
