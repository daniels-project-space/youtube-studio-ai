/**
 * Migrate the already owner-reviewed thumbnail plans to ERNIE-native
 * typography. It is deliberately provider-free: it creates neither an image
 * nor a local type treatment.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SOURCE_DIR = process.env.ERNIE_THUMBNAIL_SOURCE_PLAN_DIR?.trim() || "/tmp/ysa-ernie-thumbnail-refresh-v1";
const OUT_DIR = process.env.ERNIE_NATIVE_THUMBNAIL_PLAN_DIR?.trim() || "/tmp/ysa-ernie-native-thumbnail-refresh-v1";
const ONLY_IDS = new Set((process.env.ERNIE_THUMBNAIL_ONLY_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const BATCH_LABEL = process.env.ERNIE_NATIVE_THUMBNAIL_BATCH_LABEL?.trim() || "native-refresh";
const BATCH_SIZE = 12;

type RecordValue = Record<string, unknown>;
type SourcePlan = RecordValue & {
  sourceRunId: string;
  channelId: string;
  channelName: string;
  channelSlug: string;
  title: string;
  family: string;
  expectedWords: string[];
  renderSpec: {
    scene?: { textZone?: string; description?: string; visualAvoid?: string[] };
    typography?: { lines?: Array<{ text?: string }>; subtitle?: string };
  };
  scenePrompt: string;
};

const REPAIR_DIRECTIVES: Readonly<Record<string, string>> = {
  js705md1etr1kr0mpbpvpqaz8x89znvt:
    "Render only the two headline lines and exactly one compact CHALK & COMPOUND badge. Do not render an @handle, URL, social tag, YouTube bar, subscribe button, platform icon, or any second badge. Keep TAX DECODED large, textured, and instantly legible at mobile size.",
  js70p2m3ff41ahs6v325f7tsyh883wbe:
    "Keep the entire ENDURE ANY PAIN hook in one uninterrupted high-contrast outer field. The hero may not cover, touch, sit behind, or interrupt any headline glyph.",
  js71r43g466khvb662mpw29dbh87yret:
    "Render the exact headline HONOR / THE VOID with one T only. Keep both lines entirely visible, sharply separated, and high-contrast; never duplicate, merge, crop, or distort any glyph.",
  js729svsaqtntgerfqhrz61e7187xrzw:
    "Keep LOVE WHAT BREAKS fully separated from the hero and background. Use a crisp high-contrast field with an obvious clear edge at mobile size; no low-contrast letters behind the subject.",
  js72d9gty4nrqqq7wevv0m0hyd89xgk9:
    "Break the repeated-stones failure. Show a serene woman floating weightlessly in calm moonlit water, with soft mist, fern silhouettes, and one distant warm lantern as the only supporting proof of sanctuary. Keep the water and the person as the hero, not a rock pile, a sci-fi ring, or generic wellness stock art. PEACE / AWAITS must be completely readable on the left in a calm bright-blue contrast system and never overlap the figure.",
  js74dk95rtbzj1hmbctewfa8dh88dw4v:
    "Ground the withdrawal story in a believable human consequence: a mature hand pulls the final few retirement-account statements from a nearly empty archival envelope while a thin red withdrawal line tears through the paper and a modest house silhouette falls out of focus behind it. Make the paper, hand, and torn line feel photographed and materially real—not a game UI, a neon trading chart, a pile of coins, or a luxury-prop render. WITHDRAWAL / TRAP must be huge, physical, and immediately readable in a clean dark field.",
  js76ghf4s44b4w5d97cs2f49bd89znxa:
    "Make this unmistakably Inked Histories: an original hand-inked, burnished-gold historical engraving, not a photoreal treasure-hunter poster. A gloved field conservator lifts one mud-caked battlefield relic from dark soil while a tiny exposed oxygen crack begins to destroy its surface; a dim wartime trench and one distant helmet make the background proof. Use tactile charcoal cross-hatching, aged parchment, smoke, and one restrained molten-gold preservation glow. OXYGEN / TRAP must be a battered physical letterpress object, large and clear without covering the action.",
  js72jge55xyf2d9bftq0bx078187yjmh:
    "Keep BECOME UNBREAKABLE as a single, unobscured oversized headline in a clear left-side field. The hero must stay entirely right of the headline and may not overlap, fragment, hide, or sit behind any letter. Place the one compact channel badge outside the bottom-right timestamp danger zone.",
  js72sy9xyvxtptvtbbg2z8aegs88ez4t:
    "Raise click impulse decisively: stage an extreme diagonal, close-cropped peak-action moment where the tiny gold fulcrum violently launches the immense black sphere upward through a shattered stone foundation. Add one unmistakable consequence detail—gold blocks and fracture debris flying toward camera—so the viewer reads tiny force versus enormous outcome in one second. The sphere, lever, and debris must fill the right two-thirds with no empty product-render space. Keep the requested native hook huge, textured, and physical in one pristine high-contrast left field; it must be readable before the hero is examined. Do not use a generic chart, an abstract decorative glow, or a calm centered object pose.",
  js7a7gwj4g140bp5n7g6gbrrv588e7cd:
    "Correct the contrast failure: render RESET / RISK as huge bright ivory physical typography in a clean near-black upper-left field, readable instantly at phone size. Never use dark, muted, recessed, transparent, or background-blended letters. Crop the recalibrating titanium-and-gold fulcrum aggressively on the right at the exact lock-in moment, with one sharp gold level-beam and one visible alignment seam as the consequence detail. The headline must visually lead before the object is examined.",
  js7dhx4je8jx8ajcqhwvecq9hx87x1tp:
    "Correct the contrast failure: render NEVER / ALONE as huge bright ivory physical typography in a clean near-black left field, readable instantly at phone size. Never use dark, muted, recessed, transparent, or background-blended letters. Keep the cracked marble hero decisively on the right with the gold fissures as the single proof detail; the hook must visually lead before the hero is examined.",
  js7e6p9mazycbfeexsk76pt4zd880a0z:
    "Correct the contrast failure: render NEVER / COMPROMISE as huge bright ivory physical typography in a clean near-black upper field, readable instantly at phone size. Never use dark, muted, recessed, transparent, or background-blended letters. Preserve the one peak-action proof—the kintsugi hand locking the blade while the chain breaks—but keep every headline glyph completely unobscured.",
  js7fvf3g4tsh4s4f522phazzwd87yq13:
    "Correct the duplicate-copy failure: render PRACTICE / DISASTER exactly once only, as one oversized bright-ivory two-line physical headline in the clean left field. Do not repeat, echo, shadow-copy, print, engrave, or place either word anywhere else. Keep the storm-battered marble citadel hero cropped on the right, with one lightning consequence detail, while protecting the headline as the only readable text hierarchy.",
};

/**
 * Some current legacy scene plans directly contradict owner-reviewed repair
 * direction (for example, Gratitude's old stones hero and Investory's gold
 * bridge). Appending a correction leaves both subjects in the Prompt
 * Enhancer's input. For these assessed candidates, preserve only the locked
 * style/palette header and substitute one complete, story-specific scene.
 */
