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
import { geminiVisionLocal, parseJsonLoose, hasGeminiKey } from "@/lib/gemini";
import { claudeJson, hasAnthropicKey } from "@/lib/anthropic";
import { generateFalFluxProImage, hasFalKey } from "@/lib/falImage";
import { renderThumbTextLayer } from "@/lib/remotionRender";
import { overlayPngOnImage, imageToJpeg } from "@/lib/ffmpeg";
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

  const raw = await geminiVisionLocal({
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
  const deconRaw = args.refs.length === 0 ? '{"decon":[]}' : await geminiVisionLocal({
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
      `"uppercase":boolean,"renderMode":"recraft"|"integrated"|"layered" (recraft = the ENTIRE frame - art, typography, layout - designed as ONE generation by a design-tuned model; the DEFAULT for most worlds (painterly, editorial, photographic, illustrated) because nothing looks pasted-on. integrated = words generated as part of the artwork via a typography engine; pick when type must physically exist in the scene as real neon/paint/print. layered = compositor type on top; pick ONLY for precision/data/clean-premium channels needing deterministic text control)}. THE RULE: if another channel could wear this language, it is WRONG Ã¢â‚¬â€ diverge hard.\n` +
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
      `Return STRICT JSON {"energy":"spectacle"|"bold"|"cozy_pop","visualLanguage":{"font","treatment","baseColor","accentColor","textObject","imageStyle","badgeStyle","uppercase","renderMode"},"rules":string[],"avoid":string[],"patterns":[{"name","when","fluxRecipe","textRecipeJson"}]} - energy AND visualLanguage are REQUIRED keys.`,
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
  if (!hasFalKey()) throw new Error("thumbnailLab: FAL_KEY required");
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

  const plannedZone = ["left", "right", "upperLeft", "upperRight"].includes(String(inst.textZone))
    ? String(inst.textZone)
    : "left";
  const zoneSide = plannedZone.toLowerCase().includes("left") ? "left" : "right";
  const subjectSide = zoneSide === "left" ? "right" : "left";
  const basePrompt =
    `${vl.imageStyle ? `RENDERING STYLE (the channel's signature look Ã¢â‚¬â€ obey strictly): ${vl.imageStyle}. ` : ""}` +
    `${inst.fluxPrompt} COMPOSITION CONTRACT: the main subject is LARGE and dramatic on the ${subjectSide} side of ` +
    `the frame; the ${zoneSide} 40% of the frame is clean, darker, uncluttered negative space with NO objects or ` +
    `detail (reserved for typography). Top-1% YouTube thumbnail energy: hyper-saturated, dramatic rim lighting, ` +
    `one compelling focal moment, rich deep contrast. Absolutely NO text, NO words, NO letters, NO numbers, NO watermark.`;

    // RECRAFT MODE — design-tuned one-pass model (Recraft V3 via fal): the FULL
  // frame (art + typography + layout) is designed as ONE generation, so type
  // never looks pasted on. Vision-checked (text exact, readable, NO baked-in
  // UI chrome) with one fix-regen; falls through to the other paths on failure.
  args.log?.(`thumbnailLab: render mode = ${vl.renderMode ?? "layered"}`);
  if (vl.renderMode === "recraft") {
    const { hasRecraft, generateRecraft } = await import("@/lib/recraft");
    if (!hasRecraft()) args.log?.("thumbnailLab: recraft mode requested but FAL_KEY missing - falling through");
    if (hasRecraft()) {
      const wordList = cleanLines.map((l) => `"${l.text.toUpperCase()}"`).join(" and ");
      const callout = textProps["numberCallout"] ? ` plus the large number "${textProps["numberCallout"]}"` : "";
      const style = /photo|cinema|realis|film|3d/i.test(vl.imageStyle ?? "") ? "realistic_image" : "digital_illustration";
      let fixNote = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        // Recraft hard-caps prompts at 1000 chars (422 otherwise). The scene is
        // the only compressible part — headline/style/contract clauses survive.
        const { RECRAFT_PROMPT_MAX } = await import("@/lib/recraft");
        const TEXT_OBJECTS: Record<string, string> = {
          torn_strip: "each word printed HUGE on its own torn newspaper strip, every strip a DIFFERENT bold tabloid serif, aged newsprint texture with rough torn edges catching the light, strips rotated 2-6 degrees and interleaved - some BEHIND the hero, some IN FRONT - with hard drop shadows",
          paint_smear: "in elegant wide-letterspaced serif capitals sitting ON TOP of a rough hand-swiped paint smear in the accent color that crosses straight over the hero, wet bristle texture and flicked droplets at the smear ends",
          censor_bar: "in white stencil capitals printed on a solid accent-color censor bar laid straight across the frame (across the eyes if the hero is a face), hard edges, slight ink misregistration like government documents",
          grunge_sticker: "as ONE single lowercase word ending in a period, in a distressed punk typeface with chipped edges, white knockout on a rough black sticker box with peeling corners - deadpan, huge, menacing",
          spaced_elegant: "in thin EXTREMELY wide-letterspaced capitals integrated into the artwork material with a small quiet subtitle beneath, museum-plate restraint against a violent or emotional image",
          block_plate: "in ultra-heavy condensed capitals stacked tight on hard solid plates, the key word underlined with a rough hand-painted brush stroke in the accent color, brutal Swiss-poster contrast",
          neon_sign: "as REAL glowing neon tubes physically mounted in the scene, casting their colored light onto the hero and wet surfaces, one tube section flickering half-lit",
          spray_paint: "stencil-sprayed directly onto the scene surface in the accent color, paint drips running from the letterforms, overspray haze, one letter half-finished",
          stamp_ink: "as a HUGE rubber-stamp imprint slammed diagonally across the frame like a CLASSIFIED stamp, cracked dry ink, double-struck ghosting on one edge",
          movie_poster: "as cinematic title-card lettering with metallic bevel and rim light, embedded in the scene atmosphere (haze drifting in front of the letters), blockbuster one-sheet gravity",
          ransom_note: "with each letter cut from a different magazine page in a different font and color, glued unevenly with visible tape and shadows, unhinged and urgent",
          carved: "physically carved into the scene dominant material (stone, wood, steel) with real chisel depth, the cuts catching the scene key light, dust or splinters still falling from the last letter",
        };
        const typeObj = TEXT_OBJECTS[String((vl as { textObject?: string }).textObject ?? "")] ??
          "as a PHYSICAL DESIGNED OBJECT belonging to the scene (a torn paper strip, a rough paint smear, a solid censor bar, a sticker plate, carved letters or real neon) with true texture, shadow and material presence - NEVER plain floating text with an outline";
        const buildPrompt = (scene: string) =>
          `YouTube thumbnail, top-1% clickbait design, composed for a small PHONE screen. ${scene} ` +
          `STYLE (obey strictly): ${vl.imageStyle ?? "cinematic"}. ` +
          `HERO DOMINANCE: the hero fills 55-75% of the frame, aggressively cropped with edges bleeding off frame, centered or near-center - nothing timid. ` +
          `${(vl as { composition?: string }).composition === "cutout_collage" ? "COMPOSITION: photographic CUTOUT COLLAGE - the hero is a real-photo die-cut cutout with a crisp edge, pasted OVER a separate designed collage background (torn newspaper clippings, photos, graphic shapes, paper texture, hard cut shadows) like a magazine composite. Real photographic grain - NEVER a continuous smooth AI-rendered scene. " : ""}` +
          `TYPOGRAPHY ${wordList}${callout} rendered ${typeObj}, accent color ${vl.accentColor ?? "#ffffff"}. ` +
          `TYPE HIERARCHY (non-negotiable): never set all words the same size - the single PAYOFF word is 2-4x ` +
          `larger than the rest and is the loudest thing after the hero face. The type may tilt 2-6 degrees and ` +
          `may bleed off the frame edge mid-letter for urgency. Where natural, interleave type with the hero ` +
          `(a strip behind the head, a smear across the chest) for physical depth. ` +
          `SCALE FOR A PHONE: the type block owns 25-40% of the frame; every element must survive a 120px lock-screen glance - if it would not read there, make it BIGGER. ` +
          `LETTERFORMS ULTRA-BOLD heavy weight (thin/light weights ONLY for spaced_elegant), the type sits IN FRONT of the scene at full opacity - foreground presence, never washed out. ` +
          `VERTICAL PLACEMENT: the text block sits in the upper-to-middle band of its side with generous breathing margin - NEVER crammed into the extreme corner or pinned to the very top edge. ` +
          `RAZOR-SHARP, spelling EXACTLY as quoted, extreme contrast, readable at 120px. ` +
          `ABSOLUTELY NO other text anywhere - no small labels, no captions, no channel marks: ONLY the headline words (the channel badge is composited afterwards).${fixNote}`;
        let recraftPrompt = buildPrompt(inst.fluxPrompt ?? "");
        const budget = RECRAFT_PROMPT_MAX - 90; // NO_UI clause + safety margin
        if (recraftPrompt.length > budget) {
          const overflow = recraftPrompt.length - budget;
          const scene = String(inst.fluxPrompt ?? "")
            .slice(0, Math.max(120, String(inst.fluxPrompt ?? "").length - overflow))
            .replace(/\s+\S*$/, "");
          recraftPrompt = buildPrompt(`${scene}.`);
        }
        // final guard: a long fixNote can defeat scene truncation - never 422
        if (recraftPrompt.length > budget) {
          recraftPrompt = recraftPrompt.slice(0, budget).replace(/\s+\S*$/, "") + ".";
        }
        let url;
        try { url = await generateRecraft({ prompt: recraftPrompt, style }); }
        catch (e) { args.log?.(`thumbnailLab: recraft failed (falling through): ${e instanceof Error ? e.message : e}`); break; }
        if (!url) { args.log?.("thumbnailLab: recraft COMPLETED but returned no image url - falling through"); break; }
        await downloadTo(url, args.outJpg);
        const raw = await geminiVisionLocal({
          prompt:
            `Check this thumbnail: 1. exact words ${wordList}${callout} fully visible and spelled exactly? ` +
            `2. punch 1-10 (scroll-stopping for tier "${args.playbook.energy ?? "bold"}")? 3. readable at 120px? ` +
            `4. uiClean: true ONLY if there are NO fake play buttons, video-player icons, progress bars or other ` +
            `baked-in UI chrome in the artwork. ` +
            `5. badgeOk: true if EVERY word visible in the image is a correctly spelled real English word - extra ` +
            `DESIGN words on torn strips/stamps are welcome; false ONLY on garbled or invented letter-strings. ` +
            
            `6. styleMatch 1-10: does the rendering obey the channel style "${vl.imageStyle ?? "cinematic"}"? ` +
            `7. storyMatch 1-10: ignoring the text, does the IMAGE alone visually tell the story of the topic "${args.title}" (subjects enacting the idea, not decorative abstraction)? 8. crisp: is ALL text razor-sharp and in focus (soft/blurry lettering = false)? 9. heroOk: does ONE hero subject dominate AT LEAST HALF the frame (aggressively cropped, in front of a separate background) rather than a small/timid or cluttered scene? 10. typeQuality 1-10: is the typography a DESIGNED PHYSICAL OBJECT (torn strips / paint smear / censor bar / sticker plate) with real texture and presence, owning at least 20% of the frame - not plain floating text? ` + `Return STRICT JSON {"textOk":bool,"punch":n,"readable":bool,"uiClean":bool,"badgeOk":bool,"styleMatch":n,"storyMatch":n,"crisp":bool,"heroOk":bool,"typeQuality":n,"fix":"<=15 words"}.`,
          imagePaths: [args.outJpg],
          json: true,
          maxTokens: 250,
        }).catch(() => "");
        const v = raw ? parseJsonLoose<{ textOk?: boolean; punch?: number; readable?: boolean; uiClean?: boolean; badgeOk?: boolean; styleMatch?: number; storyMatch?: number; crisp?: boolean; heroOk?: boolean; typeQuality?: number; fix?: string }>(raw) : {};
        if (v.textOk !== false && v.readable !== false && v.uiClean !== false && v.badgeOk !== false && v.crisp !== false && v.heroOk !== false && (v.typeQuality ?? 10) >= 7 && (v.styleMatch ?? 10) >= 7 && (v.storyMatch ?? 10) >= 7 && (v.punch ?? 10) >= 7) {
          // STAGED FINISH: the model never renders small text (it garbles it) -
          // the channel badge is composited deterministically, crisp by construction.
          try {
            const badgePng = await renderThumbTextLayer({
              props: { lines: [], badge: String(textProps["badge"] ?? ""), badgeStyle: vl.badgeStyle ?? "pill", badgeCorner: plannedZone.toLowerCase().includes("right") ? "tl" : "tr", font: vl.font ?? "impact", accentColor: vl.accentColor, uppercase: true },
              outPng: join(args.tmpDir, `cand_${args.idx}_badge.png`),
            });
            const finalJpg = join(args.tmpDir, `cand_${args.idx}_badged.jpg`);
            await overlayPngOnImage(args.outJpg, badgePng, finalJpg);
            await (await import("node:fs/promises")).copyFile(finalJpg, args.outJpg);
          } catch (e) {
            args.log?.(`thumbnailLab: badge composite failed (shipping without badge): ${e instanceof Error ? e.message : e}`);
          }
          args.log?.(`thumbnailLab: RECRAFT render OK (one-pass design, punch ${v.punch ?? "?"}/10)`);
          return args.outJpg;
        }
        fixNote =
          ` CRITICAL FIX: ${v.fix ?? "text larger and exact, higher contrast"}.` +
          `${v.uiClean === false ? " REMOVE all fake play buttons / player UI from the artwork." : ""}` +
          `${v.badgeOk === false ? " REMOVE all words except the headline - no labels or small text." : ""}` +
          `${(v.styleMatch ?? 10) < 7 ? ` The image MUST follow the style: ${vl.imageStyle}.` : ""}` + `${(v.storyMatch ?? 10) < 7 ? ` The scene must LITERALLY enact the topic "${args.title}" - subjects acting out the idea, no decorative abstraction.` : ""}` + `${v.crisp === false ? " ALL lettering must be razor-sharp and in focus." : ""}` + `${v.heroOk === false ? " The hero must dominate AT LEAST HALF the frame, aggressively cropped." : ""}` + `${(v.typeQuality ?? 10) < 7 ? " The typography must be a designed PHYSICAL object (torn strip / paint smear / censor bar / sticker) with texture, owning 25% of the frame." : ""}`;
        args.log?.(`thumbnailLab: recraft attempt ${attempt + 1} - textOk=${v.textOk} punch=${v.punch} uiClean=${v.uiClean} badgeOk=${v.badgeOk} styleMatch=${v.styleMatch} -> ${attempt === 0 ? "regenerating with fix" : "falling through"}`);
      }
    }
  }
// INTEGRATED MODE — the most advanced path for stylized worlds: Ideogram's
  // typography engine generates the WORDS AS PART OF THE ARTWORK (painted into
  // the sketch, glowing as real neon, printed on the poster). Critiqued and
  // regenerated with the judge's fix once; falls through to layered on failure.
  if (vl.renderMode === "integrated") {
    const { hasIdeogramKey, generateIdeogramRaw } = await import("@/lib/ideogram");
    if (hasIdeogramKey()) {
      const wordList = cleanLines.map((l) => `"${l.text.toUpperCase()}"`).join(" and ");
      const callout = textProps["numberCallout"] ? ` plus the large number "${textProps["numberCallout"]}"` : "";
      const fontFeel = { impact: "heavy condensed block", marker: "hand-drawn marker", bebas: "tall minimal", serif: "elegant editorial serif", rounded: "soft rounded playful" }[vl.font ?? "impact"];
      const treatFeel = { plate: "on a bold filled banner", sticker: "as a die-cut sticker with hard shadow", stamp: "inside a hollow stamped border", neon: "as glowing neon tubes that light the scene", clean: "as clean integrated lettering" }[vl.treatment ?? "plate"];
      let fixNote = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const ideoPrompt =
          `YouTube thumbnail, 16:9. ${inst.fluxPrompt} ` +
          `INTEGRATED TYPOGRAPHY (the text is PART of the artwork, native to the scene): the words ${wordList}${callout} ` +
          `rendered ${treatFeel} in ${fontFeel} lettering, placed in the ${plannedZone} area of the frame, ` +
          `colors ${vl.accentColor ?? "#ffffff"} and white, VERY LARGE and instantly readable at small size, ` +
          `high contrast against the background. Small channel mark "${String(textProps["badge"] ?? "")}". ` +
          `Style: ${vl.imageStyle ?? "cinematic"}. Spelling must be EXACTLY as quoted.${fixNote}`;
        const url = await generateIdeogramRaw({ prompt: ideoPrompt });
        if (!url) break;
        await downloadTo(url, args.outJpg);
        const raw = await geminiVisionLocal({
          prompt:
            `Check this thumbnail: 1. exact words ${wordList}${callout} fully visible and spelled exactly? ` +
            `2. punch 1-10 (scroll-stopping for tier "${args.playbook.energy ?? "bold"}")? 3. readable at 120px? ` +
            `Return STRICT JSON {"textOk":bool,"punch":n,"readable":bool,"fix":"<=15 words"}.`,
          imagePaths: [args.outJpg],
          json: true,
          maxTokens: 200,
        }).catch(() => "");
        const v = raw ? parseJsonLoose<{ textOk?: boolean; punch?: number; readable?: boolean; fix?: string }>(raw) : {};
        if (v.textOk !== false && v.readable !== false && (v.punch ?? 10) >= 7) {
          args.log?.(`thumbnailLab: INTEGRATED render ✓ (Ideogram typography, punch ${v.punch ?? "?"}/10)`);
          return args.outJpg;
        }
        fixNote = ` CRITICAL FIX: ${v.fix ?? "make the text larger, perfectly spelled, higher contrast"}.`;
        args.log?.(`thumbnailLab: integrated attempt ${attempt + 1} — textOk=${v.textOk} punch=${v.punch} → ${attempt === 0 ? "regenerating with fix" : "falling back to layered"}`);
      }
    }
  }

  // BASE PROVIDER: Higgsfield image model when configured (subscription
  // credits Ã¢â‚¬â€ set HIGGS_IMAGE_MODEL to the CLI model id); flux is the default.
  let baseUrl: string | undefined;
  const higgsImageModel = process.env.HIGGS_IMAGE_MODEL;
  if (higgsImageModel && process.env.HIGGSFIELD_LIVE === "1") {
    try {
      const { runCli } = await import("@/lib/higgsfield");
      const job = (await runCli([
        "generate", "create", higgsImageModel,
        "--prompt", basePrompt,
        "--aspect_ratio", "16:9",
        "--wait", "--wait-timeout", "5m", "--wait-interval", "3s",
      ])) as Record<string, unknown>;
      for (const k of ["url", "result_url", "image_url", "output_url"]) {
        if (typeof job[k] === "string") { baseUrl = job[k] as string; break; }
      }
      if (baseUrl) args.log?.(`thumbnailLab: base via Higgsfield ${higgsImageModel} Ã¢Å“â€œ`);
    } catch (e) {
      args.log?.(`thumbnailLab: Higgsfield base failed (flux fallback): ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!baseUrl) baseUrl = await generateFalFluxProImage({ prompt: basePrompt });
  const basePath = await downloadTo(baseUrl, join(args.tmpDir, `cand_${args.idx}_base.png`));

  // VERIFY THE COMPOSITION CONTRACT: is the planned text zone actually clean?
  // If the generator ignored the reservation, regenerate ONCE with a harder
  // contract; if still dirty, fall back to whichever zone IS cleanest.
  let zoneOk = false;
  for (let zTry = 0; zTry < 2 && !zoneOk; zTry++) {
    try {
      const zoneRaw = await geminiVisionLocal({
        prompt:
          `Composition check. Is the ${zoneSide} ~40% of this image clean negative space suitable for large bold ` +
          `text (no subject, no important detail there)? Also: which zone IS cleanest ("left"|"right"|"upperLeft"|"upperRight")? ` +
          `Return STRICT JSON {"plannedClean":boolean,"cleanest":string}.`,
        imagePaths: [basePath],
        json: true,
        maxTokens: 100,
      });
      const z = parseJsonLoose<{ plannedClean?: boolean; cleanest?: string }>(zoneRaw);
      if (z.plannedClean) {
        zoneOk = true;
      } else if (zTry === 0) {
        args.log?.(`thumbnailLab: ${zoneSide} zone NOT clean Ã¢â‚¬â€ regenerating base with harder composition contract`);
        const url2 = await generateFalFluxProImage({
          prompt: basePrompt + ` CRITICAL: the entire ${zoneSide} side must be empty dark space Ã¢â‚¬â€ nothing there at all.`,
        });
        await downloadTo(url2, basePath);
      } else if (z.cleanest && ["left", "right", "upperLeft", "upperRight"].includes(z.cleanest)) {
        args.log?.(`thumbnailLab: contract failed twice Ã¢â‚¬â€ moving text to actual cleanest zone (${z.cleanest})`);
        textProps = { ...textProps, position: z.cleanest };
        zoneOk = true;
      }
    } catch { zoneOk = true; /* vision unavailable Ã¢â€ â€™ trust the contract */ }
  }
  if (!textProps["position"] || !zoneOk) textProps = { ...textProps, position: plannedZone };
  textProps = { ...textProps, position: textProps["position"] ?? plannedZone };

  // TEMPLATE MODE - designed locked layouts (docs/THUMB_TEMPLATES.md): the AI
  // art fills a slot in a professional layout; typography placement is owned
  // by the design, so overlap/clipping are impossible by construction.
  if (vl.renderMode === "template" || (vl as { templates?: string[] }).templates?.length) {
    try {
      const { renderThumbTemplate } = await import("@/lib/remotionRender");
      const { readFile } = await import("node:fs/promises");
      const LAYOUTS = ["diagonal_split", "number_burst", "circle_spotlight", "banner_bottom", "versus_split", "torn_reveal"];
      const byTreatment: Record<string, string> = { plate: "diagonal_split", sticker: "circle_spotlight", stamp: "torn_reveal", neon: "banner_bottom", clean: "number_burst" };
      const pool = ((vl as { templates?: string[] }).templates ?? []).filter((t) => LAYOUTS.includes(t));
      const layout = pool.length ? pool[Math.abs(args.idx) % pool.length] : (byTreatment[vl.treatment ?? "plate"] ?? "diagonal_split");
      const artSrc = `data:image/png;base64,${Buffer.from(await readFile(basePath)).toString("base64")}`;
      const tProps = {
        layout,
        artSrc,
        words: cleanLines.map((l) => l.text),
        number: textProps["numberCallout"] ? String(textProps["numberCallout"]) : undefined,
        badge: String(textProps["badge"] ?? ""),
        panelColor: vl.baseColor && /^#/.test(vl.baseColor) ? vl.baseColor : "#101018",
        accentColor: vl.accentColor ?? "#ffd400",
        font: vl.font ?? "impact",
        uppercase: vl.uppercase !== false,
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        await renderThumbTemplate({ props: tProps as unknown as Record<string, unknown>, outJpg: args.outJpg });
        const raw = await geminiVisionLocal({
          prompt:
            `Check: words ${cleanLines.map((l) => `"${l.text}"`).join(", ")} fully visible+spelled? punch 1-10 for tier "${args.playbook.energy ?? "bold"}"? readable at 120px? ` +
            `Return STRICT JSON {"textOk":bool,"punch":n,"readable":bool,"fix":"<=12 words"}.`,
          imagePaths: [args.outJpg], json: true, maxTokens: 180,
        }).catch(() => "");
        const v = raw ? parseJsonLoose<{ textOk?: boolean; punch?: number; readable?: boolean; fix?: string }>(raw) : {};
        if (v.textOk !== false && v.readable !== false && (v.punch ?? 10) >= 6) {
          args.log?.(`thumbnailLab: TEMPLATE render (${layout}) PASS punch ${v.punch ?? "?"}/10`);
          return args.outJpg;
        }
        if (attempt === 0) {
          const url2 = await generateFalFluxProImage({ prompt: `${basePrompt} PUSH FURTHER: ${v.fix ?? "more drama"}.` });
          await downloadTo(url2, basePath);
          tProps.artSrc = `data:image/png;base64,${Buffer.from(await readFile(basePath)).toString("base64")}`;
          args.log?.(`thumbnailLab: template critique ${v.punch}/10 - regenerating art`);
        }
      }
      args.log?.(`thumbnailLab: TEMPLATE render (${layout}) shipped at ceiling`);
      return args.outJpg;
    } catch (e) {
      args.log?.(`thumbnailLab: template mode failed (layered fallback): ${e instanceof Error ? e.message : e}`);
    }
  }
  // CRITIQUE Ã¢â€ â€™ ACT loop: one vision pass judges FIVE dimensions, and every
  // failure maps to a concrete corrective action (re-render text smaller /
  // reposition / harden contrast / regenerate the base with the judge's own
  // fix note). Up to 3 iterations; only unfixable text-incompleteness fails.
  const expectedWords = [
    ...((textProps["lines"] as { text?: string }[] | undefined) ?? []).map((l) => l.text ?? ""),
    String(textProps["numberCallout"] ?? ""),
  ].filter(Boolean).join(" / ");
  let curProps = textProps;
  let baseRegens = 0;
  for (let iter = 0; iter < 3; iter++) {
    const textPng = await renderThumbTextLayer({
      props: curProps,
      outPng: join(args.tmpDir, `cand_${args.idx}_text_${iter}.png`),
    });
    await overlayPngOnImage(basePath, textPng, args.outJpg);
    const raw = await geminiVisionLocal({
      prompt:
        `THUMBNAIL QUALITY CRITIQUE (channel energy tier: "${args.playbook.energy ?? "bold"}"). Judge this thumbnail on FIVE dimensions:\n` +
        `1. textComplete: the exact text elements "${expectedWords}" all fully visible, nothing cut off, spelled exactly.\n` +
        `2. overlapsSubject: does text cover the image's main subject or important detail?\n` +
        `3. contrastOk: is every word instantly readable at 120px width?\n` +
        `4. punch 1-10: would this STOP a scroller Ã¢â‚¬â€ catchy, energetic, curiosity-grabbing for its tier? (7+ = ships)\n` +
        `5. styleMatch 1-10: does the whole image obey the channel's signature look${vl.imageStyle ? ` ("${vl.imageStyle}")` : ""}? (7+ = ships)\n` +
        `Also: cleanestZone ("left"|"right"|"upperLeft"|"upperRight") and fix (<=15 words: the ONE highest-impact improvement).\n` +
        `Return STRICT JSON {"textComplete":bool,"overlapsSubject":bool,"contrastOk":bool,"punch":n,"styleMatch":n,"cleanestZone":str,"fix":str}.`,
      imagePaths: [args.outJpg],
      json: true,
      maxTokens: 300,
    }).catch(() => "");
    if (!raw) break; // vision unavailable Ã¢â€ â€™ deterministic render stands
    const v = parseJsonLoose<{
      textComplete?: boolean; overlapsSubject?: boolean; contrastOk?: boolean;
      punch?: number; styleMatch?: number; cleanestZone?: string; fix?: string;
    }>(raw);
    const good =
      v.textComplete !== false && v.overlapsSubject !== true && v.contrastOk !== false &&
      (v.punch ?? 10) >= 7 && (v.styleMatch ?? 10) >= 7;
    if (good) {
      args.log?.(`thumbnailLab: critique PASS (punch ${v.punch ?? "?"}/10, style ${v.styleMatch ?? "?"}/10)`);
      break;
    }
    if (iter === 2) {
      if (v.textComplete === false) throw new Error(`thumbnail text incomplete after refinement: ${v.fix ?? "?"}`);
      args.log?.(`thumbnailLab: shipping after refinement ceiling (punch ${v.punch}/10, style ${v.styleMatch}/10 Ã¢â‚¬â€ ${v.fix ?? ""})`);
      break;
    }
    // ACT on each finding:
    const actions: string[] = [];
    if (v.textComplete === false) {
      curProps = {
        ...curProps,
        lines: ((curProps["lines"] as { text?: string; size?: number }[] | undefined) ?? []).map((l) => ({ ...l, size: (l.size ?? 1) * 0.85 })),
      };
      actions.push("textÃ¢â€ â€œ15%");
    }
    if (v.overlapsSubject === true && v.cleanestZone && ["left", "right", "upperLeft", "upperRight"].includes(v.cleanestZone)) {
      curProps = { ...curProps, position: v.cleanestZone };
      actions.push(`textÃ¢â€ â€™${v.cleanestZone}`);
    }
    if (v.contrastOk === false) {
      curProps = { ...curProps, strokePx: Math.min(10, Number(curProps["strokePx"] ?? 6) + 3), scrim: true };
      actions.push("contrast+");
    }
    if (((v.punch ?? 10) < 7 || (v.styleMatch ?? 10) < 7) && baseRegens < 1) {
      baseRegens++;
      const ampUrl = await generateFalFluxProImage({
        prompt: `${basePrompt} PUSH FURTHER: ${v.fix ?? "more drama, more saturation, stronger focal moment"}.`,
      });
      await downloadTo(ampUrl, basePath);
      actions.push("base regen");
    }
    args.log?.(`thumbnailLab: critique iter ${iter + 1} Ã¢â‚¬â€ punch ${v.punch}/10 style ${v.styleMatch}/10 Ã¢â€ â€™ ${actions.join(", ") || "no actionable fix"}`);
    if (!actions.length) break;
  }
  args.log?.(`thumbnailLab: candidate ${args.idx + 1} "${args.pattern.name}" rendered + critiqued`);
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
  const raw = await geminiVisionLocal({
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
