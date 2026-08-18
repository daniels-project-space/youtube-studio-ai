/**
 * 32-second original documentary Short proof.
 *
 * Uses a locked factual plan: Wikimedia Commons search is attempted for every
 * real-world visual first; only rejected/missing results use FAL-hosted Nano
 * Banana Flash. No prior video footage, reference-video assets, or Pro image
 * model is used.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { bootstrapSecrets } from "@/lib/bootstrap";
import {
  craftDocuMotion,
  normalizeDocuPlan,
  validatePlan,
  type DocuAssetBrief,
  type DocuPlan,
  type DocuShotPlan,
} from "@/lib/documotion";
import {
  editorialCoverageFor,
  editorialMotionArcFor,
  editorialTypographyFor,
} from "@/lib/documentaryVisualQuality";
import { getStyle } from "@/remotion/docuStyles";
import type { DocuCamera, DocuShotKind } from "@/remotion/DocuMotion";

const OUT_PATH = process.env.OUT_PATH ??
  "/home/ubuntu/youtube-studio-ai/output/documotion/netflix-blockbuster-search-first-32-v6-20260810.mp4";
const RUN_DIR = process.env.RUN_DIR ??
  join(process.cwd(), "output", "documotion", "netflix-blockbuster-search-first-32-v6-20260810");

function onlineAsset(
  id: string,
  role: DocuAssetBrief["role"],
  brief: string,
  onlineQuery: string,
  storyRole: NonNullable<DocuAssetBrief["storyRole"]>,
): DocuAssetBrief {
  return { id, role, brief, source: "online", onlineQuery, storyRole };
}

function directedShot(args: Omit<DocuShotPlan, "coverage" | "motionArc" | "typography">): DocuShotPlan {
  return {
    ...args,
    coverage: editorialCoverageFor(args.narration, args.beat, args.kind),
    motionArc: editorialMotionArcFor(args.narration, args.beat, args.camera),
    typography: editorialTypographyFor(args.kind, Boolean(args.title)),
  };
}

function camera(
  move: DocuCamera["move"],
  revealMove: NonNullable<DocuCamera["revealMove"]>,
  revealAtPercent: number,
  intensity: DocuCamera["intensity"] = "medium",
): DocuCamera {
  return { move, revealMove, revealAtPercent, intensity };
}

export function netflixBlockbusterSearchFirstPlan(): DocuPlan {
  const story = [
    directedShot({
      kind: "depth_parallax" as DocuShotKind,
      narration: "Blockbuster owned movie night. Late fees ruled the store.",
      scale: "establishing",
      beat: "Blockbuster owns movie night",
      durationSec: 5.4,
      camera: camera("push_in", "pan_right", 0.5, "strong"),
      title: "MOVIE NIGHT",
      kicker: "2000",
      labels: [{ text: "STORE ERA", sub: "late-fee economy" }],
      visualCues: [
        "Plastic DVD rental cases stacked beside visible silver discs on a rental counter",
        "Blue-and-yellow video-rental-store color panels behind the cases",
      ],
      assets: [onlineAsset(
        "blockbuster-store-establish",
        "image",
        "Cinematic documentary macro of a video-rental checkout counter: a clerk hand receives a returned plastic DVD case beside stacked rental cases and visible silver discs, distinct blue-and-yellow retail color panels behind the counter; no books, magazines, readable words, logos, signage, or labels",
        "DVD rental checkout counter hand returning case",
        "establish",
      )],
    }),
    directedShot({
      kind: "object_drop" as DocuShotKind,
      narration: "Netflix mailed red envelopes—no stores, just losses.",
      scale: "wide",
      beat: "A red envelope enters",
      durationSec: 5.4,
      camera: camera("pan_left", "push_in", 0.48),
      title: "NO STORES",
      kicker: "NETFLIX",
      labels: [{ text: "BY MAIL", sub: "a different bet" }],
      visualCues: [
        "A red DVD mail envelope on a doorstep beside an open mailbox",
        "No retail storefront—only a suburban front door and mailbox",
      ],
      assets: [
        onlineAsset(
          "netflix-mailbox-plate",
          "bg",
          "Documentary wide plate of only a suburban front door and open mailbox at dusk, empty street and no retail storefront, no legible lettering",
          "suburban front door open mailbox dusk no people",
          "establish",
        ),
        onlineAsset(
          "netflix-red-envelope",
          "cutout",
          "Clean isolated blank matte-red DVD mail envelope, physical paper object with no postage stamp, address block, postmark, printed text, letters, numbers, logo, or markings",
          "blank red envelope isolated on white no writing",
          "proof",
        ),
      ],
    }),
    directedShot({
      kind: "evidence_board" as DocuShotKind,
      narration: "Netflix offered itself for fifty million, with web help.",
      scale: "medium",
      beat: "The fifty-million offer",
      durationSec: 5.4,
      camera: camera("pull_back", "push_in", 0.48),
      title: "THE OFFER",
      kicker: "2000",
      labels: [{ text: "$50M" }, { text: "THE WEB" }],
      visualCues: [
        "A meeting-era business photograph and a connected paper trail",
      ],
      assets: [
        onlineAsset(
          "blockbuster-meeting-photo",
          "image",
          "Editorial meeting-era business photograph: suited video-rental executives, a connected paper trail and paper proposal on the table, no readable text",
          "Blockbuster executives meeting 2000",
          "proof",
        ),
        onlineAsset(
          "web-proposal-detail",
          "image",
          "Close documentary photograph of a hand placing an unmarked cream paper folder onto a conference table beside a blank matte-red DVD mail envelope; physical business-table detail with no readable writing, letters, numbers, logo, stamps, address, or postmark",
          "red DVD envelope conference table",
          "detail",
        ),
        onlineAsset(
          "offer-envelope-cutout",
          "image",
          "Clean isolated blank matte-red DVD mail envelope, physical paper object with no postage stamp, address block, postmark, printed text, letters, numbers, logo, or markings",
          "red DVD mail envelope blank",
          "proof",
        ),
      ],
    }),
    directedShot({
      kind: "object_drop" as DocuShotKind,
      narration: "Blockbuster passed. Stores paid well; online looked small.",
      scale: "medium",
      beat: "The profitable old model",
      durationSec: 5.4,
      camera: camera("pan_right", "push_in", 0.5),
      kicker: "THE TURN",
      labels: [{ text: "THEY PASSED" }, { text: "SIDE BET", sub: "online looked small" }],
      visualCues: [
        "A busy physical video-rental checkout counter and crowded DVD shelves",
        "A beige early-2000s desktop computer with a blank dark screen, visually smaller than the store business",
      ],
      assets: [
        onlineAsset(
          "blockbuster-side-bet",
          "bg",
          "Deep documentary plate of a busy physical video-rental checkout counter with crowded DVD shelves behind it, tangible profitable store business; no readable branding, signs, labels, logos, letters, or numbers",
          "video rental store checkout counter DVD shelves",
          "proof",
        ),
        onlineAsset(
          "overlooked-computer",
          "cutout",
          "Isolated beige early-2000s desktop computer and monitor with a blank dark screen, no keyboard writing, UI, letters, numbers, logos, stickers, or markings",
          "beige desktop computer monitor isolated blank screen",
          "detail",
        ),
      ],
    }),
    directedShot({
      kind: "photo_slide" as DocuShotKind,
      narration: "Netflix dropped late fees; mail later became streaming.",
      scale: "close",
      beat: "The habit changes shape",
      durationSec: 5.4,
      camera: camera("drift", "pan_left", 0.48),
      kicker: "THE NEW HABIT",
      labels: [{ text: "MAIL → STREAM", sub: "same promise" }],
      visualCues: [
        "A red DVD envelope reaching an open mailbox",
        "A customer watching a glowing television at home instead of visiting a store",
      ],
      assets: [
        onlineAsset(
          "streaming-home-bg",
          "bg",
          "Warm dark living-room documentary plate: a customer watching a glowing television at home instead of visiting a store; screen only throws a soft blank blue-white light with no visible interface, words, letters, numbers, logo, or marks",
          "Netflix streaming television living room",
          "establish",
        ),
        onlineAsset(
          "dvd-mail-detail",
          "image",
          "Close editorial photograph of a blank matte-red DVD envelope reaching an open mailbox, its edge sliding through the slot; no postage stamp, address, postmark, printed text, letters, numbers, logo, or marks",
          "blank red envelope mailbox close-up no writing",
          "proof",
        ),
        onlineAsset(
          "streaming-detail",
          "image",
          "Editorial close-up of a hand holding a remote toward a glowing television in a dark home, no UI, no readable text",
          "television remote streaming living room",
          "detail",
        ),
      ],
    }),
    directedShot({
      kind: "quote_card" as DocuShotKind,
      narration: "By 2010, Blockbuster filed. Streaming won movie night.",
      scale: "close",
      beat: "The new way to watch",
      durationSec: 5.4,
      camera: camera("push_in", "pull_back", 0.5, "strong"),
      quote: "The side bet became the new way to watch.",
      quoteEmphasis: ["side", "new", "watch"],
      attribution: "Netflix / Blockbuster, 2000–2010",
      visualCues: [
        "A dark living room at night with blank blue-white television glow",
        "A single blank red envelope on the coffee table",
      ],
      assets: [onlineAsset(
        "closed-store-close",
        "bg",
        "Atmospheric text-free closing plate: a dark living room at night with a blank blue-white television glow and a single blank red envelope on the coffee table, no logos, words, letters, numbers, UI, or marks",
        "dark living room television blue glow red envelope",
        "proof",
      )],
    }),
  ];
  return { title: "The $50M No", styleId: "archival_collage", shots: story };
}

async function main(): Promise<void> {
  const lockedPlan = normalizeDocuPlan(netflixBlockbusterSearchFirstPlan());
  const problems = validatePlan(lockedPlan, 32, getStyle("archival_collage"), {
    narrationWordsPerSec: 1.65,
  });
  if (problems.length) throw new Error(`32s Netflix Short preflight failed: ${problems.join("; ")}`);
  if (process.argv.includes("--preflight")) {
    console.log(JSON.stringify({ status: "ready", shots: lockedPlan.shots.length, durationSec: 32 }, null, 2));
    return;
  }
  // Every generated fallback goes through FAL's Nano Banana Flash endpoint;
  // review also remains on non-Google providers.
  process.env.VISION_DISABLE_GEMINI = "1";
  process.env.VISION_PROVIDERS = "fal,groq";
  // This master is deliberately narrated by ElevenLabs' warm, measured George
  // voice. Never fall back to Fish for this run: missing Eleven credentials
  // must fail before any paid image or render work begins.
  process.env.DOCU_ELEVEN_VOICE_ID ??= "JBFqnCBsd6RMkjVDRZzb";
  await bootstrapSecrets((message) => console.log(`[bootstrap] ${message}`), {
    required: ["FAL_KEY", "ELEVENLABS_API_KEY"],
  });
  await mkdir(dirname(OUT_PATH), { recursive: true });
  await mkdir(RUN_DIR, { recursive: true });
  const result = await craftDocuMotion({
    topic: "How Netflix's $50 million offer to Blockbuster became the new way to watch",
    style: "archival_collage",
    durationSec: 32,
    runDir: RUN_DIR,
    outPath: OUT_PATH,
    format: "short",
    plan: lockedPlan,
    lockShotDurations: true,
    maxRefineRounds: 2,
    log: (message) => console.log(`[netflix-32] ${message}`),
  });
  if (!result.verdict.pass) throw new Error("32s Netflix Short was rendered without a passing visual verdict");
  console.log(JSON.stringify({
    outPath: result.outPath,
    durationSec: result.shotDurationsSec.reduce((sum, duration) => sum + duration, 0),
    quality: result.quality,
    verdict: result.verdict,
    assetReceipts: result.assetReceipts,
  }, null, 2));
}

if (process.argv[1]?.endsWith("render-netflix-blockbuster-search-first-32-v6.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