const SCENE_OVERRIDES: Readonly<Record<string, string>> = {
  js705md1etr1kr0mpbpvpqaz8x89znvt:
    "Physical scene: a close human hand actively draws a bold chalk division line across an open, leather-bound tax ledger on a real blackboard desk. The chalk line splits one clear allocation into two unequal portions, with one tiny brass tax-bracket ruler as the proof detail. Keep a warm desk lamp, authentic chalk dust, and a dark study receding behind it; no dashboards, game UI, coins, or abstract glowing geometry.",
  js72d9gty4nrqqq7wevv0m0hyd89xgk9:
    "Physical scene: a serene woman floats weightlessly in still moonlit water on the right, eyes gently closed, as faint ripples spread into soft mist. One blurred fern edge and one distant warm lantern create depth and sanctuary; the water and the person are the only heroes. No stones, sci-fi rings, generic wellness stock composition, or repeated rock motif.",
  js74dk95rtbzj1hmbctewfa8dh88dw4v:
    "Physical scene: a mature human hand pulls the last few retirement-account statements from a nearly empty archival envelope in the right foreground. A thin red withdrawal line tears through one paper edge at the exact moment a modest house silhouette falls softly out of focus behind it. The paper, hand, and tear must feel photographed and materially real; no gold bridge, coins, luxury props, neon charts, game UI, or market dashboard.",
  js76ghf4s44b4w5d97cs2f49bd89znxa:
    "Physical scene: an original hand-inked, burnished-gold historical engraving. A gloved field conservator lifts one mud-caked battlefield relic from dark soil while one tiny exposed oxygen crack begins to corrode its surface; a dim wartime trench and one distant helmet complete the proof. Use tactile charcoal cross-hatching, aged parchment, smoke, and one restrained molten-gold preservation glow—never a photoreal treasure-hunter poster or game key art.",
};

