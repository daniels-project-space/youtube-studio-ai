/**
 * THUMBNAIL LAB — evidence → rules → tournament → comparative validation.
 *
 * The one-shot "generate and pass/fail" approach produced competent-but-stale
 * thumbnails. The lab works the way winning channels work:
 *
 *  1. VERIFY EVIDENCE — pull the highest-VIEW competitor thumbnails the
 *     research already scraped, then vision-screen them: only genuinely
 *     on-positioning, high-craft references survive (the architect flagged
 *     reference pollution as a BLOCKING gap — this is its repair).
 *  2. DISTILL RULES — vision-deconstruct WHY each verified winner clicks
 *     (composition, focal device, text treatment, color story), then have the
 *     showrunner synthesize a persistent per-channel PLAYBOOK: hard rules +
 *     three named, executable patterns. Stored on the channel — the "devises
 *     rules out of that" loop, made durable.
 *  3. TOURNAMENT — per video, instantiate ALL patterns into real candidates
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

/** Distilled 2026 CTR research — the judge's and synthesizer's ground truth. */
export const RESEARCH_PRINCIPLES = [
  "≤3 visual elements; the tone+topic must read in under 1 second (clutter costs ~23% CTR).",
  "2-3 bold complementary colors; the subject 30%+ brighter or darker than the background.",
  "Faceless niches win with ONE dramatic hero object against a clean ground + a ≤4-word callout.",
  "Finance: NUMBER-FORWARD — one specific number as the credibility trigger, occupying 15-20% of the canvas, upper third, white/gold on dark (data-literate audiences click specifics, not adjectives).",
  "Navy/charcoal base + gold/white accents = institutional authority palette for finance.",
  "Text: bold sans-serif ONLY, 1-3 words (5 absolute max), NEVER restating the title — it adds the curiosity the title doesn't.",
  "Documentary annotation language (Vox/Johnny Harris school): muted cinematic base + ONE editorial annotation device (accent underline, circled element, arrow) in the accent color.",
  "Consistent per-channel styling lifts subscriber CTR 15-20%: lock palette + text position family; vary the hero object and the number.",
  "Honest framing only — false-promise thumbnails decay channel-wide recommendations.",
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
  /** Scene recipe for the FLUX base — text-free, with <PLACEHOLDERS>. */
  fluxRecipe: string;
  /** ThumbText prop template (placeholders in line texts / numberCallout). */
  textRecipe: Record<string, unknown>;
}

export interface ThumbnailPlaybook {
  rules: string[];
  avoid: string[];
  patterns: ThumbPattern[];
  refsUsed: { url: string; views: number; why: string }[];
  distilledAt: number;
}

/* --------------------- 0. acquire fresh references --------------------- */

