/**
 * THUMBNAIL LAB Ã¢â‚¬â€ evidence Ã¢â€ â€™ rules Ã¢â€ â€™ tournament Ã¢â€ â€™ comparative validation.
 *
 * The one-shot "generate and pass/fail" approach produced competent-but-stale
 * thumbnails. The lab works the way winning channels work:
 *
 *  1. VERIFY EVIDENCE Ã¢â‚¬â€ pull the highest-VIEW competitor thumbnails the
 *     research already scraped, then vision-screen them: only genuinely
 *     on-positioning, high-craft references survive (the architect flagged
 *     reference pollution as a BLOCKING gap Ã¢â‚¬â€ this is its repair).
 *  2. DISTILL RULES Ã¢â‚¬â€ vision-deconstruct WHY each verified winner clicks
 *     (composition, focal device, text treatment, color story), then have the
 *     showrunner synthesize a persistent per-channel PLAYBOOK: hard rules +
 *     three named, executable patterns. Stored on the channel Ã¢â‚¬â€ the "devises
 *     rules out of that" loop, made durable.
 *  3. TOURNAMENT Ã¢â‚¬â€ per video, instantiate ALL patterns into real candidates
 *     (FLUX base + Remotion typography layer, not drawtext) and judge them
 *     COMPARATIVELY against the verified references in a simulated feed.
 *     The winner ships; scores + reasons persist.
 */