// A small number of owner-directed packaging rewrites are intentionally
// explicit. They alter the native text request and the QA expectation together
// rather than silently accepting mismatched words from a render.
const HEADLINE_OVERRIDES: Readonly<Record<string, string[]>> = {
  js72sy9xyvxtptvtbbg2z8aegs88ez4t: ["TINY MOVE", "BIG SHIFT"],
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : undefined;
}

function sourceArtPrompt(scenePrompt: string): string {
  // Stored source plans were written for a two-stage image + local-type
  // renderer. ERNIE's prompt enhancer treats that long, repetitive contract
  // as scene material, which weakens the single hero and native hook. Keep
  // only the original art direction; native composition and exact copy are
  // appended once below as one coherent request.
  const legacyFree = scenePrompt
    .replace(/\s*ERNIE MUST RENDER THE FINAL THUMBNAIL TYPOGRAPHY NATIVELY IN THE IMAGE;[\s\S]*$/i, "")
    .replace(/\.\s*No textual props or writing surfaces:[\s\S]*$/i, "")
    .trim();
  const craftBoundary = legacyFree.search(/\.\s*(?:Approved Golden craft standard|Owner-selected A\/B preference standard):/i);
  const visualPlan = craftBoundary >= 0 ? legacyFree.slice(0, craftBoundary) : legacyFree;
  return visualPlan
    .replace(/Keep the \w+ 42% darker and graphically simple for a later local overlay;?/gi, "")
    .replace(/for a later local overlay/gi, "for the native hook")
    .replace(/future type zone/gi, "native type field")
    .replace(/baked-in AI typography or /gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceStyleHeader(scenePrompt: string): string {
  const physicalSceneAt = scenePrompt.search(/\bPhysical scene:/i);
  const header = physicalSceneAt >= 0 ? scenePrompt.slice(0, physicalSceneAt) : scenePrompt;
  const normalized = header.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("source scene prompt is missing its style and palette header");
  return normalized;
}

function channelCreativeGuardrail(plan: SourcePlan): string | undefined {
  if (plan.channelSlug.startsWith("inked-histories-")) {
    return "Keep the entire frame authored as an original hand-inked historical illustration: tactile cross-hatching, print texture, and expressive human action. Never make a photoreal AAA adventure-game still, a generic treasure-hunter poster, or a glossy film key art image.";
  }
  if (plan.channelSlug.startsWith("chalk-compound-")) {
    return "Make the concept physically legible through authentic chalk, a human hand, and one concrete financial cause-and-consequence object such as a ledger, tax bracket, or divided allocation. Never use generic currency stock imagery, a sterile dashboard, a trading-game screen, or a disconnected abstract diagram.";
  }
  if (plan.channelSlug.startsWith("gratitude-springs-")) {
    return "Make the calm feel human and varied: use a serene person, water, mist, light, foliage, sky, or intimate nature detail as the story requires. Stones are incidental scenery only, never the default hero. Avoid synthetic sci-fi rings, generic wellness stock art, and repeated rock-only compositions.";
  }
  if (plan.channelSlug.startsWith("investory-")) {
    return "Ground the story in one realistic investing consequence and a believable human or physical object. Avoid random money, unrelated luxury props, game-like charts, neon finance clichés, and generic market-dashboard art.";
  }
  return undefined;
}

function nativePrompt(plan: SourcePlan): string {
  const typography = plan.renderSpec.typography;
  const scene = plan.renderSpec.scene;
  const plannedHeadline = (typography?.lines ?? [])
    .map((line) => text(line.text))
    .filter((line): line is string => Boolean(line));
  const headline = HEADLINE_OVERRIDES[plan.sourceRunId] ?? plannedHeadline;
  if (!headline.length || !plan.expectedWords.length) {
    throw new Error(`${plan.sourceRunId}: original plan lacks an exact native headline`);
  }
  const badge = text(typography?.subtitle);
  const artPrompt = SCENE_OVERRIDES[plan.sourceRunId]
    ? `${sourceStyleHeader(plan.scenePrompt)} ${SCENE_OVERRIDES[plan.sourceRunId]}`
    : sourceArtPrompt(plan.scenePrompt);
  if (!artPrompt) throw new Error(`${plan.sourceRunId}: source scene prompt contains no reusable visual direction`);
  const allowedWords = [...headline, ...(badge ? [badge] : [])];
  const repair = REPAIR_DIRECTIVES[plan.sourceRunId];
  const channelGuardrail = channelCreativeGuardrail(plan);
  const differentiation = plan.channelSlug === "the-quiet-stoic-1780409262742"
    ? "Use a topic-specific peak-action silhouette and proof detail. Do not default to the same cracked marble bust unless the story action itself requires it."
    : undefined;
  return [
    artPrompt,
    differentiation ?? "",
    channelGuardrail ?? "",
    repair ?? "",
    "Create one high-click-through YouTube thumbnail with one peak-action hero, one small cause-or-consequence proof, and real foreground-to-background depth. Do not make a flat split panel, a generic product render, a game-key-art image, or a symmetrical poster.",
    "ERNIE itself must render the final typography as a physical part of the image; no external text overlay exists. Make the decisive noun dominant, high-contrast, and readable at phone size.",
    `Use an intentional integrated composition: the hero may be centered only when it makes the action stronger; otherwise use the ${scene?.textZone ?? "left"} native type field. Let one action contour enter that field slightly, but never cover a glyph or create a dead 50/50 title panel.`,
    `Render these headline lines EXACTLY, with exact spelling and no substitutions: ${headline.map((line, index) => `line ${index + 1}: \"${line}\"`).join("; ")}.`,
    badge ? `Render exactly one small channel badge reading \"${badge}\" away from the timestamp corner.` : "Do not add a channel badge.",
    `No other visible words or letter-like marks are allowed. Only these approved strings may appear: ${allowedWords.map((word) => `\"${word}\"`).join(", ")}.`,
    "Never add a watermark, model signature, logo, pseudo-logo, poster title, label, newspaper, UI, additional slogan, or decorative glyphs.",
  ].join(" ");
}

function sealedRenderSpec(plan: SourcePlan): SourcePlan["renderSpec"] {
  const override = SCENE_OVERRIDES[plan.sourceRunId];
  if (!override) return plan.renderSpec;
  return {
    ...plan.renderSpec,
    scene: {
      ...plan.renderSpec.scene,
      // The visual reviewer must judge the repaired scene, not the legacy
      // hero that this private calibration explicitly replaces.
      description: override.replace(/^Physical scene:\s*/i, "").trim(),
    },
  };
}

async function main(): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(BATCH_LABEL)) {
    throw new Error("ERNIE_NATIVE_THUMBNAIL_BATCH_LABEL must contain lowercase letters, numbers, and hyphens only");
  }
  for (const id of ONLY_IDS) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)) throw new Error(`ERNIE_THUMBNAIL_ONLY_IDS contains an invalid id: ${id}`);
  }
  const sourcePlans = join(SOURCE_DIR, "plans");
  const names = (await readdir(sourcePlans)).filter((name) => name.endsWith(".json")).sort();
  if (!names.length) throw new Error("no original thumbnail plans were found");
  await mkdir(join(OUT_DIR, "plans"), { recursive: true });
  const plans: Array<RecordValue> = [];
  const preservedLofi: Array<{ sourceRunId: string; channelSlug: string; title: string }> = [];
  const foundSelectedIds = new Set<string>();
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(sourcePlans, name), "utf8")) as SourcePlan;
    if (!text(parsed.sourceRunId) || !text(parsed.channelId) || !text(parsed.channelSlug) || !text(parsed.title) ||
      !Array.isArray(parsed.expectedWords) || !parsed.expectedWords.every(text) || !parsed.renderSpec || !text(parsed.scenePrompt) || !text(parsed.family)) {
      throw new Error(`${name}: source plan is malformed`);
    }
    // The owner's Lo-fi direction is an unaltered rendered-video visual, not
    // a regenerated image. Its still/reuse lane therefore stays outside the
    // ERNIE-native text module entirely.
    if (parsed.family === "music_loop") {
      preservedLofi.push({ sourceRunId: parsed.sourceRunId, channelSlug: parsed.channelSlug, title: parsed.title });
      continue;
    }
    if (ONLY_IDS.size && !ONLY_IDS.has(parsed.sourceRunId)) continue;
    foundSelectedIds.add(parsed.sourceRunId);
    const scenePrompt = nativePrompt(parsed);
    const expectedWords = HEADLINE_OVERRIDES[parsed.sourceRunId] ?? parsed.expectedWords;
    const plan = {
      ...parsed,
      version: 2,
      typographyRoute: "ernie-native-typography/v1",
      expectedWords,
      renderSpec: sealedRenderSpec(parsed),
      scenePrompt,
      promptSha256: digest(scenePrompt),
      promptCharacters: scenePrompt.length,
    };
    await writeFile(join(OUT_DIR, "plans", name), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    plans.push(plan);
  }
  const batches: Array<{ file: string; jobs: number }> = [];
  for (let offset = 0; offset < plans.length; offset += BATCH_SIZE) {
    const segment = plans.slice(offset, offset + BATCH_SIZE);
    const batchNumber = String(offset / BATCH_SIZE + 1).padStart(2, "0");
    const file = `ernie-${BATCH_LABEL}-batch-${batchNumber}.json`;
    await writeFile(join(OUT_DIR, file), `${JSON.stringify({
      version: 1,
      label: `${BATCH_LABEL}-${batchNumber}`,
      jobs: segment.map((plan, index) => ({
        id: plan.sourceRunId,
        prompt: plan.scenePrompt,
        seed: 200_000 + offset + index,
      })),
    }, null, 2)}\n`, "utf8");
    batches.push({ file, jobs: segment.length });
  }
  if (ONLY_IDS.size && foundSelectedIds.size !== ONLY_IDS.size) {
    const missing = [...ONLY_IDS].filter((id) => !foundSelectedIds.has(id));
    throw new Error(`requested ERNIE repair plan ids were not found: ${missing.join(", ")}`);
  }
  if (!plans.length) throw new Error("the requested ERNIE batch contains no non-Lo-fi plans");
  await writeFile(join(OUT_DIR, "manifest.json"), `${JSON.stringify({
    version: 2,
    typographyRoute: "ernie-native-typography/v1",
    batchLabel: BATCH_LABEL,
    sourcePlanDir: SOURCE_DIR,
    planned: plans.map((plan) => ({
      sourceRunId: plan.sourceRunId,
      channelSlug: plan.channelSlug,
      promptSha256: plan.promptSha256,
      expectedWords: plan.expectedWords,
    })),
    preservedLofi,
    batches,
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ event: "planned", route: "ernie-native-typography/v1", plans: plans.length, batches }));
}

main().catch((error: unknown) => {
  console.error(`prepare-ernie-native-thumbnail-refresh-batch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
