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
  renderSpec: { scene?: { textZone?: string }; typography?: { lines?: Array<{ text?: string }>; subtitle?: string } };
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
    "Follow the selected meditation pattern: PEACE AWAITS must be completely readable on the left in a calm bright-blue contrast system, while the stones remain right-side environmental artwork and never overlap the headline.",
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
  // Repair plans are deliberately re-plannable. A previous native-text contract
  // can therefore be present in their stored scene prompt. It must never be
  // carried forward alongside a replacement headline: two exact-copy clauses
  // give ERNIE conflicting instructions and make the QA expectation meaningless.
  return scenePrompt
    .replace(/\.\s*No textual props or writing surfaces:[\s\S]*$/i, "")
    .replace(/\.\s*The scene alone must communicate the subject at phone size; use at most three visual elements\.?/i, ".")
    .replace(/\.\s*Put the dominant hero on the side opposite the [^.]+\./i, ".")
    .replace(/\.\s*Keep the [^.]+ 42% darker and graphically simple for a later local overlay; avoid a dead 50\/50 split\./i, ".")
    .replace(/\.\s*Let one meaningful hero contour or atmospheric layer intrude [^.]+\./i, ".")
    .replace(/\s*ERNIE MUST RENDER THE FINAL THUMBNAIL TYPOGRAPHY NATIVELY IN THE IMAGE;[\s\S]*$/i, "")
    .trim();
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
  const artPrompt = sourceArtPrompt(plan.scenePrompt);
  if (!artPrompt) throw new Error(`${plan.sourceRunId}: source scene prompt contains no reusable visual direction`);
  const allowedWords = [...headline, ...(badge ? [badge] : [])];
  const repair = REPAIR_DIRECTIVES[plan.sourceRunId];
  const differentiation = plan.channelSlug === "the-quiet-stoic-1780409262742"
    ? "Use a topic-specific peak-action silhouette and proof detail. Do not default to the same cracked marble bust unless the story action itself requires it."
    : undefined;
  return [
    artPrompt,
    differentiation ?? "",
    repair ?? "",
    "ERNIE MUST RENDER THE FINAL THUMBNAIL TYPOGRAPHY NATIVELY IN THE IMAGE; no external text overlay will be added.",
    `Use an intentional integrated composition: the hero may be centered when that creates the strongest readable story, otherwise use the ${scene?.textZone ?? "left"} zone. Arrange the native typography around the hero silhouette and visual motion rather than forcing a 50/50 title panel.`,
    `Render these headline lines EXACTLY, with exact spelling and no substitutions: ${headline.map((line, index) => `line ${index + 1}: \"${line}\"`).join("; ")}.`,
    badge ? `Render exactly one small channel badge reading \"${badge}\" away from the timestamp corner.` : "Do not add a channel badge.",
    `No other visible words or letter-like marks are allowed. Only these approved strings may appear: ${allowedWords.map((word) => `\"${word}\"`).join(", ")}.`,
    "Never add a watermark, model signature, logo, pseudo-logo, poster title, label, newspaper, UI, additional slogan, or decorative glyphs.",
  ].join(" ");
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