/**
 * Direct, positioning-true reference acquisition — the repair for polluted
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
      `Write 4 YouTube SEARCH QUERIES that surface the videos of TRUE comparable channels — same tier, same ` +
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
    } catch { /* unreachable url — skip */ }
  }
  if (paths.length < 3) throw new Error(`thumbnailLab: only ${paths.length} reference thumbnails reachable`);

  const raw = await geminiVisionLocal({
    prompt:
      `These are ${paths.length} thumbnails from the HIGHEST-VIEW videos scraped in this niche, in order.\n` +
      `Channel being built: "${args.channelName}" — positioning: ${args.positioning}\n\n` +
      `For EACH image (1-${paths.length}): does it belong to the same PREMIUM/CINEMATIC tier and positioning ` +
      `(vs hustle-bro, crypto-pump, shocked-face tabloid, or low-craft clickbait)? Score craft 1-10 ` +
      `(composition, typography, color discipline). Return STRICT JSON ` +
      `{"refs":[{"idx":1-based,"onBrand":boolean,"craft":1-10,"why":"<=15 words"}]} — judge every image.`,
    imagePaths: paths.map((p) => p.path),
    json: true,
    maxTokens: 1600,
  });
  const parsed = parseJsonLoose<{ refs?: { idx?: number; onBrand?: boolean; craft?: number; why?: string }[] }>(raw);
  const verdicts = parsed.refs ?? [];
  const verified: VerifiedRef[] = [];
  for (const v of verdicts) {
    const i = (v.idx ?? 0) - 1;
    if (i < 0 || i >= paths.length) continue;
    if (v.onBrand && (v.craft ?? 0) >= 6) {
      verified.push({ ...paths[i], craft: v.craft ?? 6, why: v.why ?? "" });
    }
  }
  verified.sort((a, b) => b.craft - a.craft || b.views - a.views);
  log(`thumbnailLab: ${verified.length}/${paths.length} references VERIFIED on-brand+high-craft (rest rejected as pollution)`);
  if (verified.length < 3) {
    throw new Error(
      `thumbnailLab: only ${verified.length} verified references — the scraped niche set is too polluted to ground a playbook (re-run niche research with corrected queries)`,
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
  // Vision deconstruction — WHY each verified winner clicks.
  const deconRaw = await geminiVisionLocal({
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
    rules?: string[];
    avoid?: string[];
    patterns?: { name?: string; when?: string; fluxRecipe?: string; textRecipeJson?: string }[];
  }>({
    maxTokens: 3000,
    temperature: 0.5,
    system: "You are an elite YouTube thumbnail strategist. Return ONLY JSON.",
    prompt:
      `Build the THUMBNAIL PLAYBOOK for "${args.channelName}" (${args.positioning}).\n\n` +
      `EVIDENCE — deconstruction of ${decon.length} verified high-view, on-positioning thumbnails:\n` +
      `${JSON.stringify(decon).slice(0, 6000)}\n\n` +
      `CHANNEL DNA: palette ${palette.join(", ")} (accent ${accent}); thumbnail subject: ` +
      `${args.dna?.thumbnail?.subject ?? args.dna?.recurringSubject ?? "n/a"}; world: ${args.dna?.setting ?? "n/a"}.\n\n` +
      `RESEARCH PRINCIPLES (hard constraints):\n- ${RESEARCH_PRINCIPLES.join("\n- ")}\n\n` +
      `Synthesize:\n` +
      `1. rules: 6-8 HARD rules for this channel's thumbnails — specific (sizes, positions, counts, colors), ` +
      `derived from the evidence + principles, honoring the DNA palette.\n` +
      `2. avoid: 4-6 anti-patterns seen in the rejected/owned space.\n` +
      `3. patterns: EXACTLY 3 named, executable patterns (distinct compositions — e.g. number-forward / ` +
      `hero-object / annotated-chart). Each: name; when (which video topics); fluxRecipe = a TEXT-FREE ` +
      `image-generation scene recipe with <PLACEHOLDERS> for the topic-specific hero (palette + grade baked in, ` +
      `composition explicit incl. where negative space lives); textRecipeJson = a JSON-ENCODED STRING of the ` +
      `text-layer props: {"lines":[{"text":"<HOOK_WORD_1>","accent":false},{"text":"<HOOK_WORD_2>","accent":true}],` +
      `"numberCallout":"<NUMBER_OR_OMIT>","position":"left|center|upperLeft|upperCenter","baseColor":"#hex",` +
      `"accentColor":"#hex","uppercase":true,"underlineAccent":true,"badge":"${args.channelName.toUpperCase()}"} ` +
      `— placeholders ONLY in line texts and numberCallout.\n` +
      `Return STRICT JSON {"rules":string[],"avoid":string[],"patterns":[{"name","when","fluxRecipe","textRecipeJson"}]}.`,
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

  log(`thumbnailLab: playbook distilled — ${play.rules?.length ?? 0} rules, ${patterns.length} patterns (${patterns.map((p) => p.name).join(" / ")})`);
  return {
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
  playbook: ThumbnailPlaybook;
  outJpg: string;
  tmpDir: string;
  idx: number;
  log?: Logger;
}): Promise<string> {
  if (!hasFalKey()) throw new Error("thumbnailLab: FAL_KEY required");
  // Fill the placeholders with topic-specific concretes.
  const inst = await claudeJson<{ fluxPrompt?: string; textPropsJson?: string }>({
    maxTokens: 900,
    temperature: 0.7,
    system: "You are an elite YouTube thumbnail art director. Return ONLY JSON.",
    prompt:
      `Instantiate this thumbnail PATTERN for the video "${args.title}".\n` +
      (args.scriptHint ? `Video content hint: ${args.scriptHint.slice(0, 500)}\n` : "") +
      `PATTERN "${args.pattern.name}": ${args.pattern.fluxRecipe}\n` +
      `TEXT TEMPLATE: ${JSON.stringify(args.pattern.textRecipe)}\n` +
      `HARD RULES:\n- ${args.playbook.rules.slice(0, 6).join("\n- ")}\n\n` +
      `Produce: fluxPrompt = the recipe with every <PLACEHOLDER> replaced by a concrete, vivid choice for THIS ` +
      `topic (keep it TEXT-FREE — no words/letters in the image); textPropsJson = the template as a JSON-ENCODED ` +
      `STRING with placeholders replaced (line texts: 1-3 punchy words each, ≤5 words total, NOT restating the ` +
      `title; numberCallout: a REAL specific number from the topic or omit the key entirely if none is honest).\n` +
      `Return STRICT JSON {"fluxPrompt":string,"textPropsJson":string}.`,
  });
  if (!inst.fluxPrompt || !inst.textPropsJson) throw new Error("pattern instantiation incomplete");
  let textProps: Record<string, unknown>;
  try { textProps = JSON.parse(inst.textPropsJson) as Record<string, unknown>; } catch {
    throw new Error("pattern textPropsJson unparseable");
  }

  const baseUrl = await generateFalFluxProImage({
    prompt: `${inst.fluxPrompt} Absolutely NO text, NO words, NO letters, NO numbers, NO watermark.`,
  });
  const basePath = await downloadTo(baseUrl, join(args.tmpDir, `cand_${args.idx}_base.png`));
  const textPng = await renderThumbTextLayer({
    props: textProps,
    outPng: join(args.tmpDir, `cand_${args.idx}_text.png`),
  });
  await overlayPngOnImage(basePath, textPng, args.outJpg);
  args.log?.(`thumbnailLab: candidate ${args.idx + 1} "${args.pattern.name}" rendered`);
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
  // Judge at FEED size — the size the click decision actually happens at.
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
      `Be harsh — 8+ means it genuinely belongs among the winners.\n` +
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
    `thumbnailLab: tournament — ${out.map((c, i) => `#${i + 1} ${c.pattern}: ${c.clickScore ?? "?"}/10 (beats ${c.beatsRefs ?? "?"} refs)`).join("; ")} → winner #${winnerIdx + 1}`,
  );
  return { candidates: out, winnerIdx, judgeWhy: parsed.why ?? "" };
}