import { join } from "node:path";
import { parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { visionLocal } from "@/lib/vision";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { hasBanana } from "@/lib/banana";

import { imageToJpeg } from "@/lib/ffmpeg";
import { downloadTo } from "@/lib/files";
import type { StyleDNA } from "@/engine/creative/types";

type Logger = (msg: string, extra?: Record<string, unknown>) => void;

/** Distilled 2026 CTR research Ã¢â‚¬â€ the judge's and synthesizer's ground truth. */
export const RESEARCH_PRINCIPLES = [
  "Ã¢â€°Â¤3 visual elements; the tone+topic must read in under 1 second (clutter costs ~23% CTR).",
  "2-3 bold complementary colors; the subject 30%+ brighter or darker than the background.",
  "Faceless niches win with ONE dramatic hero object against a clean ground + a Ã¢â€°Â¤4-word callout.",
  "Finance: NUMBER-FORWARD Ã¢â‚¬â€ one specific number as the credibility trigger, occupying 15-20% of the canvas, upper third, white/gold on dark (data-literate audiences click specifics, not adjectives).",
  "Navy/charcoal base + gold/white accents = institutional authority palette for finance.",
  "Text: bold sans-serif ONLY, 1-3 words (5 absolute max), NEVER restating the title Ã¢â‚¬â€ it adds the curiosity the title doesn't.",
  "Documentary annotation language (Vox/Johnny Harris school): muted cinematic base + ONE editorial annotation device (accent underline, circled element, arrow) in the accent color.",
  "Consistent per-channel styling lifts subscriber CTR 15-20%: lock palette + text position family; vary the hero object and the number.",
  "Honest framing only Ã¢â‚¬â€ false-promise thumbnails decay channel-wide recommendations.",
  "THE 120px SQUINT TEST: most first views are ~120px wide on mobile Ã¢â‚¬â€ mood, subject, and text must all survive there; if it's a muddy blur, the design is wrong.",
  "SAFE ZONES: never place text/key elements in the bottom-right (duration timestamp) or bottom-left (chapter markers) corners; keep critical content off extreme edges.",
  "Max 6 words on the image, and saturate beyond real life Ã¢â‚¬â€ thumbnails compete with bright UI.",
] as const;

export interface VerifiedRef {
  path: string;
  url: string;
  views: number;
  craft: number;
  why: string;
}

export interface ThumbPattern {
  name: string;
  when: string;
  /** Scene recipe for the FLUX base Ã¢â‚¬â€ text-free, with <PLACEHOLDERS>. */
  fluxRecipe: string;
  /** ThumbText prop template (placeholders in line texts / numberCallout). */
  textRecipe: Record<string, unknown>;
}

/** The channel's UNMISTAKABLE typographic + rendering identity. */
export interface VisualLanguage {
  font?: "impact" | "marker" | "bebas" | "serif" | "rounded";
  treatment?: "plate" | "sticker" | "stamp" | "neon" | "clean";
  baseColor?: string;
  accentColor?: string;
  /** Base-image rendering style, e.g. "vintage ink engraving on parchment". */
  imageStyle?: string;
  badgeStyle?: "center" | "pill";
  /** TYPE-AS-OBJECT treatment: typography rendered as a physical designed
   * object in the scene (torn strips / paint smear / censor bar / sticker),
   * never plain floating text. The single biggest craft lever. */
  textObject?:
    | "torn_strip" | "paint_smear" | "censor_bar" | "grunge_sticker" | "spaced_elegant" | "block_plate"
    | "neon_sign" | "spray_paint" | "stamp_ink" | "movie_poster" | "ransom_note" | "carved";
  /** cutout_collage = hero is a die-cut PHOTO cutout over a designed collage
   * background (the anti-AI-look device for commentary/persona channels);
   * full_scene = one continuous rendered scene. */
  composition?: "cutout_collage" | "full_scene";
  uppercase?: boolean;
  /** recraft = the FULL frame (art + typography + layout) designed as ONE
   * generation by the design-tuned Recraft V3 model — the strongest one-pass
   * path, kills the text-pasted-on-top look; integrated = words generated AS
   * PART of the artwork (Ideogram typography engine); layered = compositor
   * type on top (deterministic control). */
  renderMode?: "recraft" | "integrated" | "layered" | "template";
  /** Locked layout subset from the template pack (docs/THUMB_TEMPLATES.md). */
  templates?: string[];
}

export interface ThumbnailPlaybook {
  /** Clickbait ENERGY tier (identity-chosen): spectacle = over-the-top
   * impossible-scale drama; bold = strong grounded punch; cozy_pop = charming
   * saturated warmth. ALL are catchy Ã¢â‚¬â€ none are sleepy. */
  energy?: "spectacle" | "bold" | "cozy_pop";
  /** Channel-constant visual language (font/treatment/colors/image style). */
  visualLanguage?: VisualLanguage;
  rules: string[];
  avoid: string[];
  patterns: ThumbPattern[];
  refsUsed: { url: string; views: number; why: string }[];
  distilledAt: number;
}

/* --------------------- 0. acquire fresh references --------------------- */

/**
 * Direct, positioning-true reference acquisition Ã¢â‚¬â€ the repair for polluted
 * niche scrapes (the catalog-keyword scrape returned 0 verifiable references
 * for Investory). The lab derives search queries from the channel's OWN
 * positioning, pulls top-VIEW videos straight from YouTube, and lets the
 * vision screen do the final verification.
 */
export interface AcquiredRef {
  url: string;
  views: number;
  videoId: string;
  title: string;
}

export async function acquireReferences(args: {
  channelName: string;
  positioning: string;
  niche?: string;
  log?: Logger;
}): Promise<AcquiredRef[]> {
  const log = args.log ?? (() => {});
  if (!hasAnthropicKey()) throw new Error("thumbnailLab: ANTHROPIC_API_KEY required");
  const q = await claudeJson<{ queries?: string[] }>({
    maxTokens: 400,
    temperature: 0.4,
    system: "You are a YouTube competitive-research strategist. Return ONLY JSON.",
    prompt:
      `Channel: "${args.channelName}"${args.niche ? ` (${args.niche})` : ""}.\nPositioning: ${args.positioning}\n\n` +
      `Write 4 YouTube SEARCH QUERIES that surface the videos of TRUE comparable channels Ã¢â‚¬â€ same tier, same ` +
      `format, same audience promise (NOT adjacent hustle/clickbait verticals). Concrete video-search phrasing ` +
      `(what a viewer of those channels actually searches), 2-5 words each. ` +
      `Return STRICT JSON {"queries":string[]}.`,
  });
  const queries = (q.queries ?? []).filter(Boolean).slice(0, 4);
  if (!queries.length) throw new Error("thumbnailLab: no reference search queries derived");
  log(`thumbnailLab: acquiring references via ${queries.length} positioning-true queries: ${queries.join(" | ")}`);

  const { searchVideoIds, fetchVideoDetails } = await import("@/lib/youtubeData");
  const ids = new Set<string>();
  for (const query of queries) {
    try {
      for (const id of await searchVideoIds({ query, maxResults: 12 })) ids.add(id);
    } catch (e) {
      log(`thumbnailLab: search "${query}" failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  const details = await fetchVideoDetails([...ids]);
  // Channel diversity: max 2 references per channel, ranked by views.
  const perChannel = new Map<string, number>();
  const picks: AcquiredRef[] = [];
  for (const d of details.sort((a, b) => (b.views ?? 0) - (a.views ?? 0))) {
    const url = d.thumbnailUrl;
    if (!url) continue;
    const n = perChannel.get(d.channelId) ?? 0;
    if (n >= 2) continue;
    perChannel.set(d.channelId, n + 1);
    picks.push({ url, views: d.views ?? 0, videoId: d.youtubeVideoId, title: d.title });
    if (picks.length >= 16) break;
  }
  log(`thumbnailLab: acquired ${picks.length} fresh reference candidates from ${perChannel.size} channels`);
  return picks;
}

/* ------------------------- 1. verify references ------------------------ */

export async function verifyReferences(args: {
  candidates: { url: string; views: number }[];
  channelName: string;
  positioning: string;
  tmpDir: string;
  log?: Logger;
}): Promise<VerifiedRef[]> {
  const log = args.log ?? (() => {});
  if (!hasGeminiKey()) throw new Error("thumbnailLab: GEMINI_API_KEY required");
  const top = args.candidates
    .filter((c) => c.url)
    .sort((a, b) => b.views - a.views)
    .slice(0, 12);
  const paths: { path: string; url: string; views: number }[] = [];
  for (let i = 0; i < top.length; i++) {
    try {
      paths.push({
        path: await downloadTo(top[i].url, join(args.tmpDir, `ref_${i}.jpg`)),
        url: top[i].url,
        views: top[i].views,
      });
    } catch { /* unreachable url Ã¢â‚¬â€ skip */ }
  }
  if (paths.length < 3) throw new Error(`thumbnailLab: only ${paths.length} reference thumbnails reachable`);

  const raw = await visionLocal({
    prompt:
      `These are ${paths.length} thumbnails from the HIGHEST-VIEW videos scraped in this niche, in order.\n` +
      `Channel being built: "${args.channelName}" Ã¢â‚¬â€ positioning: ${args.positioning}\n\n` +
      `For EACH image (1-${paths.length}): does it belong to the same PREMIUM/CINEMATIC tier and positioning ` +
      `(vs hustle-bro, crypto-pump, shocked-face tabloid, or low-craft clickbait)? Score craft 1-10 ` +
      `(composition, typography, color discipline). Return STRICT JSON ` +
      `{"refs":[{"idx":1-based,"onBrand":boolean,"craft":1-10,"why":"<=15 words"}]} Ã¢â‚¬â€ judge every image.`,
    imagePaths: paths.map((p) => p.path),
    json: true,
    // 12 per-ref verdicts truncate at small budgets ("Expected ','" parse flake)
    maxTokens: 3200,
  });
  const parsed = parseJsonLoose<{ refs?: { idx?: number; onBrand?: boolean; craft?: number; why?: string }[] }>(raw);
  const verdicts = parsed.refs ?? [];
  const verified: VerifiedRef[] = [];
  const craftOnly: VerifiedRef[] = [];
  for (const v of verdicts) {
    const i = (v.idx ?? 0) - 1;
    if (i < 0 || i >= paths.length) continue;
    if (v.onBrand && (v.craft ?? 0) >= 6) {
      verified.push({ ...paths[i], craft: v.craft ?? 6, why: v.why ?? "" });
    } else if ((v.craft ?? 0) >= 6) {
      craftOnly.push({ ...paths[i], craft: v.craft ?? 6, why: `craft-only evidence (off-brand): ${v.why ?? ""}` });
    }
  }
  verified.sort((a, b) => b.craft - a.craft || b.views - a.views);
  log(`thumbnailLab: ${verified.length}/${paths.length} references VERIFIED on-brand+high-craft (rest rejected as pollution)`);
  // BRAND-DIVERGENCE ESCAPE: a deliberately unique look (the whole point of the
  // DNA) can mean NO niche thumbnail reads as on-brand. The playbook gets its
  // look from the DNA; references only evidence what clickbait CRAFT wins in
  // the niche - so top off with high-craft off-brand winners, loudly labelled.
  if (verified.length < 3 && craftOnly.length) {
    craftOnly.sort((a, b) => b.craft - a.craft || b.views - a.views);
    const need = Math.min(3 - verified.length + 1, craftOnly.length);
    verified.push(...craftOnly.slice(0, need));
    log(`thumbnailLab: brand-divergent niche - grounding on ${need} high-craft OFF-BRAND winners as craft evidence (look stays DNA-locked)`);
  }
  // 2 refs + DNA still grounds a playbook (the DNA owns the look; refs only
  // evidence niche craft) - below that the scrape is genuinely useless.
  if (verified.length === 2) {
    log("thumbnailLab: thin evidence (2 refs) - proceeding, playbook leans harder on DNA + craft principles");
  }
  if (verified.length < 2) {
    throw new Error(
      `thumbnailLab: only ${verified.length} verified references Ã¢â‚¬â€ the scraped niche set is too polluted to ground a playbook (re-run niche research with corrected queries)`,
    );
  }
  return verified.slice(0, 6);
}

/* --------------------------- 2. distill rules --------------------------- */

export async function distillPlaybook(args: {
  refs: VerifiedRef[];
  dna: StyleDNA | null;
  channelName: string;
  positioning: string;
  log?: Logger;
}): Promise<ThumbnailPlaybook> {
  const log = args.log ?? (() => {});
  // Vision deconstruction Ã¢â‚¬â€ WHY each verified winner clicks.
  if (args.refs.length === 0) {
    log("thumbnailLab: ZERO references (search quota dead?) - distilling from DNA + craft principles only");
  }
  const deconRaw = args.refs.length === 0 ? '{"decon":[]}' : await visionLocal({
    prompt:
      `Deconstruct WHY each of these ${args.refs.length} proven high-view thumbnails wins the click. ` +
      `For each (1-${args.refs.length}): composition (focal placement, negative space), hero device ` +
      `(object/face/number/chart), text treatment (word count, casing, colors, position, any accent word), ` +
      `color story (base + accents), annotation devices (underline/circle/arrow/glow), and the curiosity ` +
      `mechanism. Be CONCRETE (hex-ish colors, word counts, positions). Return STRICT JSON ` +
      `{"decon":[{"idx":number,"composition":string,"hero":string,"text":string,"colors":string,"devices":string,"curiosity":string}]}.`,
    imagePaths: args.refs.map((r) => r.path),
    json: true,
    maxTokens: 2400,
  });
  const decon = parseJsonLoose<{ decon?: unknown[] }>(deconRaw).decon ?? [];
  log(`thumbnailLab: deconstructed ${decon.length} winning thumbnails`);

  if (!hasAnthropicKey()) throw new Error("thumbnailLab: ANTHROPIC_API_KEY required for playbook synthesis");
  const palette = (args.dna?.thumbnail?.palette?.length ? args.dna.thumbnail.palette : args.dna?.palette) ?? [];
  const accent = palette.length >= 2 ? palette[palette.length - 2] : "#ffd400";

  const play = await claudeJson<{
    energy?: string;
    visualLanguage?: VisualLanguage;
    rules?: string[];
    avoid?: string[];
    patterns?: { name?: string; when?: string; fluxRecipe?: string; textRecipeJson?: string }[];
  }>({
    tier: "pro",
    // The visualLanguage-era schema is bigger â€” 3000 truncated mid-JSON
    // ("Expected ',' or '}'") on two of four channels.
    maxTokens: 6000,
    temperature: 0.5,
    system: "You are an elite YouTube thumbnail strategist. Return ONLY JSON.",
    prompt:
      `Build the THUMBNAIL PLAYBOOK for "${args.channelName}" (${args.positioning}).\n\n` +
      `EVIDENCE Ã¢â‚¬â€ deconstruction of ${decon.length} verified high-view, on-positioning thumbnails:\n` +
      `${JSON.stringify(decon).slice(0, 6000)}\n\n` +
      `CHANNEL DNA: palette ${palette.join(", ")} (accent ${accent}); thumbnail subject: ` +
      `${args.dna?.thumbnail?.subject ?? args.dna?.recurringSubject ?? "n/a"}; world: ${args.dna?.setting ?? "n/a"}.\n\n` +
      `${(args.dna as { thumbnailAnchors?: string[] } | null)?.thumbnailAnchors?.length ? `OPERATOR-ANCHORED REFERENCE THUMBNAILS (the operator personally chose these as THE BAR for this channel - weight them ABOVE the scraped evidence when they conflict):\n- ${(args.dna as { thumbnailAnchors?: string[] }).thumbnailAnchors!.join("\n- ")}\n\n` : ""}` +
      `RESEARCH PRINCIPLES (hard constraints):\n- ${RESEARCH_PRINCIPLES.join("\n- ")}\n\n` +
      `Synthesize:\n` +
      `0. energy: the channel's clickbait tier Ã¢â‚¬â€ "spectacle" (over-the-top impossible-scale drama: finance/tech/` +
      `drama channels), "bold" (grounded heroic punch: education/history/documentary), or "cozy_pop" (charming ` +
      `saturated warmth: lofi/ambient/kids). ALL tiers are CATCHY Ã¢â‚¬â€ pick what this identity can carry.\n` +
      `0b. visualLanguage: the channel's UNMISTAKABLE identity Ã¢â‚¬â€ {"font":"impact"|"marker"|"bebas"|"serif"|"rounded" ` +
      `(impact=bold modern, marker=hand-drawn, bebas=tall minimal, serif=editorial premium, rounded=soft playful), ` +
      `"treatment":"plate"|"sticker"|"stamp"|"neon"|"clean" (plate=filled box, sticker=white box+hard shadow pop, ` +
      `stamp=hollow archival border, neon=glowing type for night/synth worlds, clean=pure premium type), ` +
      `"baseColor":"#hex","accentColor":"#hex" Ã¢â‚¬â€ colors MUST come from THIS channel's palette; NEVER default to ` +
      `gold/yellow unless it is genuinely this channel's color, ` +
      `"textObject":"torn_strip"|"paint_smear"|"censor_bar"|"grunge_sticker"|"spaced_elegant"|"block_plate"|"neon_sign"|"spray_paint"|"stamp_ink"|"movie_poster"|"ransom_note"|"carved" (the channel SIGNATURE type-as-object treatment - ALSO available: neon_sign=real glowing tubes in the scene; spray_paint=stencil graffiti with drips; stamp_ink=huge CLASSIFIED-style rubber stamp slammed diagonally; movie_poster=cinematic beveled title card in the scene atmosphere; ransom_note=letters cut from different magazines; carved=letters chiseled into the scene material with real depth - torn_strip: each word HUGE on its own torn newspaper strip in mixed tabloid serifs layered in front of/behind the hero; paint_smear: elegant wide-tracked capitals sitting ON a rough hand-swiped accent paint smear crossing the hero; censor_bar: white stencil caps on a solid accent censor bar laid across the frame or the hero eyes; grunge_sticker: ONE lowercase word ending in a period, distressed punk type, white knockout on a rough black sticker; spaced_elegant: thin extremely wide-tracked caps integrated into the artwork material; block_plate: ultra-heavy condensed caps on hard solid plates, key word underlined with a rough brush stroke), "imageStyle":"<=12 words Ã¢â‚¬â€ the base-image rendering style (e.g. 'painterly anime watercolor', 'vintage ink ` +
      `engraving', 'hyperreal cinematic 3D', 'retro screenprint poster')","badgeStyle":"center"|"pill","composition":"cutout_collage"|"full_scene" (cutout_collage = the hero is a clean die-cut PHOTO cutout with crisp edges pasted OVER a designed collage background of torn clippings/photos/graphic shapes - real photographic grain, magazine-composite feel; PICK THIS for commentary/persona/drama/expose channels because continuous AI scenes read fake there. full_scene = one continuous rendered scene for painterly/cinematic worlds),` +
      `"uppercase":boolean}. THE RULE: if another channel could wear this language, it is WRONG Ã¢â‚¬â€ diverge hard.\n` +
      `1. rules: 6-8 HARD rules for this channel's thumbnails Ã¢â‚¬â€ specific (sizes, positions, counts, colors), ` +
      `derived from the evidence + principles, honoring the DNA palette.\n` +
      `2. avoid: 4-6 anti-patterns seen in the rejected/owned space.\n` +
      `3. patterns: EXACTLY 3 named, executable patterns (distinct compositions Ã¢â‚¬â€ e.g. number-forward / ` +
      `hero-object / annotated-chart). Each: name; when (which video topics); fluxRecipe = a TEXT-FREE ` +
      `image-generation scene recipe with <PLACEHOLDERS> for the topic-specific hero (palette + grade baked in, ` +
      `composition explicit incl. where negative space lives); textRecipeJson = a JSON-ENCODED STRING of the ` +
      `text-layer props: {"lines":[{"text":"<HOOK_WORD_1>","accent":false},{"text":"<HOOK_WORD_2>","accent":true}],` +
      `"numberCallout":"<NUMBER>" (include this key ONLY in number-led patterns; otherwise LEAVE THE KEY OUT of the ` +
      `JSON entirely - NEVER write placeholder words like OMIT),"position":"left|center|upperLeft|upperCenter","baseColor":"#hex",` +
      `"accentColor":"#hex","uppercase":true,"underlineAccent":true,` +
      `"font":"impact"|"marker"|"bebas" (impact=bold modern default; marker=hand-drawn-but-readable Ã¢â‚¬â€ USE for ` +
      `sketch/whiteboard/cozy/playful identities; bebas=tall minimal premium),` +
      `"badge":"${args.channelName.toUpperCase()}"} ` +
      `Ã¢â‚¬â€ placeholders ONLY in line texts and numberCallout.\n` +
      `Return STRICT JSON {"energy":"spectacle"|"bold"|"cozy_pop","visualLanguage":{"font","treatment","baseColor","accentColor","textObject","composition","imageStyle","badgeStyle","uppercase"},"rules":string[],"avoid":string[],"patterns":[{"name","when","fluxRecipe","textRecipeJson"}]} - energy AND visualLanguage are REQUIRED keys.`,
  });

  const patterns: ThumbPattern[] = (play.patterns ?? [])
    .map((p) => {
      let textRecipe: Record<string, unknown> = {};
      try { textRecipe = JSON.parse(p.textRecipeJson ?? "{}") as Record<string, unknown>; } catch { /* empty */ }
      return {
        name: p.name ?? "pattern",
        when: p.when ?? "",
        fluxRecipe: p.fluxRecipe ?? "",
        textRecipe,
      };
    })
    .filter((p) => p.fluxRecipe && Object.keys(p.textRecipe).length > 0)
    .slice(0, 3);
  if (patterns.length === 0) throw new Error("thumbnailLab: playbook synthesis produced no executable patterns");
  // A playbook without its visual identity is a generic-thumbnail factory —
  // refuse it loudly rather than persist undefined font/style to the channel.
  const vlOut = play.visualLanguage;
  if (!vlOut?.font || !vlOut?.imageStyle || !vlOut?.accentColor) {
    throw new Error(
      `thumbnailLab: playbook synthesis returned incomplete visualLanguage (font=${vlOut?.font} imageStyle=${vlOut?.imageStyle} accent=${vlOut?.accentColor}) — retry the distill`,
    );
  }

  log(`thumbnailLab: playbook distilled Ã¢â‚¬â€ ${play.rules?.length ?? 0} rules, ${patterns.length} patterns (${patterns.map((p) => p.name).join(" / ")})`);
  return {
    energy: (["spectacle", "bold", "cozy_pop"].includes(String(play.energy)) ? play.energy : "bold") as ThumbnailPlaybook["energy"],
    visualLanguage: play.visualLanguage,
    rules: play.rules ?? [],
    avoid: play.avoid ?? [],
    patterns,
    refsUsed: args.refs.map((r) => ({ url: r.url, views: r.views, why: r.why })),
    distilledAt: Date.now(),
  };
}

/* ---------------------------- 3. tournament ---------------------------- */

export interface TournamentCandidate {
  path: string;
  pattern: string;
  clickScore?: number;
  beatsRefs?: number;
  notes?: string;
}

export interface TournamentResult {
  candidates: TournamentCandidate[];
  winnerIdx: number;
  judgeWhy: string;
}

/** Instantiate ONE pattern into a finished candidate (base + typography). */
export async function renderCandidate(args: {
  pattern: ThumbPattern;
  title: string;
  scriptHint?: string;
  /** DNA/operator-locked scene: the heroProp MUST be this subject (hard rail, not inspiration). */
  sceneMandate?: string;
  playbook: ThumbnailPlaybook;
  outJpg: string;
  tmpDir: string;
  idx: number;
  log?: Logger;
}): Promise<string> {
  if (!hasBanana()) throw new Error("thumbnailLab: GEMINI_API_KEY required (banana engine)");
  // TWO-PASS DESIGN: the LAYOUT is decided FIRST (which zone the text owns),
  // the image is generated WITH that zone deliberately reserved as negative
  // space, then the text lands in its planned home Ã¢â‚¬â€ never fighting the image.
  const inst = await claudeJson<{ heroProp?: string; background?: string; details?: string[]; fluxPrompt?: string; textPropsJson?: string; textZone?: string }>({
    maxTokens: 1000,
    temperature: 0.75,
    system: "You are an elite YouTube thumbnail art director. Return ONLY JSON.",
    prompt:
      `Instantiate this thumbnail PATTERN for the video "${args.title}".\n` +
      `${args.sceneMandate ? `MANDATORY SCENE (operator/DNA-locked - NOT inspiration, NOT optional): the heroProp MUST be exactly this subject, adapted to this topic: ${args.sceneMandate}. Invent background and details AROUND it - never replace it.\n` : ""}` +
      (args.scriptHint ? `Video content hint: ${args.scriptHint.slice(0, 500)}\n` : "") +
      `PATTERN "${args.pattern.name}": ${args.pattern.fluxRecipe}\n` +
      `TEXT TEMPLATE: ${JSON.stringify(args.pattern.textRecipe)}\n` +
      `HARD RULES:\n- ${args.playbook.rules.slice(0, 6).join("\n- ")}\n\n` +
      `STEP 1 Ã¢â‚¬â€ LAYOUT: choose textZone ("left"|"right"|"upperLeft"|"upperRight") Ã¢â‚¬â€ where the typography will live.\n` +
      `STEP 2 Ã¢â‚¬â€ fluxPrompt: INVENT A NEW CONCEPT for this topic (the pattern recipe above is INSPIRATION ONLY Ã¢â‚¬â€ ` +
      `never reproduce its literal scene). ENERGY TIER = "${args.playbook.energy ?? "bold"}":\n` +
      (args.playbook.energy === "spectacle"
        ? `SPECTACLE: go to the edge of absurd Ã¢â‚¬â€ IMPOSSIBLE SCALE (a tsunami of coins crashing toward a tiny figure, ` +
          `a banknote the size of a skyscraper), PHYSICS-DEFYING moments frozen mid-action, cinematic catastrophe/` +
          `triumph. The viewer's reaction must be "WHAT?!".\n`
        : args.playbook.energy === "cozy_pop"
          ? `COZY-POP: irresistibly charming and warm Ã¢â‚¬â€ but PUNCHY: one adorable/magical focal moment (impossibly ` +
            `cozy light, oversized moon, glowing window, a cat doing something delightful), saturated inviting ` +
            `color, storybook wonder. Catchy and clickable, never sleepy or flat.\n`
          : `BOLD: grounded but dramatic Ã¢â‚¬â€ one striking focal subject at heroic scale, charged atmosphere (storm ` +
            `light, golden hour blaze, deep shadow), strong tension or payoff in the frame. Punchy, never generic.\n`) +
      `Keep ONLY the channel's palette + grade + finish from its world Ã¢â‚¬â€ the SCENE must be new each time. ` +
      `Hyper-saturated, volumetric light. COMPOSED FOR THE LAYOUT: the subject occupies the side OPPOSITE the ` +
      `textZone (large, partially cropped for scale); the textZone 40% is clean darker negative space. ` +
      `TEXT-FREE image (no words/letters).\n` +
      `NARRATIVE COHERENCE (hard requirement): the scene must LITERALLY ENACT the topic so a viewer instantly ` +
      `reads what the video is about - subjects ACTING OUT the idea (for "conquering anxiety": a stoic statue ` +
      `laying a steadying hand on a crumbling statue shoulder; for "market crash": a figure watching a collapsing ` +
      `red line tear through the floor). NEVER decorative abstraction (random dust, glows, floating objects) that ` +
      `does not tell the story. Test: cover the text - does the image alone communicate the topic?\n` +
      `STEP 2b - BUILD THE SCENE IN NAMED STAGES (how the top 1% compose):\n` +
      `heroProp: the ONE dominant subject - 55-75% of the frame, emotionally charged, AGGRESSIVELY cropped with edges bleeding off frame (phone-screen scale) ` +
      `(a cracked marble face glaring, a grumpy mogul portrait, a war elephant chest-on). Hero sits on the side ` +
      `OPPOSITE the textZone.\n` +
      `background: a SEPARATE supporting layer behind the hero - darker, simpler, with depth (torn tabloid strips, ` +
      `a blurred crowd in red, a burning skyline, a storm sky). It frames the hero, never competes.\n` +
      `details: 1-3 SYMBOLIC story-carrying additions ON or AROUND the hero that make the click irresistible ` +
      `(fire reflected in glasses lenses, a glowing crack across the chest, torn headline strips reading into ` +
      `frame, a red zigzag crash line). Each detail must deepen the SAME story - nothing random.\n` +
      `STEP 3 Ã¢â‚¬â€ textPropsJson: the template as a JSON-ENCODED STRING with placeholders replaced (line texts: 1-3 ` +
      `punchy words each, Ã¢â€°Â¤5 words total, NOT restating the title - every line must be a real English hook word, NEVER meta-words like "omit"/"none"; ` +
      `numberCallout: a REAL number from the topic, or LEAVE THE KEY OUT of the JSON entirely when none exists; set "position" to your chosen textZone).\n` +
      `Return STRICT JSON {"heroProp":string,"background":string,"details":string[],"textPropsJson":string,"textZone":string}.`,
  });
  // STAGED COMPOSITION: hero prop -> background -> story details, assembled
  // deterministically so generators receive named layers, not a prose blob.
  if (inst.heroProp) {
    inst.fluxPrompt =
      `HERO PROP (dominant, 30-50% of frame, cropped close): ${inst.heroProp}. ` +
      `BACKGROUND (separate supporting layer behind the hero - darker, simpler, depth): ${inst.background ?? "deep dark gradient"}. ` +
      `STORY DETAILS (symbolic, on/around the hero): ${(inst.details ?? []).join("; ") || "none"}.`;
  }
  if (!inst.fluxPrompt || !inst.textPropsJson) throw new Error("pattern instantiation incomplete (need heroProp or fluxPrompt + textPropsJson)");
  let textProps: Record<string, unknown>;
  try { textProps = JSON.parse(inst.textPropsJson) as Record<string, unknown>; } catch {
    throw new Error("pattern textPropsJson unparseable");
  }
  // The channel's VISUAL LANGUAGE is constant Ã¢â‚¬â€ it overrides whatever the
  // pattern template carried (patterns vary composition, never identity).
  const vl = args.playbook.visualLanguage ?? {};
  textProps = {
    ...textProps,
    ...(vl.font ? { font: vl.font } : {}),
    ...(vl.treatment ? { treatment: vl.treatment } : {}),
    ...(vl.baseColor ? { baseColor: vl.baseColor } : {}),
    ...(vl.accentColor ? { accentColor: vl.accentColor } : {}),
    ...(vl.badgeStyle ? { badgeStyle: vl.badgeStyle } : {}),
    ...(vl.uppercase !== undefined ? { uppercase: vl.uppercase } : {}),
  };

  // META-WORD GUARD (the "OMIT" class — template placeholders leaking as
  // literal text): strip junk lines deterministically; a numberCallout must
  // actually contain a digit; fall back to title hook words if all lines die.
  const META = /^(omit|none|n\/?a|tbd|null|placeholder|number|text|word)$/i;
  let cleanLines = (((textProps["lines"] as { text?: string; accent?: boolean }[] | undefined) ?? []))
    .filter((l): l is { text: string; accent?: boolean } => Boolean(l.text && l.text.trim().length > 0 && !META.test(l.text.trim()) && !/[<>{}]/.test(l.text)));
  if (!cleanLines.length) {
    const hook = args.title.split(/[\s:—-]+/).filter((w) => w.length > 2).slice(0, 2);
    cleanLines = [{ text: hook[0] ?? "WATCH", accent: false }, { text: hook[1] ?? "THIS", accent: true }];
    args.log?.(`thumbnailLab: all text lines were meta-junk — fell back to title hook words`);
  }
  textProps = { ...textProps, lines: cleanLines };
  if (textProps["numberCallout"] !== undefined && !/\d/.test(String(textProps["numberCallout"]))) {
    delete textProps["numberCallout"];
  }

  // THE ENGINE: one rich design brief -> Nano Banana Pro -> vision gate ->
  // one feedback retry. The old multi-path machine (recraft/integrated/
  // layered/template + zone contracts + critique loops + badge compositing)
  // is GONE - the design-native model does all of it in one pass, better.
  const { buildThumbBrief, bananaThumbnail } = await import("@/lib/banana");
  const words = cleanLines.map((l) => l.text);
  if (textProps["numberCallout"]) words.unshift(String(textProps["numberCallout"]));
  const payoffIdx = Math.max(cleanLines.findIndex((l) => l.accent), 0);
  const brief = buildThumbBrief({
    channelName: String(textProps["badge"] ?? "channel"),
    imageStyle: vl.imageStyle,
    palette: (args.playbook.visualLanguage as { palette?: string[] } | undefined)?.palette,
    accentColor: vl.accentColor,
    textObject: (vl as { textObject?: string }).textObject,
    composition: (vl as { composition?: string }).composition,
    scene: `${inst.fluxPrompt}${textProps["numberCallout"] ? ` Feature the real number "${textProps["numberCallout"]}" prominently.` : ""}`,
    lines: cleanLines.map((l, i) => ({ text: l.text, payoff: i === payoffIdx, accent: l.accent })),
    badge: String(textProps["badge"] ?? ""),
  });
  const { verdict } = await bananaThumbnail({
    brief,
    outJpg: args.outJpg,
    expectWords: words,
    imageStyle: vl.imageStyle,
    title: args.title,
    log: args.log,
  });
  args.log?.(`thumbnailLab: candidate ${args.idx + 1} "${args.pattern.name}" rendered (banana, punch ${verdict.punch ?? "?"}/10)`);
  return args.outJpg;
}
/** Comparative feed judgment: candidates vs the verified real winners. */
export async function judgeTournament(args: {
  candidates: { path: string; pattern: string }[];
  refs: VerifiedRef[];
  title: string;
  tmpDir: string;
  log?: Logger;
}): Promise<TournamentResult> {
  const n = args.candidates.length;
  const refPaths = args.refs.slice(0, 4).map((r) => r.path);
  // Judge at FEED size Ã¢â‚¬â€ the size the click decision actually happens at.
  const smalls: string[] = [];
  for (let i = 0; i < n; i++) {
    smalls.push(await imageToJpeg(args.candidates[i].path, join(args.tmpDir, `cand_${i}_small.jpg`), 480, 270));
  }
  const raw = await visionLocal({
    prompt:
      `FEED SIMULATION. Images 1-${n} are CANDIDATE thumbnails for the video "${args.title}". ` +
      `Images ${n + 1}-${n + refPaths.length} are REAL thumbnails of the highest-view videos in this niche ` +
      `(the competition in the same feed).\n` +
      `For each candidate: clickScore 1-10 (would it WIN the click in this feed), beatsRefs = how many of the ` +
      `references it visually out-competes, strengths, and the ONE fix that would most raise its score. ` +
      `Judge composition, instant readability, number/text impact, color authority, and premium feel. ` +
      `Be harsh Ã¢â‚¬â€ 8+ means it genuinely belongs among the winners.\n` +
      `Return STRICT JSON {"candidates":[{"idx":1-based,"clickScore":1-10,"beatsRefs":number,"strengths":string,"fix":string}],` +
      `"winner":1-based,"why":string}.`,
    imagePaths: [...smalls, ...refPaths],
    json: true,
    maxTokens: 1800,
  });
  const parsed = parseJsonLoose<{
    candidates?: { idx?: number; clickScore?: number; beatsRefs?: number; strengths?: string; fix?: string }[];
    winner?: number;
    why?: string;
  }>(raw);
  const out: TournamentCandidate[] = args.candidates.map((c, i) => {
    const v = (parsed.candidates ?? []).find((x) => (x.idx ?? 0) - 1 === i);
    return {
      path: c.path,
      pattern: c.pattern,
      clickScore: v?.clickScore,
      beatsRefs: v?.beatsRefs,
      notes: [v?.strengths, v?.fix ? `FIX: ${v.fix}` : ""].filter(Boolean).join(" | "),
    };
  });
  const winnerIdx = Math.min(n - 1, Math.max(0, (parsed.winner ?? 1) - 1));
  args.log?.(
    `thumbnailLab: tournament Ã¢â‚¬â€ ${out.map((c, i) => `#${i + 1} ${c.pattern}: ${c.clickScore ?? "?"}/10 (beats ${c.beatsRefs ?? "?"} refs)`).join("; ")} Ã¢â€ â€™ winner #${winnerIdx + 1}`,
  );
  return { candidates: out, winnerIdx, judgeWhy: parsed.why ?? "" };
}
